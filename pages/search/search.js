const store = require('../../utils/store.js');
const fmt = require('../../utils/format.js');

const BOOK_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'hltb', label: '高性价比人生' },
  { id: 'social', label: '人情世故指南' }
];

function toView(it, kw) {
  return {
    id: it.id,
    titleHtml: fmt.highlightHtml(it.t, kw),
    plainHtml: fmt.highlightHtml(it.p, kw),
    bookTitle: fmt.bookTitleOf(it.id),
    section: fmt.sectionTitle(it.s, it.b),
    grade: fmt.gradeText(it.grade),
    disputed: it.disputed
  };
}

Page({
  data: {
    keyword: '',
    history: [],
    hot: fmt.hotWords(),
    results: [],
    searched: false,
    viewState: 'ready',
    bookFilters: BOOK_FILTERS,
    activeBook: 'all'
  },

  onLoad(query) {
    if (query.q) this.setData({ keyword: query.q });
    this.setData({ history: store.getSearchHistory() });
    if (query.q) this.run(query.q, false);
  },

  onInput(e) { this.setData({ keyword: e.detail.value }); },

  onConfirm(e) { this.run(e.detail.value, true); },

  tapHot(e) { this.run(e.currentTarget.dataset.word, true); },

  tapHistory(e) { this.run(e.currentTarget.dataset.word, true); },

  onBookFilter(e) {
    const id = e.currentTarget.dataset.id || 'all';
    this.setData({ activeBook: id });
    if (this.data.keyword) this.run(this.data.keyword, false);
  },

  run(kw, saveHistory) {
    const keyword = String(kw || '').trim();
    if (!keyword) {
      this.setData({ searched: false, results: [] });
      return;
    }
    const list = fmt.search(keyword, { book: this.data.activeBook })
      .slice(0, 60).map(it => toView(it, keyword));
    this.setData({
      keyword: keyword,
      results: list,
      searched: true,
      history: saveHistory ? store.pushSearchHistory(keyword) : this.data.history
    });
    store.track('search', { keyword: keyword, book: this.data.activeBook, result_count: list.length });
  },

  clear() {
    this.setData({ keyword: '', results: [], searched: false });
  },

  clearHistory() {
    store.clearSearchHistory();
    this.setData({ history: [] });
  },

  goItem(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  goFilter() { wx.navigateTo({ url: '/pkg-read/filter/filter' }); },

  goAid() { wx.navigateTo({ url: '/pkg-aid/aid-list/aid-list' }); },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); }
});
