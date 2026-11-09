const store = require('../../utils/store.js');
const fmt = require('../../utils/format.js');
const rules = require('../../data/rules.js');
const items = require('../../data/items.js');

Page({
  data: {
    viewState: 'loading',
    ownerName: '家人',
    cards: [],
    hotlines: rules.hotlines,
    fallbackText: ''
  },

  onLoad(query) {
    this.memberId = query.member || '';
  },

  onShow() { this.refresh(); },

  refresh() {
    try {
      const members = store.getMembers();
      const m = members.filter(x => x.id === this.memberId)[0]
        || members.filter(x => x.age >= 60)[0]
        || null;

      let list;
      if (m) {
        const saved = store.read('ld_member_items_' + m.id, []);
        const chosen = saved.map(id => store.itemById(id)).filter(Boolean);
        const generated = fmt.buildMemberLists(m).doList.map(x => x.item);
        list = chosen.concat(generated.filter(x => saved.indexOf(x.id) < 0)).slice(0, 8);
      } else {
        // 没有成员卡时给一组通用低风险条目，保证页面绝不空白
        list = items.filter(it => ['13-1', '13-3', '16-1', '17-2', '01-7', '30-4'].indexOf(it.id) >= 0);
      }
      const cards = list.map(it => ({
        id: it.id,
        title: it.t,
        plain: it.p,
        section: fmt.sectionTitle(it.s)
      }));
      this.setData({
        viewState: 'ready',
        ownerName: m ? m.name : '通用清单',
        cards: cards,
        fallbackText: cards.map(c => c.title + '\n' + c.plain).join('\n\n')
      });
    } catch (e) {
      // 加载失败时降级为纯文本，不显示空白页
      this.setData({
        viewState: 'fallback',
        fallbackText: '内容暂时读不出来。紧急情况请直接拨 120。\n人社 12333　医保 12393　心理援助 12356'
      });
    }
  },

  call(e) {
    const no = e.currentTarget.dataset.no;
    wx.makePhoneCall({ phoneNumber: no, fail: () => {} });
  },

  copyText() {
    wx.setClipboardData({ data: this.data.fallbackText });
  }
});
