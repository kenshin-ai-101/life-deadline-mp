const ms = require('../../utils/mine-stats.js');

Page({
  data: {
    types: [],
    activeType: 'events',
    active: null,
    rows: [],
    isReceipts: false,
    expandedId: '',
    scrollIntoView: ''
  },

  onLoad(query) {
    this.setData({ activeType: ms.typeOf(query.type || 'events').key });
  },

  onShow() { this.refresh(); },

  refresh() {
    const key = ms.typeOf(this.data.activeType).key;
    const active = ms.typeOf(key);
    const types = ms.TYPES.map(t => ({
      key: t.key, short: t.short, label: t.label, value: ms.countOf(t.key)
    }));
    this.setData({
      types: types,
      activeType: key,
      active: active,
      rows: ms.rowsOf(key),
      isReceipts: key === 'receipts',
      expandedId: '',
      scrollIntoView: 'sd-tab-' + key
    });
    wx.setNavigationBarTitle({ title: active.label + ' · 明细' });
  },

  switchType(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeType) return;
    this.setData({ activeType: key });
    this.refresh();
  },

  onRowTap(e) {
    const ds = e.currentTarget.dataset;
    if (this.data.isReceipts) {
      this.setData({ expandedId: this.data.expandedId === ds.id ? '' : ds.id });
      return;
    }
    if (!ds.url) {
      wx.showToast({ title: '这条暂时没有可打开的详情', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: ds.url });
  },

  previewImage(e) {
    const ds = e.currentTarget.dataset;
    const urls = ds.urls || [];
    if (!urls.length) return;
    wx.previewImage({ current: ds.current || urls[0], urls: urls });
  },

  openRelated(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) {
      wx.showToast({ title: '关联动作已删除', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: url });
  },

  goCta() {
    wx.switchTab({ url: this.data.active.tab });
  }
});
