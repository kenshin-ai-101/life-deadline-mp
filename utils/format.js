// 展示文案、筛选与检索。所有需要在 WXML 里呈现的派生字段都在这里算好。
const items = require('../data/items.js');
const socialItems = require('../data/social-items.js');
const rules = require('../data/rules.js');
const catalog = require('../data/catalog.js');
const socialCatalog = require('../data/social-catalog.js');

const COST_LABELS = [
  { key: 'money', label: '花钱' },
  { key: 'time', label: '花时间' },
  { key: 'will', label: '要毅力' },
  { key: 'gain', label: '收益' },
  { key: 'lens', label: '口径' },
  { key: 'who', label: '人群' }
];

const GRADE_LABEL = { A: 'A 级 · 证据较硬', B: 'B 级', C: 'C 级' };

// 条目标签文案与《人生指南库》阅读页同一套映射：
// 主书的「口径」换算成「换什么」；人情世故的口径本身就是可读词，保持原样。
const LENS_TEXT = {
  '死亡率': '换寿命',
  '金钱': '换钱',
  '时间': '换时间精力',
  '自由': '换人身自由',
  '关系': '关系',
  '体面': '体面',
  '自保': '自保'
};
// 成本三维的展示文案（对应上游标签 钱/时间/毅力）
const COST_TEXT = {
  money: { '0': '不花钱', '少': '花少量钱', '多': '花不少钱' },
  time: { '少': '顺手', '中': '花几小时', '多': '每天占时间' },
  will: { '否': '不用毅力', '些': '要一点毅力', '是': '要很多毅力' }
};

/** 章节页与详情页共用的条目标签：证据等级（主）+ 口径 + 成本三维 + 争议 */
function chipModel(item) {
  const it = item || {};
  const c = it.cost || {};
  return {
    grade: it.grade ? '证据 ' + it.grade + ' 级' : '',
    lensText: LENS_TEXT[c.lens] || c.lens || '',
    costTags: [COST_TEXT.money[c.money], COST_TEXT.time[c.time], COST_TEXT.will[c.will]]
      .filter(Boolean),
    dispute: !!it.disputed
  };
}
const EV_LABEL = {
  '随机对照试验': '随机对照试验',
  '观察性研究': '观察性研究',
  '法条': '法条',
  '官方文件': '官方文件',
  '仅媒体报道': '仅媒体报道',
  '经验共识': '经验共识 / 原文未注明'
};

function costBadges(item) {
  const c = item.cost || {};
  return COST_LABELS
    .filter(x => c[x.key])
    .map(x => ({ key: x.key, label: x.label, value: c[x.key] }));
}

function gradeText(g) { return GRADE_LABEL[g] || '未标注'; }
function evText(e) { return EV_LABEL[e] || e || '原文未提供'; }
function bookIdOf(id) { return String(id || '').indexOf('rq') === 0 ? 'social' : 'hltb'; }
function bookTitleOf(id) { return bookIdOf(id) === 'social' ? '人情世故指南' : '高性价比人生'; }

/** bookId 缺省时按主书处理，保持旧调用方式不变 */
function sectionTitle(sec, bookId) {
  const c = bookId === 'social' ? socialCatalog : catalog;
  const s = c.filter(x => x.sec === sec)[0];
  return s ? s.title : '第 ' + sec + ' 节';
}

// ---------------- 检索 ----------------

/** 跨两本书检索；结果统一带 b 字段（hltb / social），供页面标注出处。
 *  f.book 可限定单本；缺省或 'all' 检索全部。 */
function search(keyword, filters) {
  const kw = String(keyword || '').trim().toLowerCase();
  const f = filters || {};
  const out = [];

  function walk(list, book) {
    list.forEach(it => {
      if (f.section && it.s !== Number(f.section)) return;
      if (f.grade && it.grade !== f.grade) return;
      if (f.lens && it.cost.lens !== f.lens) return;
      if (f.who && it.cost.who !== f.who) return;
      if (f.money && it.cost.money !== f.money) return;
      if (f.time && it.cost.time !== f.time) return;
      if (f.will && it.cost.will !== f.will) return;
      if (f.gain && it.cost.gain !== f.gain) return;
      if (f.ev && it.ev !== f.ev) return;
      if (f.disputed && !it.disputed) return;

      let score = 0;
      if (kw) {
        const t = it.t.toLowerCase();
        const p = (it.p + ' ' + (it.tip || '')).toLowerCase();
        if (t.indexOf(kw) >= 0) score += 10;
        if (p.indexOf(kw) >= 0) score += 4;
        if (score === 0) return;
      }
      out.push({ item: Object.assign({}, it, { b: book }), score: score });
    });
  }

  if (!f.book || f.book === 'all' || f.book === 'hltb') walk(items, 'hltb');
  if (!f.book || f.book === 'all' || f.book === 'social') walk(socialItems, 'social');

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ga = { A: 0, B: 1, C: 2 }[a.item.grade];
    const gb = { A: 0, B: 1, C: 2 }[b.item.grade];
    const d = (ga === undefined ? 9 : ga) - (gb === undefined ? 9 : gb);
    if (d) return d;
    return a.item.b === b.item.b ? 0 : (a.item.b === 'hltb' ? -1 : 1);
  });
  return out.map(x => x.item);
}

function facetOptions() {
  function uniq(key, pick) {
    const seen = {};
    const out = [];
    items.forEach(it => {
      const v = pick(it);
      if (v && !seen[v]) { seen[v] = 1; out.push({ value: v, label: v }); }
    });
    return out;
  }
  return {
    grade: [{ value: 'A', label: 'A 级' }, { value: 'B', label: 'B 级' }, { value: 'C', label: 'C 级' }],
    lens: uniq('lens', it => it.cost.lens),
    who: uniq('who', it => it.cost.who),
    money: uniq('money', it => it.cost.money),
    time: uniq('time', it => it.cost.time),
    will: uniq('will', it => it.cost.will),
    gain: uniq('gain', it => it.cost.gain),
    ev: uniq('ev', it => it.ev)
  };
}

function hotWords() {
  return ['工伤认定', '出生医学证明', '失业保险金', '遗嘱', '急救', '敬酒', '随份子', '彩礼', '人情', '职场汇报'];
}

// rich-text 用的高亮片段，先转义再插入，避免把原文当标签解析
function highlightHtml(text, kw) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!kw) return esc;
  const i = esc.toLowerCase().indexOf(String(kw).toLowerCase());
  if (i < 0) return esc;
  return esc.slice(0, i)
    + '<span style="color:#A66A12;background:#FDF3E1">' + esc.slice(i, i + kw.length) + '</span>'
    + esc.slice(i + kw.length);
}

// ---------------- 家庭档案专属清单 ----------------

function memberMatches(rule, member) {
  const t = rule.test || {};
  if (t.minAge !== undefined && !(member.age >= t.minAge)) return false;
  if (t.maxAge !== undefined && !(member.age <= t.maxAge)) return false;
  if (t.condition && (member.conditions || []).indexOf(t.condition) < 0) return false;
  if (t.anyCondition) {
    const hit = (member.conditions || []).some(c => t.anyCondition.indexOf(c) >= 0);
    if (!hit) return false;
  }
  return true;
}

/**
 * 按成员条件生成「该做 / 别做」两张清单。
 * 内容不硬编码：全部来自 items.js 的条目，通过人群标签与标题关键词匹配，
 * 上游内容更新后重跑同步脚本即自动刷新。
 */
function buildMemberLists(member) {
  const matched = rules.memberRules.filter(r => memberMatches(r, member));
  const doIds = {};
  const noIds = {};
  matched.forEach(r => {
    items.forEach(it => {
      const text = it.t + ' ' + it.p;
      if (r.include.test(text) && !r.exclude.test(it.t)) {
        if (!noIds[it.id]) doIds[it.id] = { item: it, ruleLabel: r.label };
      }
      if (r.exclude.test(it.t)) {
        noIds[it.id] = { item: it, ruleLabel: r.label };
        if (doIds[it.id]) delete doIds[it.id];
      }
    });
  });
  return {
    matchedLabels: matched.map(r => r.label),
    doList: Object.keys(doIds).map(k => doIds[k]).slice(0, 12),
    dontList: Object.keys(noIds).map(k => noIds[k]).slice(0, 8)
  };
}

function elderItemView(it) {
  return { id: it.id, title: it.t, plain: it.p, section: sectionTitle(it.s) };
}

module.exports = {
  COST_LABELS, costBadges, gradeText, evText, sectionTitle,
  LENS_TEXT, COST_TEXT, chipModel,
  bookIdOf, bookTitleOf,
  search, facetOptions, hotWords, highlightHtml,
  buildMemberLists, elderItemView
};
