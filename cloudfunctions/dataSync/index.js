// 云函数 dataSync —— 唯一的数据出入口。
// 客户端不直连数据库（安全规则全部拒绝直连），所有读写都经过这里，openid 由云函数上下文提供，
// 客户端无法伪造身份，也就无法读写别人的数据。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const schema = require('./lib/schema.js');
const shape = require('./lib/shape.js');
const cryptoUtil = require('./lib/crypto.js');

const USERS = 'ld_users';
const TRACK = 'ld_track';

function userDocId(openid) {
  return shape.docId(openid, 'user', 'profile');
}

function publicUser(doc) {
  if (!doc) return { migrated: false, consentVersion: 0, sensitiveConsent: false, trackOptIn: false };
  return {
    migrated: !!doc.migrated,
    consentVersion: doc.consentVersion || 0,
    sensitiveConsent: !!doc.sensitiveConsent,
    trackOptIn: !!doc.trackOptIn,
    createdAt: doc.createdAt || 0,
    lastActiveAt: doc.lastActiveAt || 0
  };
}

async function ensureUser(openid, openidHint) {
  const id = userDocId(openid);
  try {
    const res = await db.collection(USERS).doc(id).get();
    // 只更新活跃时间，不覆盖其他字段
    db.collection(USERS).doc(id).update({ data: { lastActiveAt: Date.now() } }).catch(() => {});
    return res.data;
  } catch (e) {
    const doc = {
      _id: id,
      _openid: openid,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      migrated: false,
      consentVersion: 0,
      sensitiveConsent: false,
      trackOptIn: false,
      deleted: false
    };
    try {
      await db.collection(USERS).add({ data: doc });
    } catch (err) {
      // 并发首次登录可能撞车，吞掉重复键错误
      if (!/duplicate|exist/i.test(String(err && err.message))) throw err;
    }
    return doc;
  }
}

/**
 * 敏感信息未授权时的硬约束：成员卡一张都不留。
 * 撤回授权要真的把库里的密文删掉，只改标志位等于欺骗用户。
 */
async function purgeMembers(openid) {
  const physical = schema.physicalOf('members');
  let total = 0;
  for (;;) {
    const res = await db.collection(physical).where({ _openid: openid }).remove();
    const n = (res.stats && res.stats.removed) || 0;
    total += n;
    if (!n) break;
  }
  return total;
}

/** 分批取某一集合里 updatedAt >= since 的文档，最多 MAX_PULL_DOCS 条 */
async function pullCollection(col, openid, since, limit) {
  const physical = schema.physicalOf(col);
  const out = [];
  let skip = 0;
  const size = schema.PAGE_SIZE;
  for (;;) {
    const res = await db
      .collection(physical)
      .where({ _openid: openid, updatedAt: _.gte(since) })
      .orderBy('updatedAt', 'asc')
      .skip(skip)
      .limit(Math.min(size, limit - out.length))
      .get();
    const rows = res.data || [];
    rows.forEach(r => out.push(r));
    if (rows.length < size || out.length >= limit) break;
    skip += rows.length;
  }
  return out;
}

/** 写文档：last-write-wins，updatedAt 一律用服务端时间，避免多端时钟偏差 */
async function writeDocs(col, docs, now) {
  if (!docs.length) return 0;
  const physical = schema.physicalOf(col);
  let written = 0;
  const chunk = 20;
  for (let i = 0; i < docs.length; i += chunk) {
    const part = docs.slice(i, i + chunk);
    await Promise.all(
      part.map(d =>
        db
          .collection(physical)
          .doc(d._id)
          .set({
            data: Object.assign({}, d, { updatedAt: now, updatedLocalAt: d.updatedLocalAt || 0 })
          })
          .then(() => { written += 1; })
          .catch(err => {
            console.error('write fail', physical, d._id, err && err.message);
          })
      )
    );
  }
  return written;
}

async function handleSync(event, openid) {
  const user = await ensureUser(openid);
  if (user.deleted) {
    return { ok: false, code: 'ACCOUNT_DELETED' };
  }
  const secret = cryptoUtil.secretOf(process.env);
  const key = cryptoUtil.keyFor(secret, openid);
  const now = Date.now();

  // 1) 先把客户端的增量写进库
  const changes = event.changes && typeof event.changes === 'object' ? event.changes : {};
  const sensitiveOk = !!user.sensitiveConsent;
  let applied = 0;
  // 服务端兜底：客户端没权限推的集合，这里一律拒收并回传，由客户端重新标脏
  const blocked = [];
  const cols = Object.keys(changes).filter(schema.isCollection);
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i];
    if (col === 'members' && !sensitiveOk) { blocked.push(col); continue; }
    const docs = shape.normalizeChanges(col, changes[col], openid, key).map(d =>
      Object.assign({}, d, { updatedLocalAt: Number((changes[col] || {}).localAt) || 0 })
    );
    applied += await writeDocs(col, docs, now);
  }

  // 2) 再把 since 之后的变更拉回给客户端
  const since = Number(event.since) || 0;
  const collections = {};
  let budget = schema.MAX_PULL_DOCS;
  let hasMore = false;
  const allCols = Object.keys(schema.COLLECTIONS);
  for (let i = 0; i < allCols.length; i += 1) {
    const col = allCols[i];
    // 未授权就不下发成员卡，避免"撤回了却又被别的设备拉回来"
    if (col === 'members' && !sensitiveOk) { collections[col] = []; continue; }
    if (budget <= 0) { hasMore = true; break; }
    const docs = await pullCollection(col, openid, since, budget);
    if (docs.length >= budget) hasMore = true;
    budget -= docs.length;
    collections[col] = docs.map(d => shape.toWire(d, key));
  }

  return {
    ok: true,
    applied: applied,
    collections: collections,
    blocked: blocked,
    hasMore: hasMore,
    serverTime: now,
    user: publicUser(user)
  };
}

async function handleLogin(event, openid) {
  const user = await ensureUser(openid);
  return { ok: true, openid: openid, user: publicUser(user), serverTime: Date.now() };
}

/** 首次迁移完成的幂等标记：重复调用无副作用 */
async function handleMarkMigrated(event, openid) {
  await ensureUser(openid);
  await db.collection(USERS).doc(userDocId(openid)).update({
    data: { migrated: true, migratedAt: Date.now() }
  });
  return { ok: true, migrated: true };
}

async function handleSetConsent(event, openid) {
  const user = await ensureUser(openid);
  const id = userDocId(openid);
  const sensitiveConsent = !!event.sensitiveConsent;
  const patch = {
    consentVersion: Number(event.consentVersion) || 0,
    consentAt: Date.now(),
    sensitiveConsent: sensitiveConsent,
    sensitiveConsentAt: sensitiveConsent ? Date.now() : 0,
    trackOptIn: !!event.trackOptIn
  };
  await db.collection(USERS).doc(id).update({ data: patch });
  // 撤回敏感授权 = 立即物理删除云端成员卡，不等下一次同步
  let purgedMembers = 0;
  if (!sensitiveConsent) {
    try {
      purgedMembers = await purgeMembers(openid);
    } catch (e) {
      console.error('[dataSync] purgeMembers fail', e && e.message);
    }
  }
  return {
    ok: true,
    user: publicUser(Object.assign({}, user, patch)),
    purgedMembers: purgedMembers
  };
}

/** 只有客户端明确上报且用户已同意时才落库，且不带设备指纹 */
async function handleTrack(event, openid) {
  const user = await ensureUser(openid);
  if (!user.trackOptIn) return { ok: true, skipped: true };
  const list = Array.isArray(event.events) ? event.events.slice(0, 20) : [];
  if (!list.length) return { ok: true, count: 0 };
  const now = Date.now();
  await Promise.all(
    list.map(e =>
      db.collection(TRACK).add({
        data: {
          _openid: openid,
          name: String(e.name || '').slice(0, 64),
          payload: e.payload && typeof e.payload === 'object' ? e.payload : {},
          clientAt: Number(e.at) || 0,
          createdAt: now
        }
      }).catch(() => null)
    )
  );
  return { ok: true, count: list.length };
}

async function handleExport(event, openid) {
  const secret = cryptoUtil.secretOf(process.env);
  const key = cryptoUtil.keyFor(secret, openid);
  const out = { exportedAt: new Date().toISOString(), openid: openid, collections: {} };
  const cols = Object.keys(schema.COLLECTIONS);
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i];
    const physical = schema.physicalOf(col);
    const all = [];
    let skip = 0;
    for (;;) {
      const res = await db
        .collection(physical)
        .where({ _openid: openid, deleted: _.neq(true) })
        .skip(skip)
        .limit(schema.PAGE_SIZE)
        .get();
      const rows = res.data || [];
      rows.forEach(r => all.push(r));
      if (rows.length < schema.PAGE_SIZE) break;
      skip += rows.length;
      if (skip > 20000) break;
    }
    out.collections[col] = all.map(d => shape.toWire(d, key));
  }
  return { ok: true, data: out };
}

/** 物理删除该用户的全部业务文档（不含用户档案与授权记录） */
async function purgeCollections(openid) {
  const cols = Object.keys(schema.COLLECTIONS);
  const removed = {};
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i];
    const physical = schema.physicalOf(col);
    let total = 0;
    for (;;) {
      const res = await db.collection(physical).where({ _openid: openid }).remove();
      const n = (res.stats && res.stats.removed) || 0;
      total += n;
      if (!n) break;
    }
    removed[col] = total;
  }
  for (;;) {
    const res = await db.collection(TRACK).where({ _openid: openid }).remove();
    if (!((res.stats && res.stats.removed) || 0)) break;
  }
  return removed;
}

/** 清空业务数据，保留账号与授权记录（用户点「清空数据」时用） */
async function handleWipe(event, openid) {
  const removed = await purgeCollections(openid);
  return { ok: true, removed: removed, serverTime: Date.now() };
}

/** 彻底删除：物理删除所有文档，不做软删，用户点删除就该真的没了 */
async function handleDeleteAccount(event, openid) {
  const removed = await purgeCollections(openid);
  // 用户文档保留一条墓碑，避免下次登录把老数据算成"新用户"而重复迁移
  await db.collection(USERS).doc(userDocId(openid)).set({
    data: {
      _id: userDocId(openid),
      _openid: openid,
      deleted: true,
      deletedAt: Date.now(),
      migrated: false,
      consentVersion: 0,
      sensitiveConsent: false,
      trackOptIn: false,
      createdAt: Date.now()
    }
  });
  return { ok: true, removed: removed };
}

/** 诊断用：不返回任何业务数据 */
async function handleHealth(event, openid) {
  const secret = cryptoUtil.secretOf(process.env);
  return {
    ok: true,
    serverTime: Date.now(),
    piiSecretConfigured: !cryptoUtil.isDefaultSecret(process.env),
    collections: Object.keys(schema.COLLECTIONS)
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  const action = (event && event.action) || 'sync';

  if (!openid) {
    return { ok: false, code: 'NO_OPENID', message: '未获取到用户身份，请在小程序内调用' };
  }

  try {
    switch (action) {
      case 'login': return await handleLogin(event, openid);
      case 'markMigrated': return await handleMarkMigrated(event, openid);
      case 'sync': return await handleSync(event, openid);
      case 'consent': return await handleSetConsent(event, openid);
      case 'track': return await handleTrack(event, openid);
      case 'export': return await handleExport(event, openid);
      case 'wipe': return await handleWipe(event, openid);
      case 'deleteAccount': return await handleDeleteAccount(event, openid);
      case 'health': return await handleHealth(event, openid);
      default:
        return { ok: false, code: 'UNKNOWN_ACTION', message: '未知操作：' + action };
    }
  } catch (err) {
    console.error('[dataSync]', action, err && err.stack ? err.stack : err);
    return { ok: false, code: 'INTERNAL', message: String((err && err.message) || err) };
  }
};
