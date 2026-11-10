// 「今天想改善什么」本地推荐引擎（分包内，避免占主包体积）。
//
// 等价《人生指南库》utils/match.js 的 recommend() + recommendLocal() 口径：
//   关注方向 → 章节权重 40；证据等级 A/B/C → 10/4/0；收益（性价比）大/中/小 → 10/5/0；
//   画像关键词命中每词 +16、最多 3 词；收益大再 +4；目标/障碍按字段加权；
//   时间预算是硬过滤（t5 只要「少」、t15 允许「少/中」、t30 全放、tfree 不限制）；
//   负反馈 uid 直接排除；每章最多 2 条保证来源分散，不足再回填高分项。
// 本工程没有服务端推荐，全部按本地数据计算，出参形状与指南库 v2 保持一致。
'use strict';

const lib = require('../utils/library.js');
const profile = require('../utils/profile.js');

const TOPIC_KEYWORDS = {
  sleep: ['睡眠', '入睡', '熬夜', '睡', '作息', '失眠'],
  mind: ['情绪', '焦虑', '压力', '低谷', '放松', '抑郁'],
  relation: ['人际', '人情', '社交', '关系', '拒绝', '面子', '沟通', '同事'],
  learn: ['学习', '技能', '练习', '升学', '读书', '记忆'],
  work: ['工作', '职场', '效率', '汇报', '加班', '权益', '领导'],
  money: ['钱', '攒钱', '消费', '保险', '理财', '防骗', '预算', '存款'],
  safety: ['安全', '急救', '火灾', '烫伤', '中毒', '意外', '触电', '溺水'],
  family: ['家庭', '育儿', '父母', '孩子', '长辈', '家人', '亲戚']
};

const BUDGET_ALLOW = {
  t5: ['少'], t15: ['少', '中'], t30: ['少', '中', '多'], tfree: null
};

const GRADE_SCORE = { A: 10, B: 4, C: 0 };
const GAIN_SCORE = { '大': 10, '中': 5, '小': 0 };
const CONCERN_W = 40;
const KW_STEP = 16;
const KW_MAX = 48;
const PER_CHAPTER = 2;

const GOAL_BOOST = {
  fast: it => (['大', '中'].indexOf((it.cost || {}).gain) > -1 ? 12 : 0),
  free: it => ((it.cost || {}).money === '0' ? 12 : 0),
  easy: it => (['否', '些'].indexOf((it.cost || {}).will) > -1 ? 10 : 0),
  solid: it => (gradeOf(it.grade) === 'A' ? 12 : 0)
};

function gradeOf(g) { return String(g || '').charAt(0); }

function keywordBoost(text, keywords) {
  if (!keywords.length) return 0;
  let n = 0;
  for (let i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) > -1) n += 1;
  }
  return Math.min(n, 3) * KW_STEP;
}

function reasonsOf(it, topicName) {
  const c = it.cost || {};
  const out = [];
  if (topicName) out.push('与' + topicName + '相关');
  if (c.money === '0') out.push('不花钱');
  if (c.time === '少') out.push('10 分钟内能做');
  if (gradeOf(it.grade) === 'A') out.push('证据 A 级');
  if (c.gain === '大') out.push('收益大');
  return out.slice(0, 3);
}

/**
 * @param {object} p { topicIds[], budget, obstacles[], goals[] }
 * @param {number} limit
 * @returns {{items:Array, source:string, scope:string, summary:string}}
 */
function recommendV2(p, limit) {
  const n = limit || 8;
  const prof = p || {};
  const topicIds = prof.topicIds || [];
  if (!topicIds.length) return { items: [], source: 'local', scope: '', summary: '' };

  const topicNames = topicIds.map(id => (lib.getTopic(id) || {}).name || id);
  const chapterW = {};
  const chapterMeta = {};
  const keywords = [];
  topicIds.forEach(tid => {
    (TOPIC_KEYWORDS[tid] || []).forEach(k => { if (keywords.indexOf(k) === -1) keywords.push(k); });
    lib.getTopicChapters(tid).forEach(c => {
      const uid = c.bookId + ':' + c.sec;
      chapterW[uid] = (chapterW[uid] || 0) + CONCERN_W;
      chapterMeta[uid] = c;
    });
  });

  const allow = BUDGET_ALLOW[prof.budget] || null;
  const excluded = {};
  profile.getDoingList().forEach(uid => { excluded[uid] = true; });
  const obstacles = prof.obstacles || [];
  const goals = (prof.goals || []).map(g => GOAL_BOOST[g]).filter(Boolean);

  const pool = [];
  Object.keys(chapterMeta).forEach(uid => {
    const c = chapterMeta[uid];
    lib.getItems(c.bookId, c.sec).forEach(it => {
      const cost = it.cost || {};
      if (allow && allow.indexOf(cost.time) < 0) return;
      const itemUid = c.bookId + ':' + it.id;
      if (excluded[itemUid]) return;

      const row = { it: it, chapterUid: uid, chapter: c, uid: itemUid };
      row.text = String(it.t || '') + String(it.p || '') + String(it.tip || '');
      let score = chapterW[uid] || 0;
      score += GRADE_SCORE[gradeOf(it.grade)] || 0;
      score += GAIN_SCORE[cost.gain] || 0;
      score += keywordBoost(row.text, keywords);
      if (cost.gain === '大') score += 4;
      obstacles.forEach(o => {
        if (o === 'time' && cost.time === '少') score += 6;
        if (o === 'will' && ['否', '些'].indexOf(cost.will) > -1) score += 6;
        if (o === 'know' && gradeOf(it.grade) === 'A') score += 6;
      });
      goals.forEach(fn => { score += fn(it); });
      row.score = score;
      pool.push(row);
    });
  });

  pool.sort((a, b) => b.score - a.score);

  const seen = {};
  const picked = [];
  pool.forEach(row => {
    if (picked.length >= n) return;
    const k = row.chapterUid;
    seen[k] = seen[k] || 0;
    if (seen[k] < PER_CHAPTER) { picked.push(row); seen[k] += 1; }
  });
  if (picked.length < n) {
    pool.forEach(row => {
      if (picked.length >= n) return;
      if (picked.indexOf(row) === -1) picked.push(row);
    });
  }

  const items = picked.slice(0, n).map(row => {
    const it = row.it;
    const c = row.chapter;
    const book = lib.getBook(c.bookId) || {};
    return {
      step: {
        uid: row.uid,
        id: it.id,
        bookId: c.bookId,
        chapterId: String(c.sec),
        sec: c.sec,
        index: it.n || 0,
        title: it.t,
        plain: it.p,
        cost: it.cost || {},
        grade: it.grade || ''
      },
      chapterTitle: c.title || '',
      bookTitle: book.title || c.bookId,
      reasons: reasonsOf(it, topicNames[0]),
      score: row.score,
      accent: lib.getAccent(c.bookId)
    };
  });

  return { items: items, source: 'local', scope: '', summary: '' };
}

module.exports = {
  TOPIC_KEYWORDS, BUDGET_ALLOW, PER_CHAPTER, KW_MAX,
  recommendV2
};
