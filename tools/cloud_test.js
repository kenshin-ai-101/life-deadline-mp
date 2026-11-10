// 云端数据层单测（不依赖微信云环境，直接跑纯函数）
// 覆盖：文档 id 隔离、敏感字段加密、墓碑语义、增量合并策略、端到端推拉一致性。
// 运行：node tools/cloud_test.js
const schema = require('../cloudfunctions/dataSync/lib/schema.js');
const shape = require('../cloudfunctions/dataSync/lib/shape.js');
const cryptoUtil = require('../cloudfunctions/dataSync/lib/crypto.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(name + (extra ? ' → ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? ' → ' + extra : ''));
    return;
  }
  console.log('  ✓ ' + name);
}

const OPENID_A = 'oABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
const OPENID_B = 'oZYXWVUTSRQPONMLKJIHGFEDCBA9876';
const SECRET = 'unit-test-secret';
const KEY_A = cryptoUtil.keyFor(SECRET, OPENID_A);
const KEY_B = cryptoUtil.keyFor(SECRET, OPENID_B);

console.log('\n[1] 文档 id 隔离');
const idA = shape.docId(OPENID_A, 'favorites', '01-1');
const idA2 = shape.docId(OPENID_A, 'favorites', '01-1');
const idB = shape.docId(OPENID_B, 'favorites', '01-1');
ok('同一用户同一主键生成稳定 _id', idA === idA2, idA + ' vs ' + idA2);
ok('不同用户的同一主键互不冲突', idA !== idB);
ok('_id 是 32 位十六进制', /^[0-9a-f]{32}$/.test(idA), idA);

console.log('\n[2] 敏感字段加密（members）');
const member = {
  id: 'mb-1',
  name: '妈妈',
  age: 68,
  gender: '女',
  conditions: ['高血压', '糖尿病'],
  bindStatus: 'unbound',
  createdAt: 1700000000000
};
const memberDocs = shape.normalizeChanges('members', { upserts: [member], deletes: [] }, OPENID_A, KEY_A);
ok('一条成员生成一条文档', memberDocs.length === 1);
const md = memberDocs[0];
ok('明文档里不含姓名', !JSON.stringify(md.rec).includes('妈妈'), JSON.stringify(md.rec));
ok('明文档里不含状况', !JSON.stringify(md.rec).includes('高血压'));
ok('密文里也看不到明文', !JSON.stringify(md.pii).includes('妈妈'));
ok('非敏感字段仍可索引', md.rec.bindStatus === 'unbound' && md.rec.id === 'mb-1');
ok('文档带 _openid 归属', md._openid === OPENID_A);

const wire = shape.toWire(md, KEY_A);
ok('用正确密钥可还原全部敏感字段',
  wire.rec.name === '妈妈' && wire.rec.age === 68 && wire.rec.conditions.length === 2,
  JSON.stringify(wire.rec));
ok('客户端拿不到密文字段', wire.pii === undefined);

const wrong = shape.toWire(md, KEY_B);
ok('换别人的密钥解不开（返回不含明文的记录）', !wrong.rec || wrong.rec.name === undefined,
  JSON.stringify(wrong.rec));

console.log('\n[3] 墓碑与删除');
const delDocs = shape.normalizeChanges('members', { upserts: [], deletes: ['mb-1'] }, OPENID_A, KEY_A);
ok('删除生成软删文档', delDocs.length === 1 && delDocs[0].deleted === true && delDocs[0].rec === null);
ok('删除的 _id 与 upsert 一致（同一行）', delDocs[0]._id === md._id);
const wireDel = shape.toWire(delDocs[0], KEY_A);
ok('软删文档下发时带 deleted 标记', wireDel.deleted === true && wireDel.rec === null);

console.log('\n[4] 三种集合形态');
const setDocs = shape.normalizeChanges('favorites', { upserts: ['01-1', '01-2', '01-1'], deletes: [] }, OPENID_A, KEY_A);
ok('set 型去重后两条', setDocs.length === 2, String(setDocs.length));
const setDel = shape.normalizeChanges('favorites', { upserts: [], deletes: ['01-1'] }, OPENID_A, KEY_A);
ok('set 型删除按值生成墓碑', setDel.length === 1 && setDel[0].key === '01-1' && setDel[0].deleted);

const objDocs = shape.normalizeChanges('settings', { upserts: { elderMode: true }, deletes: [] }, OPENID_A, KEY_A);
ok('object 型固定单条 key', objDocs.length === 1 && objDocs[0].key === schema.SINGLETON_KEY);
const objDel = shape.normalizeChanges('settings', { upserts: [], deletes: ['default'] }, OPENID_A, KEY_A);
ok('object 型删除同样生成单条', objDel.length === 1 && objDel[0].deleted);

console.log('\n[5] 同批冲突：后出现的覆盖先出现的');
const conflict = shape.normalizeChanges('events', {
  upserts: [{ id: 'ev-1', name: 'A' }],
  deletes: ['ev-1']
}, OPENID_A, KEY_A);
ok('同 key 的删除覆盖 upsert', conflict.length === 1 && conflict[0].deleted === true);

console.log('\n[6] 单次推送上限');
const many = [];
for (let i = 0; i < 600; i += 1) many.push({ id: 'ev-' + i, name: 'E' + i });
const capped = shape.normalizeChanges('events', { upserts: many, deletes: [] }, OPENID_A, KEY_A);
ok('超过上限被截断到 MAX_PUSH_DOCS', capped.length === schema.MAX_PUSH_DOCS, String(capped.length));

console.log('\n[7] 回写为本地形态');
const docs = [
  { key: 'ev-1', rec: { id: 'ev-1', name: '旧' }, deleted: false, updatedAt: 100 },
  { key: 'ev-2', rec: { id: 'ev-2', name: '新' }, deleted: false, updatedAt: 300 },
  { key: 'ev-3', rec: null, deleted: true, updatedAt: 400 }
];
const localRecords = shape.toLocalValue('events', docs);
ok('记录按 updatedAt 倒序', localRecords[0].id === 'ev-2', JSON.stringify(localRecords.map(r => r.id)));
ok('软删记录不出现在结果里', localRecords.length === 2);

const setLocal = shape.toLocalValue('favorites', [
  { key: '01-1', deleted: false, updatedAt: 100 },
  { key: '01-2', deleted: true, updatedAt: 200 }
]);
ok('set 型过滤墓碑并保序', setLocal.length === 1 && setLocal[0] === '01-1', JSON.stringify(setLocal));

const objLocal = shape.toLocalValue('settings', [
  { key: 'default', rec: { elderMode: true }, deleted: false, updatedAt: 100 }
]);
ok('object 型还原成对象', objLocal.elderMode === true);

console.log('\n[8] 客户端增量合并策略');
const sync = require('../utils/sync.js');
const t = sync.__test;

const localEv = [
  { id: 'ev-1', name: '本机旧值', status: 'active' },
  { id: 'ev-2', name: '只在本地' }
];
const merged = t.mergeRecords(localEv, [
  { key: 'ev-1', rec: { id: 'ev-1', name: '云端新值' }, deleted: false, updatedAt: 500 },
  { key: 'ev-3', rec: { id: 'ev-3', name: '云端新增' }, deleted: false, updatedAt: 600 }
]);
ok('同主键被云端值覆盖', merged.filter(r => r.id === 'ev-1')[0].name === '云端新值');
ok('本地独有记录不丢', merged.some(r => r.id === 'ev-2'));
ok('云端新增到列表', merged.some(r => r.id === 'ev-3'));
ok('新增排在前面', merged[0].id === 'ev-3', merged[0].id);

const mergedDel = t.mergeRecords(localEv, [
  { key: 'ev-2', rec: null, deleted: true, updatedAt: 700 }
]);
ok('远端墓碑会删掉本地记录', !mergedDel.some(r => r.id === 'ev-2'));

const setMerged = t.mergeSet(['01-1', '01-2'], [
  { key: '01-3', deleted: false, updatedAt: 100 },
  { key: '01-1', deleted: true, updatedAt: 200 }
]);
ok('set 合并为并集', setMerged.indexOf('01-3') >= 0 && setMerged.indexOf('01-2') >= 0);
ok('set 合并移除远端墓碑', setMerged.indexOf('01-1') < 0, JSON.stringify(setMerged));
ok('set 合并不产生重复', new Set(setMerged).size === setMerged.length);

const objMerged = t.mergeObject({ elderMode: false, notifyHintDismissed: true }, [
  { key: 'default', rec: { elderMode: true }, deleted: false, updatedAt: 1 }
]);
ok('object 浅合并保留未涉及的字段', objMerged.elderMode === true && objMerged.notifyHintDismissed === true);

console.log('\n[9] 端到端：本机 → 云端 → 本机');
const localEvents = [{ id: 'ev-9', name: '离婚冷静期', anchorDate: '2026-11-01', status: 'active' }];
const pushDocs = shape.normalizeChanges('events', { upserts: localEvents, deletes: [] }, OPENID_A, KEY_A)
  .map(d => Object.assign({}, d, { updatedAt: 1000 }));
const roundTrip = shape.toLocalValue('events', pushDocs.map(d => shape.toWire(d, KEY_A)));
ok('推上去再拉下来内容不变',
  JSON.stringify(roundTrip[0]) === JSON.stringify(localEvents[0]),
  JSON.stringify(roundTrip[0]));

const memberPush = shape.normalizeChanges('members', { upserts: [member], deletes: [] }, OPENID_A, KEY_A)
  .map(d => Object.assign({}, d, { updatedAt: 1000 }));
const memberBack = shape.toLocalValue('members', memberPush.map(d => shape.toWire(d, KEY_A)));
ok('成员卡加密往返后字段完整',
  memberBack[0].name === '妈妈' && memberBack[0].age === 68 && memberBack[0].conditions[0] === '高血压',
  JSON.stringify(memberBack[0]));

console.log('\n[10] 集合声明一致性');
const CLIENT_COLS = sync.ALL_COLLECTIONS.slice().sort();
const SERVER_COLS = Object.keys(schema.COLLECTIONS).sort();
ok('客户端与云函数的集合清单一致',
  JSON.stringify(CLIENT_COLS) === JSON.stringify(SERVER_COLS),
  CLIENT_COLS.join(',') + ' vs ' + SERVER_COLS.join(','));
ok('每个集合都有物理表名与形态', SERVER_COLS.every(c => schema.physicalOf(c) && schema.kindOf(c)));
ok('只有成员表有敏感字段', Object.keys(schema.SENSITIVE_FIELDS).join(',') === 'members');

console.log('\n[11] 敏感信息授权门禁');
// 用内存模拟本机 storage，验证「没同意就不上传、撤回后不再拉回」
const memStore = {};
global.wx = {
  getStorageSync: k => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : ''),
  setStorageSync: (k, v) => { memStore[k] = v; },
  removeStorageSync: k => { delete memStore[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(memStore), currentSize: 0, limitSize: 10240 })
};
const store = require('../utils/store.js');

store.setConsent({ sensitive: false });
store.addMember({ name: '妈妈', age: 68, gender: '女', conditions: ['高血压'] });
store.saveEvents([{ id: 'ev-t1', name: '陪妈妈复查', anchorDate: '2026-12-01', status: 'active' }]);

const cNo = sync.__test.buildChanges(['members', 'events']);
ok('未授权时成员卡不进同步包', cNo.members === undefined, JSON.stringify(Object.keys(cNo)));
ok('未授权不影响其他集合同步', !!cNo.events && cNo.events.upserts.length === 1);

store.setConsent({ sensitive: true });
const cYes = sync.__test.buildChanges(['members']);
ok('授权后成员卡进入同步包', !!cYes.members && cYes.members.upserts.length === 1,
  JSON.stringify(cYes.members && cYes.members.upserts.length));
ok('授权后成员卡仍带明文（加密在服务端做）',
  cYes.members.upserts[0].name === '妈妈');

store.setConsent({ sensitive: false });
ok('撤回后 sensitiveAt 清零', store.getConsent().sensitiveAt === 0);
const cBack = sync.__test.buildChanges(['members']);
ok('撤回后再次停止上传', cBack.members === undefined);
ok('撤回后本机成员卡仍在（不替用户删本地数据）', store.getMembers().length === 1);

// ---- 写失败不能静默丢数据（线上踩过：云函数 set() 的 data 带 _id 导致整批写入失败，
//      客户端却把脏标记清了，本地数据再也没上云）----
const T0 = 1000;
const nd1 = sync.__test.nextDirty({ events: 900, tasks: 900 }, ['events', 'tasks'], ['events'], T0 + 100);
ok('写失败的集合保留脏标记（下轮重试）', !!nd1.events, JSON.stringify(nd1));
ok('写成功的集合清掉脏标记', nd1.tasks === undefined, JSON.stringify(nd1));

const nd2 = sync.__test.nextDirty({ events: 1200 }, ['events'], [], T0);
ok('同步期间的新改动不被清掉', nd2.events === 1200, JSON.stringify(nd2));

const nd3 = sync.__test.nextDirty({ events: 800 }, ['events'], [], T0);
ok('同步前的旧脏标记正常清除', nd3.events === undefined, JSON.stringify(nd3));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败用例：');
  failures.forEach(f => console.log(' - ' + f));
  process.exit(1);
}
