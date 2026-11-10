// 同步引擎：本机缓存 <-> 云端主库。
//
// 一轮同步的顺序很重要：
//   ① 先把本地脏集合和删除墓碑推上去（保证"我刚改的"不会丢）
//   ② 再把 since 之后的服务端变更拉下来合并
//   ③ 只有「同步开始前就已经存在的脏标记」才清除，同步过程中产生的新改动留到下一轮
//
// 冲突策略：同一条记录多端同时改，以最后同步的设备为准（服务端统一打时间戳），
// 因为这是单人自用的数据，不做字段级合并——复杂度换不来实际收益。
const cfg = require('./config.js');
const cloud = require('./cloud.js');
const store = require('./store.js');

const config = cfg.config;

const SET_COLLECTIONS = ['favorites', 'chapterFavs', 'chapterLikes'];
const OBJECT_COLLECTIONS = ['settings'];
const ALL_COLLECTIONS = [
  'events', 'tasks', 'members', 'receipts',
  'favorites', 'chapterFavs', 'chapterLikes', 'settings'
];

const state = {
  mode: 'local',        // local | cloud
  status: 'idle',       // idle | syncing | ok | error | offline | disabled
  lastSyncAt: 0,
  lastError: '',
  lastErrorCode: '',
  pending: 0,
  openid: '',
  bootstrapped: false,
  hasMore: false
};

const listeners = [];
let inflight = null;
let flushTimer = null;

function kindOf(col) {
  if (SET_COLLECTIONS.indexOf(col) >= 0) return 'set';
  if (OBJECT_COLLECTIONS.indexOf(col) >= 0) return 'object';
  return 'records';
}

function emit() {
  const snap = status();
  listeners.forEach(fn => {
    try { fn(snap); } catch (e) {}
  });
}

function subscribe(fn) {
  if (typeof fn === 'function') listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function status() {
  const meta = store.getSyncMeta();
  return {
    mode: state.mode,
    status: state.status,
    lastSyncAt: state.lastSyncAt || meta.lastSyncAt || 0,
    lastError: state.lastError,
    lastErrorCode: state.lastErrorCode,
    pending: state.pending,
    openid: state.openid,
    env: config.cloudEnv,
    envConfigured: !!config.cloudEnv,
    cloudEnableable: cfg.cloudEnabled(),
    bootstrapped: state.bootstrapped,
    migrated: meta.migrated,
    cloudSync: store.getLocalPrefs().cloudSync !== false
  };
}

function setState(patch) {
  Object.assign(state, patch);
  emit();
}

function errorCode(e) {
  const msg = String((e && (e.errMsg || e.message)) || '');
  if (/timeout|超时/i.test(msg)) return 'TIMEOUT';
  if (/network|fail|ECONN|socket|连接/i.test(msg)) return 'OFFLINE';
  return (e && e.code) || 'UNKNOWN';
}

// ---------------- 推送 ----------------

function buildChanges(cols) {
  const snap = store.snapshot(cols);
  const tombs = store.getTombstones();
  const consent = store.getConsent();
  const changes = {};
  cols.forEach(col => {
    // 家庭成员卡含敏感个人信息，没单独同意就一张都不上云（本机功能不受影响）
    if (col === 'members' && !consent.sensitive) return;
    const value = snap[col];
    const deletes = Array.isArray(tombs[col]) ? tombs[col] : [];
    if (value === null || value === undefined) {
      if (deletes.length) changes[col] = { upserts: kindOf(col) === 'object' ? null : [], deletes: deletes };
      return;
    }
    changes[col] = { upserts: value, deletes: deletes };
  });
  return changes;
}

// ---------------- 合并 ----------------

/** 增量合并：保留本地顺序，远端覆盖同主键，墓碑则移除 */
function mergeRecords(local, docs) {
  const list = Array.isArray(local) ? local.slice() : [];
  const indexOf = {};
  list.forEach((r, i) => { if (r && r.id) indexOf[r.id] = i; });
  const added = [];
  docs.forEach(d => {
    if (!d || !d.key) return;
    const id = d.key;
    if (d.deleted) {
      const i = indexOf[id];
      if (i !== undefined) { list[i] = null; delete indexOf[id]; }
      return;
    }
    if (!d.rec) return;
    const rec = Object.assign({}, d.rec);
    if (indexOf[id] !== undefined) list[indexOf[id]] = rec;
    else { added.unshift(rec); indexOf[id] = -1; }
  });
  return added.concat(list.filter(Boolean));
}

function mergeSet(local, docs) {
  let list = Array.isArray(local) ? local.slice() : [];
  const added = [];
  docs.forEach(d => {
    if (!d || !d.key) return;
    if (d.deleted) {
      list = list.filter(x => x !== d.key);
      return;
    }
    if (list.indexOf(d.key) < 0) added.push(d.key);
  });
  return added.reverse().concat(list);
}

function mergeObject(local, docs) {
  const cur = local && typeof local === 'object' ? local : {};
  const one = docs.filter(d => d.rec)[0];
  return one ? Object.assign({}, cur, one.rec) : cur;
}

/** 首次同步（since=0 且本地已迁移完）：以服务端为准整体覆盖 */
function replaceValue(col, docs) {
  const kind = kindOf(col);
  const live = docs.filter(d => !d.deleted);
  if (kind === 'records') {
    return live.filter(d => d.rec)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(d => d.rec);
  }
  if (kind === 'set') {
    return live.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(d => d.key);
  }
  const one = live.filter(d => d.rec)[0];
  return one ? one.rec : {};
}

function applyCollections(collections, opts) {
  const o = opts || {};
  const meta = store.getSyncMeta();
  const consent = store.getConsent();
  const applied = [];
  ALL_COLLECTIONS.forEach(col => {
    // 未授权时不下发也不落地成员卡，避免撤回后被别的设备又拉回来
    if (col === 'members' && !consent.sensitive) return;
    const docs = collections[col];
    if (!Array.isArray(docs) || !docs.length) return;
    // 本地还有没推上去的改动，这一轮先不动它，避免把用户刚改的东西覆盖掉
    if (meta.dirty[col]) return;

    const current = store.snapshot([col])[col];
    const kind = kindOf(col);
    let next;
    if (o.replaceAll && kind !== 'object') {
      next = replaceValue(col, docs);
    } else if (kind === 'records') {
      next = mergeRecords(current, docs);
    } else if (kind === 'set') {
      next = mergeSet(current, docs);
    } else {
      next = mergeObject(current, docs);
    }
    if (store.applyRemote(col, next)) applied.push(col);
  });
  return applied;
}

// ---------------- 主流程 ----------------

async function login() {
  const res = await cloud.call('login', {}, { timeout: 8000 });
  cloud.setOpenid(res.openid);
  store.saveSyncMeta({ openid: res.openid });
  return res;
}

/** 首次上云：把本机已有数据全量推一次，并打幂等标记 */
async function migrateIfNeeded(user) {
  const meta = store.getSyncMeta();
  if (meta.migrated) return false;
  if (user && user.migrated) {
    store.saveSyncMeta({ migrated: true });
    return false;
  }

  const hasLocal = ALL_COLLECTIONS.some(col => {
    const v = store.snapshot([col])[col];
    if (Array.isArray(v)) return v.length > 0;
    return v && typeof v === 'object' && Object.keys(v).length > 0;
  });

  // 没有任何本地数据也要打标记：这台设备注册完就算迁移完了
  const changes = hasLocal ? buildChanges(ALL_COLLECTIONS) : {};
  await cloud.call('sync', { since: 0, changes: changes, migrate: true }, { timeout: 20000 });
  await cloud.call('markMigrated', {}, { timeout: 8000 }).catch(() => null);
  store.saveSyncMeta({ migrated: true });
  if (hasLocal) store.clearDirty(ALL_COLLECTIONS);
  return true;
}

async function runSync(opts) {
  const o = opts || {};
  const startedAt = Date.now();
  const metaBefore = store.getSyncMeta();
  const dirtyCols = Object.keys(metaBefore.dirty).filter(c => ALL_COLLECTIONS.indexOf(c) >= 0);

  // 有"清空数据"没同步完：先清云端，否则这次同步会把云端数据又拉回来
  const prefs = store.getLocalPrefs();
  if (prefs.wipePending) {
    await cloud.call('wipe', {}, { timeout: 15000 });
    store.setLocalPref({ wipePending: false });
    store.saveSyncMeta({ lastSyncAt: 0 });
    store.clearDirty(ALL_COLLECTIONS);
    return { ok: true, wiped: true };
  }

  const changes = dirtyCols.length ? buildChanges(dirtyCols) : {};
  const since = o.full ? 0 : (store.getSyncMeta().lastSyncAt || 0);

  const res = await cloud.call(
    'sync',
    { since: since, changes: changes },
    { timeout: 20000, retry: 1 }
  );

  // 只有同步开始前就有的脏标记才清；期间新产生的留给下一轮
  const meta = store.getSyncMeta();
  dirtyCols.forEach(col => {
    if (!meta.dirty[col] || meta.dirty[col] <= startedAt) delete meta.dirty[col];
  });
  store.saveSyncMeta({ dirty: meta.dirty });

  // 服务端拒收（本地刚同意、云端还没收到同意记录这种竞态）：补推同意并重新标脏
  if (Array.isArray(res.blocked) && res.blocked.length) {
    const c = store.getConsent();
    if (c.sensitive) {
      await pushConsent({ version: c.version, sensitive: true, trackOptIn: c.trackOptIn }).catch(() => null);
    }
    res.blocked.forEach(col => store.markDirty(col));
  }

  applyCollections(res.collections || {}, { replaceAll: since === 0 });
  store.takeTombstones();
  store.saveSyncMeta({ lastSyncAt: res.serverTime || Date.now(), openid: res.openid || state.openid });

  await flushTrackIfOptIn();

  setState({
    status: 'ok',
    lastSyncAt: res.serverTime || Date.now(),
    lastError: '',
    lastErrorCode: '',
    pending: Object.keys(store.getSyncMeta().dirty).length,
    hasMore: !!res.hasMore,
    mode: 'cloud'
  });

  // 一页拉不完，继续拉
  if (res.hasMore) await runSync({ full: false });
  return { ok: true };
}

/** 埋点上报：默认关闭，只有用户在隐私设置里主动勾选才执行，且只传事件名与次数 */
async function flushTrackIfOptIn() {
  const consent = store.getConsent();
  if (!consent.trackOptIn) return;
  const all = store.getTrack();
  const prefs = store.getLocalPrefs();
  const sent = prefs.trackSent || {};
  const batch = [];
  Object.keys(all).forEach(name => {
    const count = (all[name] && all[name].count) || 0;
    const prev = sent[name] || 0;
    if (count > prev) {
      batch.push({ name: name, payload: { delta: count - prev }, at: all[name].lastAt || 0 });
      sent[name] = count;
    }
  });
  if (!batch.length) return;
  try {
    await cloud.call('track', { events: batch }, { timeout: 8000, retry: 0 });
    store.setLocalPref({ trackSent: sent });
  } catch (e) {
    // 上报失败不影响主流程
  }
}

async function syncNow(opts) {
  const o = opts || {};
  if (!cfg.cloudEnabled() || store.getLocalPrefs().cloudSync === false) {
    setState({ mode: 'local', status: 'disabled' });
    return { ok: false, reason: 'DISABLED' };
  }
  if (inflight) return inflight;

  setState({ status: 'syncing', lastError: '', pending: Object.keys(store.getSyncMeta().dirty).length });

  inflight = (async () => {
    try {
      const res = await runSync(o);
      return res;
    } catch (e) {
      const code = errorCode(e);
      setState({
        status: code === 'OFFLINE' || code === 'TIMEOUT' ? 'offline' : 'error',
        lastError: String((e && (e.message || e.errMsg)) || e),
        lastErrorCode: code,
        mode: 'cloud'
      });
      return { ok: false, reason: code, message: state.lastError };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 启动：初始化云能力 → 登录 → 首次迁移 → 一轮同步 */
async function bootstrap() {
  if (state.bootstrapped) return status();
  state.bootstrapped = true;

  if (!cfg.cloudEnabled()) {
    setState({ mode: 'local', status: 'disabled' });
    return status();
  }
  if (!cloud.init()) {
    setState({ mode: 'local', status: 'error', lastError: cloud.status().initError || '云开发初始化失败' });
    return status();
  }
  if (store.getLocalPrefs().cloudSync === false) {
    setState({ mode: 'local', status: 'disabled' });
    return status();
  }

  setState({ mode: 'cloud', status: 'syncing' });
  try {
    const res = await login();
    setState({ openid: res.openid, lastSyncAt: res.serverTime || 0 });
    await migrateIfNeeded(res.user);
    await syncNow({ full: false });
  } catch (e) {
    const code = errorCode(e);
    setState({
      mode: 'cloud',
      status: code === 'OFFLINE' || code === 'TIMEOUT' ? 'offline' : 'error',
      lastError: String((e && (e.message || e.errMsg)) || e),
      lastErrorCode: code
    });
  }
  return status();
}

/** 本地一有改动就安排一次推送（1.2s 合并窗口） */
function scheduleFlush() {
  if (!cfg.cloudEnabled()) return;
  if (store.getLocalPrefs().cloudSync === false) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    syncNow({ full: false });
  }, 1200);
}

/** 前后台切换回来时补一次，间隔小于 30s 就跳过 */
async function syncOnShow() {
  if (!cfg.cloudEnabled()) return;
  if (store.getLocalPrefs().cloudSync === false) return;
  const last = store.getSyncMeta().lastSyncAt || 0;
  if (Date.now() - last < config.syncInterval && state.status === 'ok') return;
  await syncNow({ full: false });
}

// ---------------- 数据权利 ----------------

async function exportData() {
  if (cfg.cloudEnabled() && store.getLocalPrefs().cloudSync !== false) {
    try {
      const res = await cloud.call('export', {}, { timeout: 25000, retry: 1 });
      return { ok: true, source: 'cloud', data: res.data };
    } catch (e) {
      // 云端拿不到就退回本机快照，至少让用户能带走现有数据
    }
  }
  const snap = store.snapshot(ALL_COLLECTIONS);
  return {
    ok: true,
    source: 'local',
    data: {
      exportedAt: new Date().toISOString(),
      collections: Object.keys(snap).map(col => ({ col: col, value: snap[col] }))
    }
  };
}

async function deleteAccount() {
  if (!cfg.cloudEnabled()) {
    store.clearAll();
    store.setLocalPref({ wipePending: false });
    return { ok: true, cloud: false };
  }
  try {
    await cloud.call('deleteAccount', {}, { timeout: 25000, retry: 1 });
  } catch (e) {
    // 云端删除失败就要如实告诉用户，不能假装删了
    return { ok: false, message: String((e && (e.message || e.errMsg)) || e) };
  }
  store.clearAll();
  store.setLocalPref({ wipePending: false });
  store.setConsent({ version: 0, sensitive: false, trackOptIn: false });
  store.saveSyncMeta({ lastSyncAt: 0, migrated: true, dirty: {} });
  setState({ status: 'ok', lastSyncAt: 0, pending: 0 });
  return { ok: true, cloud: true };
}

/** 同意记录也要落到服务端，作为合规留痕（不同意也能本地使用） */
async function pushConsent(patch) {
  const before = store.getConsent().sensitive;
  const consent = store.setConsent(patch || {});

  // 从「未授权」切到「已授权」：把本机已有的成员卡补推一次
  if (consent.sensitive && !before && store.getLocalPrefs().cloudSync !== false) {
    store.markDirty('members');
  }

  if (!cfg.cloudEnabled() || store.getLocalPrefs().cloudSync === false) return consent;
  try {
    await cloud.call('consent', {
      consentVersion: consent.version,
      sensitiveConsent: consent.sensitive,
      trackOptIn: consent.trackOptIn
    }, { timeout: 8000, retry: 0 });
  } catch (e) {}
  return consent;
}

/**
 * 撤回敏感信息授权：云端成员卡由服务端物理删除，本机记录保留由用户自行处理。
 * @returns {{ok:boolean, purged:number, cloud:boolean}}
 */
async function revokeSensitive() {
  const before = store.getConsent();
  store.setConsent({ sensitive: false });
  if (!cfg.cloudEnabled() || store.getLocalPrefs().cloudSync === false) {
    return { ok: true, purged: 0, cloud: false };
  }
  try {
    const res = await cloud.call('consent', {
      consentVersion: before.version,
      sensitiveConsent: false,
      trackOptIn: before.trackOptIn
    }, { timeout: 15000, retry: 1 });
    return { ok: true, purged: Number(res.purgedMembers) || 0, cloud: true };
  } catch (e) {
    return { ok: false, purged: 0, cloud: true, message: String((e && (e.message || e.errMsg)) || e) };
  }
}

function setCloudSync(enabled) {
  store.setLocalPref({ cloudSync: !!enabled });
  if (enabled) {
    state.bootstrapped = false;
    bootstrap();
  } else {
    setState({ mode: 'local', status: 'disabled' });
  }
  emit();
}

module.exports = {
  bootstrap,
  syncNow,
  syncOnShow,
  scheduleFlush,
  status,
  subscribe,
  login,
  exportData,
  deleteAccount,
  pushConsent,
  revokeSensitive,
  setCloudSync,
  ALL_COLLECTIONS,
  // 供 Node 单测直接验证合并策略（页面不调用）
  __test: {
    mergeRecords: mergeRecords,
    mergeSet: mergeSet,
    mergeObject: mergeObject,
    buildChanges: buildChanges,
    kindOf: kindOf
  }
};
