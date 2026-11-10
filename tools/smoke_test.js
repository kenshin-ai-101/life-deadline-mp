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

console.log('\n[7] 首页「最近更新」（复刻指南库为我推荐 tab 取数口径）');
const upd = require(path.join(ROOT, 'utils/updates.js'));
const recent = upd.getRecentUpdates();
ok('章节级时间戳按天聚合', recent.days.length === 1 && recent.days[0].chapters.length === 31,
  recent.days.map(d => d.date + ':' + d.chapters.length).join(','));
ok('主书无章节时间戳时不计入', recent.updates.every(x => x.bookId === 'social'));
ok('无今日更新时标题为「最近更新」', recent.title === '最近更新', recent.title);
ok('累计上限 4 章', recent.count === 4 && recent.updates.length === 4, String(recent.count));
ok('默认只显示 2 条', upd.shownUpdates(recent.updates, false).length === 2);
ok('展开显示全部 4 条', upd.shownUpdates(recent.updates, true).length === 4);
ok('每条字段齐全（跳转 / 竖条 / 标签 / 日期）', recent.updates.every(x =>
  x.uid && x.bookId && x.sec && x.title && x.bookTitle && x.accent && x.actionLabel && x.day));
ok('日期标签为 MM/DD', recent.updates.every(x => /^\d{2}\/\d{2}$/.test(x.dateLabel)),
  recent.updates[0].dateLabel);
ok('旧日期标「更新」而非「新增」', recent.updates.every(x => x.action === 'update' && x.actionLabel === '更新'));
ok('身份色取各自书籍', recent.updates.every(x => x.accent === lib.getAccent(x.bookId)));
const todayMock = upd.getRecentUpdates(new Date('2026-10-23T12:00:00'));
ok('今日有更新时标题切「今日更新」', todayMock.title === '今日更新', todayMock.title);
ok('今日列表不混入旧日期', todayMock.updates.every(x => x.day === '2026-10-23'));
ok('近两天内标「新增」', todayMock.updates.every(x => x.action === 'new' && x.actionLabel === '新增'));
ok('章节跳转目标都能解析', recent.updates.every(x => !!lib.getChapter(x.bookId, x.sec)));

console.log('\n[8] 首页「今天想改善什么」与本地推荐链路');
const prof = require(path.join(ROOT, 'utils/profile.js'));
const rec = require(path.join(ROOT, 'pkg-insight/recommend.js'));
const matchable = booksMeta.books.filter(b => b.capabilities && b.capabilities.matchable);
ok('可推荐书籍 2 本', matchable.length === 2, String(matchable.length));
ok('hero 可挑建议 1412 条', matchable.reduce((n, b) => n + b.stats.steps, 0) === 1412);
ok('向导 8 个主推方向', lib.getTopics().filter(t => t.primary).length === 8);
ok('画像初始为空', prof.getProfileV2() === null);
prof.saveProfileV2({ topicIds: ['sleep'], budget: 't15', obstacles: [], goals: [], ts: 1 });
const p2 = prof.getProfileV2();
ok('画像可存可取', !!p2 && p2.topicIds[0] === 'sleep' && p2.budget === 't15');
ok('无画像时推荐为空', rec.recommendV2(null, 8).items.length === 0);
const r8 = rec.recommendV2(p2, 8);
ok('推荐返回 8 条', r8.items.length === 8, String(r8.items.length));
ok('结果字段齐全（跳转 / 书名 / 章名 / 理由 / 身份色）', r8.items.every(x =>
  x.step && x.step.uid && x.step.id && x.step.bookId && x.step.title && x.step.plain &&
  x.chapterTitle && x.bookTitle && x.reasons.length && x.accent));
ok('理由 chips 不超过 3 个', r8.items.every(x => x.reasons.length <= 3));
ok('首选是全场最高分', r8.items[0].score >= Math.max.apply(null, r8.items.slice(1).map(x => x.score)));
ok('t15 时间预算硬过滤', r8.items.every(x => ['少', '中'].indexOf(x.step.cost.time) > -1));
const r5 = rec.recommendV2({ topicIds: ['sleep'], budget: 't5', obstacles: [], goals: [] }, 8);
ok('t5 只留「少」时间', r5.items.length > 0 && r5.items.every(x => x.step.cost.time === '少'));
const r4 = rec.recommendV2(p2, 4);
const perChapter = {};
r4.items.forEach(x => {
  const k = x.step.bookId + ':' + x.step.sec;
  perChapter[k] = (perChapter[k] || 0) + 1;
});
ok('每章最多 2 条（来源分散）', Object.keys(perChapter).every(k => perChapter[k] <= 2),
  JSON.stringify(perChapter));
const excludedUid = r8.items[0].step.uid;
prof.sendFeedback(excludedUid, 'negative');
const r9 = rec.recommendV2(p2, 8);
ok('负反馈后不再推该条', r9.items.every(x => x.step.uid !== excludedUid));
ok('换一条后仍满 8 条', r9.items.length === 8, String(r9.items.length));
ok('跨主题可出结果', rec.recommendV2(
  { topicIds: ['relation'], budget: 'tfree', obstacles: [], goals: [] }, 8).items.length === 8);
ok('画像主题可映射为文字', (lib.getTopic('sleep') || {}).name === '睡眠和作息');
prof.clearProfileV2();
ok('画像可清空', prof.getProfileV2() === null);

console.log('\n[9] 我的页统计明细');
store.clearAll();
const ms = require(path.join(ROOT, 'utils/mine-stats.js'));
ok('5 类统计元信息齐全', ms.TYPES.length === 5 && ms.TYPES.every(t =>
  t.key && t.label && t.short && t.unit && t.hint && t.empty && t.emptyHint && t.cta && t.tab));
ok('空态 CTA 都指向 tab 页', ms.TYPES.every(t => t.tab.indexOf('/pages/') === 0));
ok('空态下 5 类计数均为 0', ms.TYPES.every(t => ms.countOf(t.key) === 0));
ok('空态下 5 类明细均为空', ms.TYPES.every(t => ms.rowsOf(t.key).length === 0));
const statEvent = store.createEvent('childbirth', '2026-11-09', '明细测试', '');
ok('建事件后进行中事件 +1', ms.countOf('events') === 1);
ok('建事件后待办动作 = 事件动作数', ms.countOf('tasks') === statEvent.tasks.length,
  ms.countOf('tasks') + ' / ' + statEvent.tasks.length);
const favId = items[0].id;
store.toggleFavorite(favId);
ok('收藏 +1', ms.countOf('favorites') === 1);
const statMember = store.addMember({ name: '妈妈', age: 62, gender: '女', conditions: ['高血压'] });
ok('成员 +1', ms.countOf('members') === 1);
store.addReceipt(statEvent.tasks[0].id, '已交材料', ['/tmp/a.png', '/tmp/b.png']);
ok('回执 +1', ms.countOf('receipts') === 1);
const cardStats = ms.stats();
ok('统计卡 5 项且都带 key / 数字', cardStats.length === 5 &&
  cardStats.every(s => s.key && s.label && typeof s.value === 'number'));
ok('统计卡口径与明细条数完全一致', cardStats.every(s => s.value === ms.rowsOf(s.key).length));
ok('事件明细可跳时间轴', ms.rowsOf('events')[0].url === '/pages/timeline/timeline?id=' + statEvent.event.id);
ok('事件明细带办完进度', /\d+ \/ \d+ 已办完/.test(ms.rowsOf('events')[0].tag));
ok('待办明细都带跳转与来源', ms.rowsOf('tasks').every(r => !!r.url && !!r.sub));
ok('收藏明细标题来自条目且可跳原文', ms.rowsOf('favorites')[0].title === items[0].t &&
  ms.rowsOf('favorites')[0].url === '/pkg-read/detail/detail?id=' + favId);
ok('收藏明细标注书名', ms.rowsOf('favorites')[0].sub.indexOf(fmt.bookTitleOf(favId)) === 0);
ok('成员明细可跳成员详情', ms.rowsOf('members')[0].url ===
  '/pkg-family/member-detail/member-detail?id=' + statMember.id);
const rcRows = ms.rowsOf('receipts');
ok('回执明细含备注 / 图片 / 关联动作', rcRows[0].note === '已交材料' &&
  rcRows[0].images.length === 2 && rcRows[0].hasImages && !!rcRows[0].url);
ok('回执明细带格式化时间', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(rcRows[0].sub));
ok('所有明细行都有 id / 标题 / 副信息', ms.TYPES.every(t =>
  ms.rowsOf(t.key).every(r => r.id && r.title && r.sub)));
ok('未知 type 安全回退到事件', ms.typeOf('unknown').key === 'events' && ms.rowsOf('unknown').length === 0);
ok('切换两本书的收藏都能取出处', (() => {
  const sid = require(path.join(ROOT, 'data/social-items.js'))[0].id;
  store.toggleFavorite(sid);
  const row = ms.rowsOf('favorites').filter(r => r.id === sid)[0];
  store.toggleFavorite(sid);
  return !!row && row.sub.indexOf('人情世故指南') === 0 && !!row.title;
})());

console.log('\n[10] 来源编号 [1][2][3]');
const srcUtil = require(path.join(ROOT, 'utils/sources.js'));
const hltbDetails = require(path.join(ROOT, 'pkg-read/data/details.js'));
ok('来源模块导出齐全', ['cleanSource', 'splitCandidates', 'groupReferences', 'runsOf', 'buildRefs']
  .every(k => typeof srcUtil[k] === 'function'));
ok('md 的 <URL> 尖括号被去掉', !/[<>]/.test(srcUtil.cleanSource('报告 <https://a.com/x>；另一份')));
ok('截断未闭合的链接被丢弃', srcUtil.cleanSource('WHO … <https://who.int/a') === 'WHO …');
const quoted = srcUtil.splitCandidates('条例第二十七条：「甲；乙」；另一份报告. <https://a.com/x>');
ok('引号内分号不切分、引号外切分', quoted.length === 2 && quoted[0].indexOf('甲；乙') >= 0);
const sameLaw = srcUtil.groupReferences('条例第二十七条：「甲」；第二十八条：「乙」. <https://a.com/x>');
ok('同一法条的多个条款合并为 1 条来源', sameLaw.length === 1 && sameLaw[0].indexOf('第二十八条') >= 0);
const multiLaw = srcUtil.groupReferences('报告甲. <https://a.com/x>；报告乙. <https://b.com/y>');
ok('两份独立文献拆成 2 条', multiLaw.length === 2);
const runs = srcUtil.runsOf('WHO (2025). 报告. https://www.who.int/a');
ok('URL 被拆成可点 runs', runs.some(r => r.url === true && r.t === 'https://www.who.int/a'));
const ref011 = srcUtil.buildRefs(hltbDetails['01-1']);
ok('01-1 有多条来源且启用编号', ref011.multi && ref011.count >= 3);
ok('01-1 编号从 1 连续递增', ref011.refs.every((r, i) => r.no === i + 1));
ok('01-1 节选外链接有 extra 标记', ref011.refs.some(r => r.extra && r.runs[0].url));
const ref014 = srcUtil.buildRefs(hltbDetails['01-4']);
ok('01-4 法条条款未被误拆成独立编号', ref014.refs[0].text.indexOf('第二十八条') >= 0 &&
  ref014.refs.filter(r => !r.extra).length <= 3);
const refSocial = srcUtil.buildRefs(socialDetails['rq01-1']);
ok('单条来源仍是 1 个编号项', refSocial.count === 1 && refSocial.refs[0].no === 1 && refSocial.linkCount === 0);
const chapterWxml = require('fs').readFileSync(path.join(ROOT, 'pkg-read/chapter/chapter.wxml'), 'utf8');
ok('章节页来源折叠行始终显示「来源 · N 条」',
  /来源<text class="fold-cnt"> · \{\{item\.refCount\}\} 条<\/text>/.test(chapterWxml));
ok('章节页来源编号对单条也渲染（无 multi 条件）',
  /<text class="src-idx">\[\{\{ref\.no\}\}\]<\/text>/.test(chapterWxml) && chapterWxml.indexOf('refMulti') === -1);
ok('空 detail 安全回退', srcUtil.buildRefs(null).count === 0 && srcUtil.buildRefs({}).count === 0);
let badNo = 0, covered = 0, multiCnt = 0;
Object.keys(hltbDetails).forEach(id => {
  const d = hltbDetails[id];
  const r = srcUtil.buildRefs(d);
  if (r.multi) multiCnt++;
  if (r.refs.some((x, i) => x.no !== i + 1)) badNo++;
  const all = r.refs.map(x => x.text).join('\n');
  if ((d.links || []).every(u => all.indexOf(u) >= 0)) covered++;
});
ok('全书 772 条编号连续', badNo === 0);
ok('多来源条目超过 600 条', multiCnt > 600, String(multiCnt));
ok('所有全量链接都能在编号列表里找到', covered === Object.keys(hltbDetails).length,
  covered + ' / ' + Object.keys(hltbDetails).length);
ok('复制文本保留编号', srcUtil.buildRefs(hltbDetails['01-1']).refs
  .map(r => '[' + r.no + '] ' + r.text).join('\n').indexOf('[1] ') === 0);

console.log('\n[11] 清理');
store.clearAll();
ok('清空后无事件', store.getEvents().length === 0);
ok('清空后无成员', store.getMembers().length === 0);

console.log('\n通过 %d / 失败 %d\n', pass, fail);
process.exit(fail ? 1 : 0);
