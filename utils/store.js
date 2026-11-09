// 本地数据层：全部走 wx.setStorageSync，无网络请求、无登录、无云能力。
// 数据上云时只需替换本文件的读写实现，页面层调用方式不变。
const rules = require('../data/rules.js');
const items = require('../data/items.js');
const socialItems = require('../data/social-items.js');
const date = require('./date.js');

const KEYS = {
  events: 'ld_events',
  tasks: 'ld_tasks',
  members: 'ld_members',
  favorites: 'ld_favorites',
  receipts: 'ld_receipts',
  settings: 'ld_settings',
  history: 'ld_search_history',
  track: 'ld_track'
};

// 两本书的条目共用一张表：id 前缀 rq 为人情世故指南，其余为高性价比人生
const ITEM_MAP = {};
items.forEach(it => { ITEM_MAP[it.id] = it; });
socialItems.forEach(it => { ITEM_MAP[it.id] = it; });

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    wx.showToast({ title: '本地空间不足', icon: 'none' });
    return false;
  }
}

function uid(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
}

/** 条目出处按书区分，避免把人情世故的建议标成主书 */
function itemBasis(itemId) {
  return String(itemId).indexOf('rq') === 0
    ? '《人情世故指南》第 ' + String(itemId).slice(2) + ' 条'
    : '《高性价比人生指南》第 ' + itemId + ' 条';
}

// ---------------- 事件与时限任务 ----------------

function getEvents() {
  const list = read(KEYS.events, []);
  return Array.isArray(list) ? list : [];
}

function getTasks() {
  const list = read(KEYS.tasks, []);
  return Array.isArray(list) ? list : [];
}

function saveEvents(list) { return write(KEYS.events, list); }
function saveTasks(list) { return write(KEYS.tasks, list); }

function findEventTemplate(key) {
  return rules.events.filter(e => e.key === key)[0] || null;
}

/**
 * 由一个事件模板生成 Event + Task 列表。
 * hard rule（有法定时限）按 computeDeadline 计算；
 * action（书中建议）不生成任何日期，只作为可勾选、可自定提醒的清单项。
 */
function createEvent(key, anchorDate, note, memberId) {
  const tpl = findEventTemplate(key);
  if (!tpl) return null;

  const now = Date.now();
  const event = {
    id: uid('ev'),
    type: key,
    name: tpl.name,
    anchorDate: anchorDate || date.today(),
    anchorLabel: tpl.anchorLabel,
    note: note || '',
    memberId: memberId || '',
    status: 'active',
    createdAt: now
  };

  const tasks = [];
  (tpl.rules || []).forEach(rule => {
    const calc = date.computeDeadline(rule, event.anchorDate);
    tasks.push({
      id: uid('tk'),
      eventId: event.id,
      ruleId: rule.id,
      kind: 'deadline',
      title: rule.title,
      deadline: calc.date,
      deadlineLabel: calc.label,
      deadlineNote: calc.note,
      needsAnchor: calc.needsAnchor,
      workdayApprox: calc.workdayApprox,
      anchorPrompt: rule.anchorPrompt || '',
      anchorDate: '',
      obligor: (rule.deadline || {}).obligor || '',
      materials: rule.materials || [],
      cite: rule.cite || '',
      basis: rule.basis || '',
      official: rule.official || '',
      variance: rule.variance || 'low',
      status: 'pending',
      remindAt: '',
      customRemind: '',
      receiptIds: [],
      createdAt: now
    });
  });

  (tpl.actions || []).forEach(itemId => {
    const it = ITEM_MAP[itemId];
    tasks.push({
      id: uid('tk'),
      eventId: event.id,
      itemId: itemId,
      kind: 'action',
      title: it ? it.t : '书中条目 ' + itemId,
      deadline: null,
      deadlineLabel: '书中建议 · 无法定时限',
      deadlineNote: '这条来自原书，不是法定时限。需要提醒可以自己设一个日期。',
      needsAnchor: false,
      workdayApprox: false,
      obligor: '',
      materials: [],
      cite: itemId,
      basis: itemBasis(itemId),
      official: '',
      variance: '',
      status: 'pending',
      remindAt: '',
      customRemind: '',
      receiptIds: [],
      createdAt: now
    });
  });

  const events = getEvents();
  events.unshift(event);
  saveEvents(events);
  saveTasks(getTasks().concat(tasks));
  track('event_create', { event_type: key });
  return { event, tasks };
}

function updateTask(id, patch) {
  const list = getTasks();
  let changed = null;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === id) {
      list[i] = Object.assign({}, list[i], patch, { updatedAt: Date.now() });
      changed = list[i];
      break;
    }
  }
  if (!changed) return null;
  saveTasks(list);
  syncEventStatus(changed.eventId);
  return changed;
}

// 补填计时起点后重新计算截止日
function setTaskAnchor(id, anchorDate) {
  const list = getTasks();
  const target = list.filter(t => t.id === id)[0];
  if (!target) return null;
  const tpl = findEventTemplate((getEvents().filter(e => e.id === target.eventId)[0] || {}).type);
  const rule = tpl ? (tpl.rules || []).filter(r => r.id === target.ruleId)[0] : null;
  if (!rule) return null;
  const calc = date.computeDeadline(Object.assign({}, rule, { anchorMode: 'event' }), anchorDate);
  return updateTask(id, {
    anchorDate: anchorDate,
    deadline: calc.date,
    deadlineLabel: calc.label,
    deadlineNote: calc.note,
    needsAnchor: false
  });
}

function toggleTaskDone(id) {
  const t = getTasks().filter(x => x.id === id)[0];
  if (!t) return null;
  if (t.status === 'done') {
    track('task_undone', { task_id: id });
    return updateTask(id, { status: 'pending', doneAt: '' });
  }
  const overdue = t.deadline ? Math.max(0, -date.diffDays(date.today(), t.deadline)) : 0;
  track('task_done', { task_id: id, overdue_days: overdue });
  return updateTask(id, { status: 'done', doneAt: Date.now(), overdueDays: overdue });
}

function syncEventStatus(eventId) {
  const events = getEvents();
  const ev = events.filter(e => e.id === eventId)[0];
  if (!ev) return;
  const tasks = getTasks().filter(t => t.eventId === eventId);
  const allDone = tasks.length > 0 && tasks.every(t => t.status === 'done' || t.status === 'archived');
  const next = allDone ? 'completed' : 'active';
  if (ev.status !== next) {
    ev.status = next;
    saveEvents(events);
  }
}

function archiveEvent(id) {
  const events = getEvents();
  events.forEach(e => { if (e.id === id) e.status = 'archived'; });
  saveEvents(events);
}

function deleteEvent(id) {
  const events = getEvents();
  const ev = events.filter(e => e.id === id)[0];
  if (!ev) return { ok: false, reason: 'NOT_FOUND' };
  const days = Math.floor((Date.now() - ev.createdAt) / 86400000);
  if (days > 7) return { ok: false, reason: 'TOO_OLD' };
  saveEvents(events.filter(e => e.id !== id));
  saveTasks(getTasks().filter(t => t.eventId !== id));
  return { ok: true };
}

// 条目转待办：不属于任何事件，可不设提醒（进入无期限分组）
function addItemTask(itemId, customRemind) {
  const it = ITEM_MAP[itemId];
  if (!it) return null;
  const task = {
    id: uid('tk'),
    eventId: '',
    itemId: itemId,
    kind: 'action',
    title: it.t,
    deadline: customRemind || null,
    deadlineLabel: customRemind ? '自定义提醒日' : '书中建议 · 无期限',
    deadlineNote: customRemind ? '这是你自己设的提醒日，不是法定时限。' : '没有设定提醒，归在「无期限待办」。',
    needsAnchor: false,
    workdayApprox: false,
    obligor: '',
    materials: [],
    cite: itemId,
    basis: itemBasis(itemId),
    official: '',
    variance: '',
    status: 'pending',
    remindAt: customRemind || '',
    customRemind: customRemind || '',
    receiptIds: [],
    createdAt: Date.now()
  };
  const list = getTasks();
  // 同一条目不可重复添加
  if (list.some(t => t.itemId === itemId && !t.eventId)) return null;
  list.push(task);
  saveTasks(list);
  track('item_to_task', { item_id: itemId, has_remind: !!customRemind });
  return task;
}

function isItemInTask(itemId) {
  return getTasks().some(t => t.itemId === itemId && !t.eventId && t.status !== 'archived');
}

// ---------------- 收藏 / 成员 / 回执 / 设置 ----------------

function getFavorites() { const v = read(KEYS.favorites, []); return Array.isArray(v) ? v : []; }
function toggleFavorite(itemId) {
  let list = getFavorites();
  const had = list.indexOf(itemId) >= 0;
  list = had ? list.filter(x => x !== itemId) : [itemId].concat(list);
  write(KEYS.favorites, list);
  track(had ? 'item_unfavorite' : 'item_favorite', { item_id: itemId });
  return !had;
}
function isFavorite(itemId) { return getFavorites().indexOf(itemId) >= 0; }

function getMembers() { const v = read(KEYS.members, []); return Array.isArray(v) ? v : []; }
function saveMembers(list) { return write(KEYS.members, list); }
function addMember(payload) {
  const list = getMembers();
  const member = {
    id: uid('mb'),
    name: (payload.name || '').trim(),
    age: Number(payload.age) || 0,
    gender: payload.gender || '',
    conditions: payload.conditions || [],
    bindStatus: 'unbound',
    createdAt: Date.now()
  };
  list.push(member);
  saveMembers(list);
  track('member_create', { age_band: member.age >= 60 ? 'senior' : 'adult' });
  return member;
}
function removeMember(id) {
  const list = getMembers().filter(m => m.id !== id);
  saveMembers(list);
  return list;
}

function getReceipts() { const v = read(KEYS.receipts, []); return Array.isArray(v) ? v : []; }
function addReceipt(taskId, note, paths) {
  const list = getReceipts();
  const r = { id: uid('rc'), taskId: taskId, note: note || '', images: (paths || []).slice(0, 5), createdAt: Date.now() };
  list.unshift(r);
  write(KEYS.receipts, list);
  updateTask(taskId, { receiptIds: getReceipts().filter(x => x.taskId === taskId).map(x => x.id) });
  track('receipt_add', { task_id: taskId });
  return r;
}

function getSettings() {
  return Object.assign({ elderMode: false, notifyHintDismissed: false, disclaimerAccepted: false }, read(KEYS.settings, {}));
}
function saveSettings(patch) {
  const next = Object.assign(getSettings(), patch);
  write(KEYS.settings, next);
  return next;
}

function getSearchHistory() { const v = read(KEYS.history, []); return Array.isArray(v) ? v : []; }
function pushSearchHistory(kw) {
  let list = getSearchHistory().filter(x => x !== kw);
  list = [kw].concat(list).slice(0, 10);
  write(KEYS.history, list);
  return list;
}
function clearSearchHistory() { write(KEYS.history, []); }

// ---------------- 埋点（本地累计，静态版不上报） ----------------

function track(name, payload) {
  const all = read(KEYS.track, {});
  const bucket = all[name] || { count: 0, lastAt: 0 };
  bucket.count += 1;
  bucket.lastAt = Date.now();
  bucket.lastPayload = payload || {};
  all[name] = bucket;
  write(KEYS.track, all);
}
function getTrack() { return read(KEYS.track, {}); }

// ---------------- 首页聚合 ----------------

function decorateTask(t) {
  const rel = t.deadline ? date.relativeLabel(t.deadline) : '';
  return Object.assign({}, t, {
    relLabel: rel,
    bucket: t.deadline ? date.bucket(t.deadline) : 'no_deadline',
    isOverdue: !!t.deadline && date.bucket(t.deadline) === 'overdue',
    statusText: { pending: '待办', reminded: '已提醒', done: '已完成', archived: '已归档' }[t.status] || '待办'
  });
}

function getOpenTasks() {
  return getTasks()
    .filter(t => t.status !== 'archived')
    .map(decorateTask)
    .sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (b.status === 'done' && a.status !== 'done') return -1;
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
}

function getDashboard() {
  const events = getEvents().filter(e => e.status !== 'archived');
  const tasks = getOpenTasks().filter(t => t.status !== 'done');
  const week = tasks.filter(t => t.bucket === 'week').length;
  const overdue = tasks.filter(t => t.bucket === 'overdue').length;
  return {
    activeEvents: events.filter(e => e.status === 'active'),
    completedEvents: events.filter(e => e.status === 'completed'),
    weekCount: week,
    overdueCount: overdue,
    openCount: tasks.length,
    upcoming: tasks.slice(0, 3)
  };
}

// 每日一条：按日期索引，同一天所有人看到同一条，离线可用
function dailyItem() {
  const d = date.today().split('-');
  const seed = Number(d[0]) * 372 + Number(d[1]) * 31 + Number(d[2]);
  return items[seed % items.length];
}

function itemById(id) { return ITEM_MAP[id] || null; }

function clearAll() {
  Object.keys(KEYS).forEach(k => { try { wx.removeStorageSync(KEYS[k]); } catch (e) {} });
}

module.exports = {
  KEYS, ITEM_MAP, read, write, uid, itemBasis,
  getEvents, getTasks, saveEvents, saveTasks, findEventTemplate,
  createEvent, updateTask, setTaskAnchor, toggleTaskDone,
  archiveEvent, deleteEvent, decorateTask, getOpenTasks,
  addItemTask, isItemInTask,
  getFavorites, toggleFavorite, isFavorite,
  getMembers, saveMembers, addMember, removeMember,
  getReceipts, addReceipt,
  getSettings, saveSettings,
  getSearchHistory, pushSearchHistory, clearSearchHistory,
  track, getTrack,
  getDashboard, dailyItem, itemById, clearAll
};
