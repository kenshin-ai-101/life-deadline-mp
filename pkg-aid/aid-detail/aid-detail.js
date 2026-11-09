const aid = require('../data/aid.js');

Page({
  data: {
    card: null,
    steps: [],
    cites: [],
    shareText: ''
  },

  onLoad(query) {
    const card = aid.filter(c => c.key === (query.key || ''))[0];
    if (!card) {
      wx.showToast({ title: '没有这张卡', icon: 'none' });
      return;
    }
    const steps = card.steps.map((s, i) => Object.assign({}, s, { no: i + 1 }));
    const shareText = '【' + card.name + '】\n'
      + steps.map(s => s.no + '. ' + s.text).join('\n')
      + '\n\n出处：' + card.cites.map(c => c.id).join('、')
      + '\n' + card.disclaimer;
    this.setData({ card: card, steps: steps, cites: card.cites, shareText: shareText });
    wx.setNavigationBarTitle({ title: card.name });
  },

  call(e) {
    // PRD：一键拨号使用系统拨号，不做二次确认
    wx.makePhoneCall({ phoneNumber: e.currentTarget.dataset.no, fail: () => {} });
  },

  copyShare() {
    wx.setClipboardData({ data: this.data.shareText });
    wx.showToast({ title: '全文已复制，可发给家人', icon: 'none' });
  },

  goItem(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  }
});
