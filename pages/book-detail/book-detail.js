// 书籍详情：复刻《人生指南库》画板 08/09
// 书封大卡 → 统计三卡 → 主题 chips → 章节列表（在读徽标 / 收起展开）→ 来源卡
'use strict';
const lib = require('../../utils/library.js');

const PREVIEW_COUNT = 8;

Page({
  data: {
    book: null,
    heroAccent: '#226B60',
    updatedLabel: '',
    stat2: '',
    stat2Label: '',
    avgMin: 1,
    topics: [],
    filter: '',
    shownChapters: [],
    filteredCount: 0,
    hasMore: false,
    readingSec: 0,
    readingTitle: '',
    loadError: ''
  },

  onLoad(options) {
    const bookId = options.book || 'hltb';
    const book = lib.getBook(bookId);
    if (!book) {
      this.setData({ loadError: '这本书暂时无法找到，请从知识库重新选择。' });
      return;
    }
    this.bookId = bookId;
    this.allChapters = lib.getChapters(bookId);

    // 统计三卡：建议条数 / A 级证据占比 / 平均条阅读（按 300 字每分钟估算）
    const allItems = lib.getItems(bookId);
    const aCount = allItems.filter(it => it.grade === 'A').length;
    const avgWords = allItems.length
      ? allItems.reduce((s, it) => s + (it.p || '').length, 0) / allItems.length
      : 0;

    const topics = [{ id: '', name: '全部', count: this.allChapters.length }]
      .concat(lib.getBookTopics(bookId));

    this.setData({
      book: book,
      heroAccent: book.accent,
      updatedLabel: (book.updatedAt || '').slice(5, 10).replace('-', '/') || '近期',
      stat2: allItems.length ? 'A ' + Math.round(aCount / allItems.length * 100) + '%' : book.stats.chapters,
      stat2Label: allItems.length ? 'A级证据占比' : '章节数',
      avgMin: Math.max(1, Math.round(avgWords / 300)),
      topics: topics
    });
    this.applyFilter('');
  },

  onShow() { this.refreshProgress(); },

  refreshProgress() {
    if (!this.bookId) return;
    const p = lib.getProgress(this.bookId);
    this.setData({
      readingSec: p ? p.sec : 0,
      readingTitle: p ? p.title : ''
    });
  },

  applyFilter(filter) {
    const list = filter
      ? this.allChapters.filter(c => (c.topicIds || []).indexOf(filter) > -1)
      : this.allChapters;
    this._filtered = list;
    this.setData({
      filter: filter,
      filteredCount: list.length,
      hasMore: list.length > PREVIEW_COUNT,
      shownChapters: list.slice(0, this._expanded ? list.length : PREVIEW_COUNT)
    });
  },

  onFilter(e) {
    this._expanded = false;
    this.applyFilter(e.currentTarget.dataset.id || '');
  },

  onToggleAll() {
    this._expanded = !this._expanded;
    const list = this._filtered || this.allChapters;
    this.setData({
      hasMore: !this._expanded && list.length > PREVIEW_COUNT,
      shownChapters: this._expanded ? list : list.slice(0, PREVIEW_COUNT)
    });
  },

  onContinue() {
    if (!this.data.readingSec) return;
    wx.navigateTo({ url: '/pkg-read/chapter/chapter?book=' + this.bookId + '&sec=' + this.data.readingSec });
  },

  onChapterTap(e) {
    wx.navigateTo({ url: '/pkg-read/chapter/chapter?book=' + this.bookId + '&sec=' + e.currentTarget.dataset.sec });
  },

  onCopySource() {
    const b = this.data.book || {};
    wx.setClipboardData({ data: b.sourceUrl || '' });
  },

  onOpenLibrary() { wx.switchTab({ url: '/pages/catalog/catalog' }); },

  onShareAppMessage() {
    const b = this.data.book || {};
    return {
      title: '《' + b.title + '》：' + b.stats.steps + ' 条可操作的建议',
      path: '/pages/book-detail/book-detail?book=' + b.id
    };
  }
});
