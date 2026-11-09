const items = require('../../data/items.js');
const socialItems = require('../../data/social-items.js');
const details = require('../data/details.js');
const socialDetails = require('../../data/social-details.js');
const store = require('../../utils/store.js');
const fmt = require('../../utils/format.js');
const lib = require('../../utils/library.js');
const date = require('../../utils/date.js');
const meta = require('../../data/meta.js');

const ITEM_MAP = {};
items.forEach(it => { ITEM_MAP[it.id] = it; });
socialItems.forEach(it => { ITEM_MAP[it.id] = it; });

// 三类条目底部固定免责话术（PRD 第五章第一节）
const DISCLAIMERS = [
  { test: /急救|按压|120|噎|大出血|烫伤|溺水|中毒/, text: '本条涉及急救处置，不替代专业急救培训。现场请优先听从 120 调度员指导。' },
  { test: /药|剂量|服用|疫苗|筛查|复查/, text: '本条涉及用药与医疗处置，具体方案请遵医嘱，不要据此自行停药、换药或调整剂量。' },
  { test: /法|条例|仲裁|诉讼|维权|合同|继承|遗嘱/, text: '本条涉及法律程序，各地执行口径可能不同，具体请以当地部门答复和专业法律意见为准。' }
];

Page({
  data: {
    viewState: 'loading',
    item: null,
    detail: null,
    badges: [],
    grade: '',
    evType: '',
    disclaimer: '',
    sourceOpen: false,
    evidenceOpen: false,
    favorited: false,
    inTask: false,
    section: '',
    bookTitle: '',
    bookLicense: '',
    isSocial: false,
    tip: '',
    versionLabel: '',
    footerNote: '',
    meta: meta,
    seenCommit: '',
    evidence: null,
    showRemindPicker: false,
    remindDate: ''
  },

  onLoad(query) {
    const id = query.id || '';
    const it = ITEM_MAP[id];
    const bookId = fmt.bookIdOf(id);
    const detailMap = bookId === 'social' ? socialDetails : details;
    const d = detailMap[id];
    if (!it) {
      this.setData({ viewState: 'missing' });
      return;
    }
    const book = lib.getBook(bookId) || {};
    const isSocial = bookId === 'social';
    const disclaimer = DISCLAIMERS.filter(x => x.test.test(it.t + ' ' + it.p))[0];
    this.setData({
      viewState: 'ready',
      item: it,
      detail: d || null,
      badges: fmt.costBadges(it),
      grade: fmt.gradeText(it.grade),
      evType: fmt.evText(it.ev),
      disclaimer: disclaimer ? disclaimer.text : '',
      section: fmt.sectionTitle(it.s, bookId),
      bookTitle: book.title || '',
      bookLicense: book.license || '',
      isSocial: isSocial,
      tip: it.tip || '',
      versionLabel: isSocial ? (book.updatedAt || '2026-10-23') : (meta.commit + ' · ' + meta.builtAt),
      footerNote: isSocial
        ? '字段顺序与文案来自《人情世故指南》原书，机器编译，未经逐条人工复核。内容许可 CC BY 4.0。本工具不替代专业法律、医疗与急救建议。'
        : '字段顺序与文案来自《高性价比人生指南》原书，机器编译，未经逐条人工复核。内容许可 CC BY-NC-SA 4.0。本工具不替代专业医疗、法律与急救建议。',
      favorited: store.isFavorite(id),
      inTask: store.isItemInTask(id),
      seenCommit: store.read('ld_seen_commit', meta.commit),
      remindDate: date.today(),
      dateEnd: date.addYears(date.today(), 2),
      evidence: this.buildEvidence(it, d),
      linkCount: d && d.links ? d.links.length : 0
    });
    wx.setNavigationBarTitle({ title: it.t.slice(0, 14) });
    store.track('item_view', { item_id: id, from: query.from || 'unknown' });
  },

  buildEvidence(it, d) {
    const gain = d ? d.gainText : '';
    const nums = (gain.match(/\d[\d,.]*\s*(万人|人|例|年|个月|周|天)/g) || []).slice(0, 4);
    // 争议条目：从备注里试着切出正反两段，切不出就如实说明
    const remark = d ? d.remark : '';
    const splitMark = remark.search(/但(是)?|不过|另一方面|相反|争议/);
    let pro = '', con = '';
    if (it.disputed && splitMark > 0) {
      pro = remark.slice(0, splitMark);
      con = remark.slice(splitMark);
    }
    return {
      type: fmt.evText(it.ev),
      machineNote: '证据类型为机器抽取，尚未完成人工抽检，仅供参考。',
      sample: nums.length ? nums.join(' · ') : '原文未提供样本量 / 随访年限 / 研究设计',
      hasBoth: !!(pro && con),
      pro: pro,
      con: con,
      noConText: it.disputed
        ? '本条标注了争议，但原文没有单独分出反方段落，正反依据请连同备注与来源一起看。'
        : '本条未标注争议。原文未提供反方证据段落。',
      relativeHint: '「下降 12%」这类数字通常是相对风险。基线风险低的人，绝对收益会小得多，别直接套到自己身上。'
    };
  },

  noop() {},

  toggleSource() { this.setData({ sourceOpen: !this.data.sourceOpen }); },
  toggleEvidence() { this.setData({ evidenceOpen: !this.data.evidenceOpen }); },

  copyLink(e) {
    const url = e.currentTarget.dataset.url;
    wx.setClipboardData({ data: url });
    wx.showToast({ title: '链接已复制', icon: 'none' });
  },

  copyAllLinks() {
    const links = (this.data.detail || {}).links || [];
    if (!links.length) {
      wx.showToast({ title: '这条没有外链', icon: 'none' });
      return;
    }
    wx.setClipboardData({ data: links.join('\n') });
  },

  toggleFavorite() {
    const id = this.data.item.id;
    const on = store.toggleFavorite(id);
    this.setData({ favorited: on });
    wx.showToast({ title: on ? '已收藏到本机' : '已取消收藏', icon: 'none' });
  },

  openRemindPicker() { this.setData({ showRemindPicker: true }); },
  closeRemindPicker() { this.setData({ showRemindPicker: false }); },
  onRemindDate(e) { this.setData({ remindDate: e.detail.value }); },

  addWithoutRemind() {
    this.commitTask('');
    this.setData({ showRemindPicker: false });
  },

  addWithRemind() {
    this.commitTask(this.data.remindDate);
    this.setData({ showRemindPicker: false });
  },

  commitTask(remindDate) {
    const id = this.data.item.id;
    const t = store.addItemTask(id, remindDate);
    if (!t) {
      wx.showToast({ title: '这条已经在清单里了', icon: 'none' });
      this.setData({ inTask: true });
      return;
    }
    this.setData({ inTask: true });
    wx.showToast({ title: remindDate ? '已加入并设提醒' : '已加入无期限待办', icon: 'none' });
  },

  goFilter() { wx.navigateTo({ url: '/pkg-read/filter/filter' }); },

  onShareAppMessage() {
    const it = this.data.item;
    return {
      title: it ? it.t : '人生时限',
      path: '/pkg-read/detail/detail?id=' + (it ? it.id : ''),
      imageUrl: ''
    };
  }
});
