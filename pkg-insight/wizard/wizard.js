// 两步向导：第 1 步选一个方向（8 个主主题，选中自动进步）；
// 第 2 步时间预算（单选）+ 最大障碍（chips 多选可跳过）。
// 产出画像 → result 页本地推荐。复刻《人生指南库》pkg-insight/wizard。
'use strict';

const lib = require('../../utils/library.js');
const viewport = require('../../utils/viewport.js');
const profile = require('../../utils/profile.js');

/* 设计稿：短名 / 一句画像 / 图标（图标为本工程 images/ 下同名资源） */
const TOPIC_META = {
  sleep:    { short: '睡眠', desc: '入睡难、熬夜、睡不够', icon: '/images/topic-sleep.png' },
  mind:     { short: '情绪', desc: '焦虑、压力、低谷', icon: '/images/topic-mind.png' },
  relation: { short: '人际', desc: '合作、求助、拒绝、分寸', icon: '/images/topic-relation.png' },
  learn:    { short: '学习', desc: '技能、升学、练习', icon: '/images/topic-learn.png' },
  work:     { short: '工作', desc: '效率、职场权益', icon: '/images/topic-work.png' },
  money:    { short: '财务', desc: '攒钱、保险、防骗', icon: '/images/topic-money.png' },
  safety:   { short: '安全', desc: '急救、居家、出行', icon: '/images/topic-safety.png' },
  family:   { short: '家庭', desc: '育儿、长辈、关系', icon: '/images/topic-family.png' }
};

const BUDGETS = [
  { id: 't5', label: '5–10 分钟', desc: '顺手就能做完的那种' },
  { id: 't15', label: '10–30 分钟', desc: '每天能挤出一小段' },
  { id: 't30', label: '30 分钟以上', desc: '愿意认真投入' },
  { id: 'tfree', label: '时间不固定', desc: '有空就做，别限我' }
];

const OBSTACLES = [
  { id: 'time', label: '时间不够' },
  { id: 'will', label: '怕坚持不下来' },
  { id: 'know', label: '不知道从哪开始' },
  { id: 'none', label: '先看看再说' }
];

Page({
  data: {
    step: 1,
    statusBarHeight: 20,
    navBarHeight: 44,
    navPadRight: 96,
    topics: [],
    sourceCount: 0,
    sourceSteps: 0,
    sel: '',
    budgets: BUDGETS,
    budget: '',
    obstacles: OBSTACLES,
    obstaclesSel: []
  },

  onLoad(options) {
    const L = viewport.layout();
    const topics = lib.getTopics().filter(t => t.primary).map(t => ({
      id: t.id,
      name: t.name,
      short: (TOPIC_META[t.id] || {}).short || t.short || t.name,
      desc: (TOPIC_META[t.id] || {}).desc || '',
      icon: (TOPIC_META[t.id] || {}).icon || '/images/topic-default.png'
    }));
    /* 外部带主题进入（如主题聚合页）：只预选亮显，仍留在第 1 步 */
    const pre = options.topic && topics.some(t => t.id === options.topic) ? options.topic : '';
    const books = lib.getBooks().filter(b => b.capabilities && b.capabilities.matchable);
    this.setData({
      statusBarHeight: L.statusBarHeight,
      navBarHeight: L.navBarHeight,
      navPadRight: L.navPadRight,
      topics: topics,
      sel: pre,
      sourceCount: books.length,
      sourceSteps: books.reduce((n, b) => n + ((b.stats || {}).steps || 0), 0)
    });
  },

  /** 第 1 步：点选即高亮，短暂停留后自动进步 */
  onTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.step !== 1 || this._advancing) return;
    this.setData({ sel: id });
    this._advancing = true;
    setTimeout(() => {
      this._advancing = false;
      this.setData({ step: 2 });
    }, 180);
  },

  /** 导航返回：第 2 步回第 1 步，第 1 步退出页面 */
  onNavBack() {
    if (this.data.step === 2) { this.setData({ step: 1 }); return; }
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/index/index' });
  },

  onBudget(e) { this.setData({ budget: e.currentTarget.dataset.id }); },

  onObstacle(e) {
    const id = e.currentTarget.dataset.id;
    let sel = this.data.obstaclesSel.slice();
    const i = sel.indexOf(id);
    if (i > -1) sel.splice(i, 1);
    else if (id === 'none') sel = ['none'];
    else sel = sel.filter(s => s !== 'none').concat(id);
    this.setData({
      obstaclesSel: sel,
      obstacles: this.data.obstacles.map(item => Object.assign({}, item, { selected: sel.indexOf(item.id) > -1 }))
    });
  },

  onSubmit() {
    const sel = this.data.sel;
    const budget = this.data.budget;
    if (!sel) {
      wx.showToast({ title: '先选一个方向', icon: 'none' });
      this.setData({ step: 1 });
      return;
    }
    if (!budget) {
      wx.showToast({ title: '选一下每天能投入的时间', icon: 'none' });
      return;
    }
    profile.saveProfileV2({
      topicIds: [sel],
      budget: budget,
      obstacles: this.data.obstaclesSel.filter(s => s !== 'none'),
      goals: [],
      ts: Date.now()
    });
    wx.navigateTo({ url: '/pkg-insight/result/result' });
  },

  onShareAppMessage() {
    return { title: '两步挑出适合你的生活建议', path: '/pages/index/index' };
  }
});
