// 主题聚合：复刻《人生指南库》画板 10
// 头卡（图标+统计）→ 按书筛选 chips → 跨书章节小卡 → 分批加载 → 主题收藏
'use strict';
const lib = require('../../utils/library.js');

const PAGE_SIZE = 10;

Page({
  data: {
    topic: { short: '', icon: '' },
    chapters: [],
    shown: [],
    bookChips: [],
    bookCount: 0,
    totalSteps: 0,
    filter: '',
    topicFav: false
  },

  onLoad(options) {
    const topicId = options.topic || '';
    const raw = lib.getTopic(topicId) || {
      id: topicId, name: '全部方向', short: '全部', icon: '/images/topic-default.png'
    };
    const chapters = lib.getTopicChapters(topicId);

    const byBook = {};
    chapters.forEach(c => { byBook[c.bookId] = (byBook[c.bookId] || 0) + 1; });
    const bookChips = [{ id: '', label: '全部', count: chapters.length }]
      .concat(Object.keys(byBook).map(id => ({
        id: id,
        label: (lib.getBook(id) || {}).title || id,
        count: byBook[id]
      })));

    this._rows = chapters;
    this.setData({
      topic: raw,
      chapters: chapters,
      shown: chapters.slice(0, PAGE_SIZE),
      bookChips: bookChips,
      bookCount: Object.keys(byBook).length,
      totalSteps: chapters.reduce((s, c) => s + c.count, 0)
    });
    wx.setNavigationBarTitle({ title: '主题 · ' + raw.short });
  },

  onShow() { this.refreshFav(); },

  refreshFav() {
    const id = this.data.topic.id;
    this.setData({ topicFav: lib.isTopicFav(id) });
  },

  onFilter(e) {
    const id = e.currentTarget.dataset.id || '';
    const rows = id
      ? this.data.chapters.filter(c => c.bookId === id)
      : this.data.chapters;
    this._rows = rows;
    this.setData({ filter: id, shown: rows.slice(0, PAGE_SIZE) });
  },

  onReachBottom() { this.loadMore(); },

  loadMore() {
    const rows = this._rows || this.data.chapters;
    const next = rows.slice(0, this.data.shown.length + PAGE_SIZE);
    if (next.length !== this.data.shown.length) this.setData({ shown: next });
  },

  onFavTopic() {
    const on = lib.toggleTopicFav(this.data.topic.id);
    this.setData({ topicFav: on });
    wx.showToast({ title: on ? '已收藏主题' : '已取消收藏', icon: 'none' });
  },

  onChapterTap(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pkg-read/chapter/chapter?book=' + d.book + '&sec=' + d.sec });
  },

  onOpenLibrary() { wx.switchTab({ url: '/pages/catalog/catalog' }); },

  onShareAppMessage() {
    return {
      title: '「' + this.data.topic.short + '」主题下的全部指南章节',
      path: '/pages/topic-aggregate/topic-aggregate?topic=' + this.data.topic.id
    };
  }
});
