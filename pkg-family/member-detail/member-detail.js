const store = require('../../utils/store.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    viewState: 'loading',
    member: null,
    matchedLabels: [],
    doList: [],
    dontList: [],
    savedIds: [],
    conditionText: ''
  },

  onLoad(query) {
    this.memberId = query.id || '';
  },

  onShow() { this.refresh(); },

  refresh() {
    const m = store.getMembers().filter(x => x.id === this.memberId)[0];
    if (!m) { this.setData({ viewState: 'missing' }); return; }
    const lists = fmt.buildMemberLists(m);
    const savedIds = store.read('ld_member_items_' + m.id, []);
    const decorate = x => ({
      id: x.item.id,
      title: x.item.t,
      plain: x.item.p,
      ruleLabel: x.ruleLabel,
      saved: savedIds.indexOf(x.item.id) >= 0
    });
    this.setData({
      viewState: 'ready',
      member: m,
      matchedLabels: lists.matchedLabels,
      doList: lists.doList.map(decorate),
      dontList: lists.dontList.map(decorate),
      savedIds: savedIds,
      conditionText: (m.conditions || []).join('、') || '未填写'
    });
    wx.setNavigationBarTitle({ title: m.name });
  },

  toggleSave(e) {
    const id = e.currentTarget.dataset.id;
    let list = this.data.savedIds.slice();
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    store.write('ld_member_items_' + this.memberId, list);
    this.refresh();
    wx.showToast({ title: i >= 0 ? '已移出成员清单' : '已加入成员清单', icon: 'none' });
  },

  goItem(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  goElder() {
    wx.navigateTo({ url: '/pkg-family/elder/elder?member=' + this.memberId });
  }
});
