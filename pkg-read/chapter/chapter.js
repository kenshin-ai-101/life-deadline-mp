// 章节阅读：复刻《人生指南库》阅读页的条目组织（NO.xx / 说人话 / 怎么说 / chips / 折叠字段）
// 两本书共用：hltb 长文本在本分包 details.js，social 长文本在主包 social-details.js。
'use strict';
const lib = require('../../utils/library.js');
const hltbDetails = require('../data/details.js');
const socialDetails = require('../../data/social-details.js');

const PAGE_SIZE = 10;
function pad(n) { return n < 10 ? '0' + n : String(n); }

Page({
  data: {
    viewState: 'loading',
    bookId: '',
    sec: 0,
    chapter: null,
    bookTitle: '',
    accent: '#226B60',
    topicTags: [],
    readMinutes: 1,
    updatedLabel: '',
    list: [],
    shownCount: 0,
    hasMore: false,
    prevSec: 0,
    nextSec: 0
  },

  onLoad(options) {
    const bookId = options.book || 'hltb';
    const sec = Number(options.sec || 1);
    const chapter = lib.getChapter(bookId, sec);
    if (!chapter) {
      this.setData({ viewState: 'missing' });
      return;
    }

    const book = lib.getBook(bookId) || {};
    const detailMap = bookId === 'social' ? socialDetails : hltbDetails;
    const raw = lib.getItems(bookId, sec);
    const allSteps = raw.map(it => {
      const d = detailMap[it.id] || {};
      return {
        id: it.id,
        no: it.n,
        noLabel: pad(it.n),
        title: it.t,
        plain: it.p || '',
        tip: it.tip || '',
        grade: it.grade ? '证据 ' + it.grade + ' 级' : '',
        lens: (it.cost && it.cost.lens) || '',
        disputed: !!it.disputed,
        costText: d.costText || '',
        gainText: d.gainText || '',
        remark: d.remark || '',
        source: d.source || '',
        links: d.links || [],
        evType: d.evType || '',
        costOpen: false,
        gainOpen: false,
        noteOpen: false,
        refsOpen: false
      };
    });

    const chapters = lib.getChapters(bookId);
    const idx = chapters.findIndex(c => c.sec === sec);
    const topicTags = (chapter.topicIds || []).slice(0, 3)
      .map(id => (lib.getTopic(id) || {}).short || '')
      .filter(Boolean);
    const totalWords = raw.reduce((s, it) => s + (it.p || '').length, 0);

    this._steps = allSteps;
    this.setData({
      viewState: 'ready',
      bookId: bookId,
      sec: sec,
      chapter: chapter,
      bookTitle: book.title || '',
      accent: book.accent || '#226B60',
      topicTags: topicTags,
      readMinutes: Math.max(1, Math.round(totalWords / 300)),
      updatedLabel: (chapter.updatedAt || '').slice(5, 10).replace('-', '/'),
      list: allSteps.slice(0, PAGE_SIZE),
      shownCount: Math.min(PAGE_SIZE, allSteps.length),
      hasMore: allSteps.length > PAGE_SIZE,
      prevSec: idx > 0 ? chapters[idx - 1].sec : 0,
      nextSec: idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1].sec : 0
    });

    lib.setProgress(bookId, sec);
    wx.setNavigationBarTitle({ title: chapter.title.slice(0, 14) });
  },

  onToggleFold(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch['list[' + idx + '].' + field] = !this.data.list[idx][field];
    this.setData(patch);
  },

  loadMore() {
    const all = this._steps || [];
    const next = Math.min(this.data.shownCount + PAGE_SIZE, all.length);
    if (next === this.data.shownCount) return;
    this.setData({ list: all.slice(0, next), shownCount: next, hasMore: next < all.length });
  },

  onReachBottom() { this.loadMore(); },

  onItemTap(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onChapterNav(e) {
    const sec = Number(e.currentTarget.dataset.sec);
    if (!sec) return;
    wx.redirectTo({ url: '/pkg-read/chapter/chapter?book=' + this.data.bookId + '&sec=' + sec });
  },

  onOpenLibrary() { wx.switchTab({ url: '/pages/catalog/catalog' }); }
});
