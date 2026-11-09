/**
 * 核心链路冒烟测试（Node 环境模拟 wx 本地存储，不需要微信开发者工具）。
 * 运行：node tools/smoke_test.js
 */
const path = require('path');
const ROOT = path.dirname(__dirname);

const db = {};
global.wx = {
  getStorageSync(k) { return db[k] === undefined ? '' : JSON.parse(JSON.stringify(db[k])); },
  setStorageSync(k, v) { db[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync(k) { delete db[k]; },
  showToast() {}
};

const store = require(path.join(ROOT, 'utils/store.js'));
const date = require(path.join(ROOT, 'utils/date.js'));
const fmt = require(path.join(ROOT, 'utils/format.js'));
const rules = require(path.join(ROOT, 'data/rules.js'));
const items = require(path.join(ROOT, 'data/items.js'));
const aid = require(path.join(ROOT, 'pkg-aid/data/aid.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

console.log('\n[1] 内容与规则数据');
ok('条目 772 条', items.length === 772, String(items.length));
ok('34 节目录', require(path.join(ROOT, 'data/catalog.js')).length === 34);
ok('13 个事件模板', rules.events.length === 13, String(rules.events.length));
ok('13 张急救卡', aid.length === 13, String(aid.length));
const hard = rules.events.reduce((n, e) => n + e.rules.length, 0);
ok('已核实硬规则 10 条', hard === 10, String(hard));
ok('每条硬规则都有 basis / variance / status / verifiedAt',
  rules.events.every(e => e.rules.every(r => r.basis && r.variance && r.status && r.verifiedAt)));
ok('每条硬规则都有真实回链条目',
  rules.events.every(e => e.rules.every(r => store.itemById(r.cite))),
  JSON.stringify(rules.events.flatMap(e => e.rules.filter(r => !store.itemById(r.cite)).map(r => r.cite))));
ok('每个事件的 actions 都指向真实条目',
  rules.events.every(e => e.actions.every(id => store.itemById(id))),
  JSON.stringify(rules.events.flatMap(e => e.actions.filter(id => !store.itemById(id)))));
ok('high variance 规则不生成天数',
  rules.events.every(e => e.rules.filter(r => r.variance === 'high').every(r => r.anchorMode === 'none')));
ok('急救卡文字全部带出处且非空', aid.every(c => c.steps.length > 0 && c.steps.every(s => s.cite && s.text) && c.cites.length > 0));

console.log('\n[2] 日期与截止日计算');
ok('30 日后 = 预期', date.addDays('2026-11-09', 30) === '2026-12-09', date.addDays('2026-11-09', 30));
ok('1 年后 = 预期', date.addYears('2026-11-09', 1) === '2027-11-09');
ok('工作日跳过周末', date.addWorkdays('2026-11-09', 1) === '2026-11-10');
ok('月末溢出回落', date.addMonths('2026-01-31', 1) === '2026-02-28', date.addMonths('2026-01-31', 1));
ok('bucket 逾期判定', date.bucket('2020-01-01') === 'overdue');
const wi = store.findEventTemplate('work_injury');
const c30 = date.computeDeadline(wi.rules[0], '2026-11-09');
ok('工伤 30 日算出 2026-12-09', c30.date === '2026-12-09', c30.date);
const hi = store.findEventTemplate('childbirth').rules[1];
ok('high variance 返回 null 日期', date.computeDeadline(hi, '2026-11-09').date === null);
const manual = store.findEventTemplate('dismissal').rules[0];
ok('manual 锚点需补填', date.computeDeadline(manual, '2026-11-09').needsAnchor === true);

console.log('\n[3] 事件 → 任务 → 状态机');
const r = store.createEvent('work_injury', '2026-11-09', '测试备注');
ok('事件创建成功', !!r && !!r.event);
ok('任务数 = 硬规则 + 书中建议', r.tasks.length === 3 + 5, String(r.tasks.length));
ok('法定任务带截止日', r.tasks.filter(t => t.kind === 'deadline' && t.deadline).length === 2);
ok('书中建议不带日期', r.tasks.filter(t => t.kind === 'action').every(t => t.deadline === null));
ok('备注写入本机', store.getEvents()[0].note === '测试备注');
const first = r.tasks[0];
store.toggleTaskDone(first.id);
ok('打勾变 done', store.getTasks().filter(t => t.id === first.id)[0].status === 'done');
store.toggleTaskDone(first.id);
ok('可撤销完成', store.getTasks().filter(t => t.id === first.id)[0].status === 'pending');
const manualTask = store.createEvent('dismissal', '2026-11-09', '').tasks[0];
ok('manual 任务初始无截止日', manualTask.deadline === null && manualTask.needsAnchor === true);
store.setTaskAnchor(manualTask.id, '2026-06-01');
const updated = store.getTasks().filter(t => t.id === manualTask.id)[0];
ok('补填起点后算出 1 年期', updated.deadline === '2027-06-01', updated.deadline);
ok('补填后 needsAnchor 变 false', updated.needsAnchor === false);

console.log('\n[4] 首页聚合 / 收藏 / 待办');
const dash = store.getDashboard();
ok('进行中事件 2 个', dash.activeEvents.length === 2, String(dash.activeEvents.length));
ok('待办数 > 0', dash.openCount > 0, String(dash.openCount));
ok('每日一条稳定且非空', !!store.dailyItem() && store.dailyItem().id === store.dailyItem().id);
ok('收藏可切换', store.toggleFavorite('19-11') === true && store.isFavorite('19-11') === true);
ok('取消收藏', store.toggleFavorite('19-11') === false && store.isFavorite('19-11') === false);
const t = store.addItemTask('19-11', '2026-12-01');
ok('条目可转待办并设提醒', !!t && t.customRemind === '2026-12-01');
ok('同一条目不可重复添加', store.addItemTask('19-11', '') === null);

console.log('\n[5] 检索 / 筛选 / 家庭清单');
ok('关键词检索命中', fmt.search('工伤认定').length > 0, String(fmt.search('工伤认定').length));
ok('标题命中优先', fmt.search('系安全带')[0].id === '01-1', fmt.search('系安全带')[0].id);
ok('争议筛选只出争议条目', fmt.search('', { disputed: true }).every(x => x.disputed));
ok('口径筛选生效', fmt.search('', { lens: '死亡率' }).every(x => x.cost.lens === '死亡率'));
ok('高亮转义不产生注入', fmt.highlightHtml('<b>x</b>', 'x').indexOf('&lt;b&gt;') >= 0);
const member = store.addMember({ name: '妈妈', age: 68, gender: '女', conditions: ['高血压'] });
const lists = fmt.buildMemberLists(member);
ok('匹配到 60 岁以上 + 慢病两组', lists.matchedLabels.length >= 2, JSON.stringify(lists.matchedLabels));
ok('生成「该做」清单', lists.doList.length > 0, String(lists.doList.length));
ok('清单条目都来自真实条目', lists.doList.every(x => store.itemById(x.item.id)));
ok('成员字段不含敏感信息', !('phone' in member) && !('idCard' in member) && !('fullName' in member));

console.log('\n[6] 第二知识库（人情世故指南）与书库数据层');
const socialItems = require(path.join(ROOT, 'data/social-items.js'));
const socialCatalog = require(path.join(ROOT, 'data/social-catalog.js'));
const socialDetails = require(path.join(ROOT, 'data/social-details.js'));
const booksMeta = require(path.join(ROOT, 'data/books.js'));
const lib = require(path.join(ROOT, 'utils/library.js'));
ok('人情世故指南 31 章', socialCatalog.length === 31, String(socialCatalog.length));
ok('人情世故指南 640 条', socialItems.length === 640, String(socialItems.length));
ok('各章条数与目录一致', socialCatalog.every(c => socialItems.filter(i => i.s === c.sec).length === c.count));
ok('640 条都有详情长文本', socialItems.every(i => !!socialDetails[i.id]));
ok('条目 id 与主书不冲突', socialItems.every(i => !items.some(h => h.id === i.id)));
ok('保留 312 条「怎么说」话术', socialItems.filter(i => i.tip).length === 312,
  String(socialItems.filter(i => i.tip).length));
ok('书架两本书', booksMeta.books.length === 2 && lib.getBooks().length === 2);
ok('章节总数 65（34 + 31）', lib.getChapters('hltb').length === 34 && lib.getChapters('social').length === 31);
ok('条目总数 1412（772 + 640）', lib.getStats().items === 1412, String(lib.getStats().items));
ok('8 个主推主题', lib.getTopics().filter(t => t.primary).length === 8);
ok('跨书主题「人际」命中 22 章', lib.getTopicChapterCount('relation') === 22,
  String(lib.getTopicChapterCount('relation')));
ok('主题聚合按书分组', lib.getTopicChapters('relation').every(c => !!c.bookTitle && !!c.accent));
ok('章节标题按书解析', fmt.sectionTitle(1, 'social') === '底层逻辑：面子、人情、关系与分寸');
ok('跨书检索命中主书', fmt.search('系安全带')[0].id === '01-1');
ok('跨书检索命中第二本', fmt.search('人情', { book: 'social' }).length > 0);
ok('按书筛选生效', fmt.search('', { book: 'social' }).length === 640);
ok('书名标注正确', fmt.bookTitleOf('rq01-1') === '人情世故指南' && fmt.bookTitleOf('01-1') === '高性价比人生');
ok('条目出处按书区分', store.itemBasis('rq01-1').indexOf('人情世故') >= 0);
ok('第二本条目可加入清单', !!store.addItemTask('rq01-1', ''));
ok('阅读进度可写可读', lib.setProgress('social', 3) === true && lib.getProgress('social').sec === 3);
ok('主题收藏可切换', lib.toggleTopicFav('relation') === true && lib.isTopicFav('relation') === true);

console.log('\n[7] 清理');
store.clearAll();
ok('清空后无事件', store.getEvents().length === 0);
ok('清空后无成员', store.getMembers().length === 0);

console.log('\n通过 %d / 失败 %d\n', pass, fail);
process.exit(fail ? 1 : 0);
