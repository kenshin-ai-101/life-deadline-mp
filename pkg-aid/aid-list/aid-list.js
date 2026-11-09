const aid = require('../data/aid.js');

Page({
  data: {
    cards: aid.map((c, i) => Object.assign({}, c, {
      no: i + 1 < 10 ? '0' + (i + 1) : String(i + 1),
      primaryPhone: c.phones[0] || '',
      stepCount: c.steps.length
    })),
    count: aid.length
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '处境急救卡' });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pkg-aid/aid-detail/aid-detail?key=' + e.currentTarget.dataset.key });
  },

  call120() {
    wx.makePhoneCall({ phoneNumber: '120', fail: () => {} });
  }
});
