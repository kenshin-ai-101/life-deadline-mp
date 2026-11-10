// 推荐结果：首选大卡 + 其他建议（来源分散）；行内负反馈「不太合适 / 已经在做」即时换一条。
// 复刻《人生指南库》pkg-insight/result；本工程无服务端，推荐由 pkg-insight/recommend.js 本地计算。
'use strict';

const profile = require('../../utils/profile.js');
const store = require('../../utils/store.js');
const lib = require('../../utils/library.js');
const rec = require('../recommend.js');

const BUDGET_LABEL = { t5: '5–10 分钟', t15: '10–30 分钟', t30: '30 分钟以上', tfree: '时间不固定' };
const OBSTACLE_LABEL = { time: '时间不够', will: '怕坚持不下来', know: '不知道从哪开始', none: '先看看再说' };
const TOPIC_SHORT = {
  sleep: '睡眠', mind: '情绪', relation: '人际', learn: '学习',
  work: '工作', money: '财务', safety: '安全', family: '家庭'
};

Page({
  data: {
    loading: true,
    statusBarHeight: 20,
    empty: false,
    noResults: false,
    offline: true,
    summaryRuns: [],
    first: null,
    others: [],
    bookCount: 1,
    totalSteps: 0
  },

  onLoad() {
    let h = 20;
    try { h = (wx.getSystemInfoSync() || {}).statusBarHeight || 20; } catch (e) { /* 兜底 */ }
    this.setData({ statusBarHeight: h });
    const p = profile.getProfileV2();
    if (!p || !(p.topicIds || []).length) {
      this.setData({ empty: true, loading: false });
      return;
    }
    this.setData({ profile: p, totalSteps: lib.getStats().items });
    /* 与参考一致：保留一帧「正在为你匹配」的过渡态 */
    setTimeout(() => this.renderResult(), 320);
  },

  renderResult() {
    const res = rec.recommendV2(this.data.profile, 8);
    const items = res.items.map(it => Object.assign({}, it, {
      fav: store.isFavorite(it.step.id)
    }));
    const bookMap = {};
    items.forEach(it => { bookMap[it.step.bookId] = true; });
    const bookCount = Object.keys(bookMap).length || 1;
    this.setData({
      loading: false,
      noResults: !items.length,
      offline: res.source === 'local',
      first: items[0] || null,
      others: items.slice(1),
      bookCount: bookCount,
      summaryRuns: this.summaryRuns(items, bookCount)
    });
  },

  /** 摘要条：关注 X · 每天约 Y · 障碍 Z，从 N 本书里挑出 M 条 */
  summaryRuns(items, bookCount) {
    const p = this.data.profile || {};
    const topics = (p.topicIds || []).map(id =>
      TOPIC_SHORT[id] || (lib.getTopic(id) || {}).name || id);
    const obstacle = (p.obstacles || []).map(id => OBSTACLE_LABEL[id]).filter(Boolean);
    const runs = [
      { t: '关注 ' }, { t: topics.join('、') || '综合', b: 1 },
      { t: ' · 每天约 ' }, { t: BUDGET_LABEL[p.budget] || '任意时间', b: 1 }
    ];
    if (obstacle.length) {
      runs.push({ t: ' · 障碍 ' }, { t: obstacle.join('、'), b: 1 });
    }
    runs.push({ t: '，从 ' + bookCount + ' 本书里挑出 ' + items.length + ' 条' });
    return runs;
  },

  onNavBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/index/index' });
  },

  /** 本工程「查看原文」的等价页是条目详情（含成本/收益/证据/来源） */
  onOpenStep(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onFav(e) {
    const id = e.currentTarget.dataset.id;
    const fav = store.toggleFavorite(id);
    const flip = it => (it && it.step && it.step.id === id) ? Object.assign({}, it, { fav: fav }) : it;
    this.setData({ first: flip(this.data.first), others: this.data.others.map(flip) });
    wx.showToast({ title: fav ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  /** 负反馈即时换一条；正反馈只记录致谢 */
  onFeedback(e) {
    const d = e.currentTarget.dataset;
    if (this._pending) return;
    this._pending = true;
    if (d.kind === 'positive') {
      wx.showToast({ title: '已记录这条反馈', icon: 'none' });
      this._pending = false;
      return;
    }
    profile.sendFeedback(d.uid, d.kind);
    wx.showToast({
      title: d.kind === 'doing' ? '已记录，以后不再推它' : '好的，换一条', icon: 'none'
    });
    this.renderResult();
    this._pending = false;
  },

  onRedo() { wx.redirectTo({ url: '/pkg-insight/wizard/wizard' }); },
  onGoLibrary() { wx.switchTab({ url: '/pages/catalog/catalog' }); },

  onShareAppMessage() {
    const p = this.data.profile || {};
    const names = (p.topicIds || []).map(id => (lib.getTopic(id) || {}).name || id);
    return {
      title: names.length ? '我在人生时限为「' + names[0] + '」挑出了几条建议' : '人生时限：每条建议都标注成本与证据',
      path: '/pages/index/index'
    };
  },
  onShareTimeline() {
    return { title: '人生时限：帮你挑出真正划算的那几条生活建议' };
  }
});
