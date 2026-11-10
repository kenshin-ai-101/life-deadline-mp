// 章节阅读：复刻《人生指南库》阅读页的条目组织（NO.xx / 说人话 / 怎么说 / chips / 折叠字段）
// 两本书共用：hltb 长文本在本分包 details.js，social 长文本在主包 social-details.js。
'use strict';
const lib = require('../../utils/library.js');
const fmt = require('../../utils/format.js');
const store = require('../../utils/store.js');
const sources = require('../../utils/sources.js');
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
    nextSec: 0,
    isChapterFav: false,
    isLiked: false,
    burstShow: false
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
      const refs = sources.buildRefs(d);
      const chips = fmt.chipModel(it);
      return {
        id: it.id,
        no: it.n,
        noLabel: pad(it.n),
        title: it.t,
        plain: it.p || '',
        tip: it.tip || '',
        grade: chips.grade,
        lensText: chips.lensText,
        costTags: chips.costTags,
        dispute: chips.dispute,
        fav: store.isFavorite(it.id),
        costText: d.costText || '',
        gainText: d.gainText || '',
        remark: d.remark || '',
        refCount: refs.count,
        refMulti: refs.multi,
        refList: refs.refs,
        evType: d.evType || '',
        costOpen: false,
        gainOpen: false,
        noteOpen: false,
        refsOpen: false
      };
    });

    const chapters = lib.getChapters(bookId);
    const idx = chapters.findIndex(c => c.sec === sec);
    // 章头主题标签用完整主题名（与指南库一致）；short 是宫格用的四字缩写，会出现「注意力和」这种半截文案
    const topicTags = (chapter.topicIds || []).slice(0, 3)
      .map(id => {
        const t = lib.getTopic(id) || {};
        return t.name || t.short || '';
      })
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
      nextSec: idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1].sec : 0,
      isChapterFav: store.isChapterFavorite(bookId, sec),
      isLiked: store.isChapterLiked(bookId, sec)
    });

    lib.setProgress(bookId, sec);
    wx.setNavigationBarTitle({ title: chapter.title.slice(0, 14) });
    // 打开右上角菜单的「分享给朋友 / 分享到朋友圈」入口
    try { wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) {}
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

  onStepFavorite(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const step = (this.data.list || [])[idx];
    if (!step) return;
    const on = store.toggleFavorite(step.id);
    if (this._steps && this._steps[idx]) this._steps[idx].fav = on;
    const patch = {};
    patch['list[' + idx + '].fav'] = on;
    this.setData(patch);
    wx.showToast({ title: on ? '已收藏到本机' : '已取消收藏', icon: 'none' });
  },

  onChapterFavorite() {
    const on = store.toggleChapterFavorite(this.data.bookId, this.data.sec);
    this.setData({ isChapterFav: on });
    wx.showToast({ title: on ? '已收藏本章' : '已取消收藏本章', icon: 'none' });
  },

  onLike() {
    const on = store.toggleChapterLike(this.data.bookId, this.data.sec);
    this.setData({ isLiked: on });
    if (on) {
      this.setData({ burstShow: true });
      const page = this;
      setTimeout(() => page.setData({ burstShow: false }), 700);
    }
    wx.showToast({ title: on ? '谢谢鼓励' : '已取消点赞', icon: 'none' });
  },

  onTimelineGuide() {
    wx.showModal({
      title: '分享到朋友圈',
      content: '点击右上角「···」，选择「分享到朋友圈」即可。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onShareAppMessage(e) {
    const ds = (e && ((e.target && e.target.dataset) || (e.currentTarget && e.currentTarget.dataset))) || {};
    const id = ds.id;
    if (id) {
      const it = store.itemById(id);
      if (it) return { title: it.t, path: '/pkg-read/detail/detail?id=' + id };
    }
    const book = lib.getBook(this.data.bookId) || {};
    const ch = this.data.chapter || {};
    return {
      title: (ch.title || '知识库') + ' · ' + (book.title || '人生时限'),
      path: '/pkg-read/chapter/chapter?book=' + this.data.bookId + '&sec=' + this.data.sec
    };
  },

  onShareTimeline() {
    const ch = this.data.chapter || {};
    return {
      title: (ch.title || '知识库') + ' · 人生时限',
      query: 'book=' + this.data.bookId + '&sec=' + this.data.sec
    };
  },

  onCopyRefUrl(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({ data: url });
    wx.showToast({ title: '链接已复制', icon: 'none' });
  },

  onChapterNav(e) {
    const sec = Number(e.currentTarget.dataset.sec);
    if (!sec) return;
    wx.redirectTo({ url: '/pkg-read/chapter/chapter?book=' + this.data.bookId + '&sec=' + sec });
  },

  onOpenLibrary() { wx.switchTab({ url: '/pages/catalog/catalog' }); }
});
