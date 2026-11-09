// 知识库 tab：复刻《人生指南库》「书库」的信息组织与交互
// 书架（书籍大卡）/ 主题（宫格）双 tab；书籍详情、主题聚合、章节阅读为下游页面。
'use strict';
const lib = require('../../utils/library.js');

Page({
  data: {
    tab: 'shelf',
    books: [],
    topics: [],
    statusBarHeight: 20
  },

  onLoad() {
    let h = 20;
    try { h = (wx.getSystemInfoSync() || {}).statusBarHeight || 20; } catch (e) { /* 兜底 */ }
    this.setData({ statusBarHeight: h });
  },

  onShow() { this.render(); },

  render() {
    const books = lib.getBooks().map(b => {
      const p = lib.getProgress(b.id);
      return Object.assign({}, b, {
        readingSec: p ? p.sec : 0,
        descLine2: p ? '在读 · ' + p.title : b.descLine2
      });
    });
    const topics = lib.getTopics()
      .filter(t => t.primary)
      .map(t => Object.assign({}, t, { count: lib.getTopicChapterCount(t.id) }));
    this.setData({ books: books, topics: topics });
  },

  onTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },

  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },

  onBookTap(e) {
    wx.navigateTo({ url: '/pages/book-detail/book-detail?book=' + e.currentTarget.dataset.id });
  },

  onContinue(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pkg-read/chapter/chapter?book=' + d.id + '&sec=' + d.sec });
  },

  onTopicTap(e) {
    wx.navigateTo({ url: '/pages/topic-aggregate/topic-aggregate?topic=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage() {
    return { title: '人生时限 · 知识库：两本指南，按书架和主题慢慢读', path: '/pages/catalog/catalog' };
  }
});
