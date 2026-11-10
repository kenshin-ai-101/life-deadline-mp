const store = require('../../utils/store.js');
const rules = require('../../data/rules.js');
const fmt = require('../../utils/format.js');
const meta = require('../../data/meta.js');
const updates = require('../../utils/updates.js');
const lib = require('../../utils/library.js');
const profile = require('../../utils/profile.js');

const app = getApp();

Page({
  data: {
    viewState: 'loading',
    brand: '人生时限',
    tagline: '把 772 条建议，变成一张不错过的时间表',
    eventGrid: [],
    dash: { activeEvents: [], weekCount: 0, overdueCount: 0, openCount: 0, upcoming: [] },
    daily: null,
    dailySection: '',
    updatesAll: [],
    shownUpdates: [],
    updatesCount: 0,
    updatesTitle: '最近更新',
    updatesExpanded: false,
    heroCount: 0,
    heroSteps: 0,
    hasProfile: false,
    profileTopics: '',
    meta: meta,
    contentUpdated: false,
    notifyHint: ''
  },

  onShow() { this.refresh(); },

  refresh() {
    try {
      const dash = store.getDashboard();
      const daily = store.dailyItem();
      const grid = rules.events.map(e => ({
        key: e.key,
        name: e.name,
        badge: e.badge,
        desc: e.desc,
        countText: (e.rules || []).length
          ? (e.rules || []).length + ' 条时限 · ' + (e.actions || []).length + ' 条建议'
          : (e.actions || []).length + ' 条书中建议'
      }));
      const activeEvents = dash.activeEvents.slice(0, 3).map(ev =>
        Object.assign({}, ev, { progressText: this.progressText(ev.id) })
      );

      let notifyHint = '';
      if (dash.overdueCount > 0) {
        notifyHint = '有 ' + dash.overdueCount + ' 件事已过期，时间轴里保留了补救路径';
      } else if (dash.weekCount > 0) {
        notifyHint = '有 ' + dash.weekCount + ' 件事在 7 天内到期';
      }

      // 「最近更新」：章节级 updatedAt 按天聚合，口径与《人生指南库》为我推荐 tab 一致
      const recent = updates.getRecentUpdates();
      // 「今天想改善什么」：可推荐书籍数 + 已保存画像（与指南库 reco.js render 同源）
      const books = lib.getBooks().filter(b => b.capabilities && b.capabilities.matchable);
      const p = profile.getProfileV2();
      const topicNames = p
        ? (p.topicIds || []).map(id => (lib.getTopic(id) || {}).name).filter(Boolean)
        : [];

      this.setData({
        viewState: 'ready',
        eventGrid: grid,
        dash: Object.assign({}, dash, { activeEvents: activeEvents }),
        daily: daily,
        dailySection: fmt.sectionTitle(daily.s),
        updatesAll: recent.updates,
        shownUpdates: updates.shownUpdates(recent.updates, this.data.updatesExpanded),
        updatesCount: recent.count,
        updatesTitle: recent.title,
        heroCount: books.length,
        heroSteps: books.reduce((n, b) => n + ((b.stats || {}).steps || 0), 0),
        hasProfile: topicNames.length > 0,
        profileTopics: topicNames.slice(0, 2).join('、'),
        contentUpdated: !!app.globalData.contentUpdated,
        notifyHint: notifyHint
      });
    } catch (e) {
      this.setData({ viewState: 'error' });
    }
  },

  progressText(eventId) {
    const list = store.getTasks().filter(t => t.eventId === eventId);
    const done = list.filter(t => t.status === 'done' || t.status === 'archived').length;
    return done + ' / ' + list.length + ' 已办完';
  },

  handleRetry() { this.refresh(); },

  goCreate(event) {
    const key = event.currentTarget.dataset.key;
    wx.navigateTo({ url: '/pages/event-create/event-create?key=' + key });
  },

  goAid() { wx.navigateTo({ url: '/pkg-aid/aid-list/aid-list' }); },

  goTimeline(event) {
    wx.navigateTo({ url: '/pages/timeline/timeline?id=' + event.currentTarget.dataset.id });
  },

  goTodo() { wx.switchTab({ url: '/pages/todo/todo' }); },

  goItem(event) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + event.currentTarget.dataset.id });
  },

  goDaily() {
    if (this.data.daily) {
      wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + this.data.daily.id });
    }
  },

  goLibrary() { wx.switchTab({ url: '/pages/catalog/catalog' }); },

  /** 「今天想改善什么」→ 两步向导（与指南库 onStartWizard 一致） */
  onStartWizard() { wx.navigateTo({ url: '/pkg-insight/wizard/wizard' }); },

  onToggleUpdates() {
    const expanded = !this.data.updatesExpanded;
    this.setData({
      updatesExpanded: expanded,
      shownUpdates: updates.shownUpdates(this.data.updatesAll, expanded)
    });
  },

  onUpdateTap(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pkg-read/chapter/chapter?book=' + d.book + '&sec=' + d.sec });
  },

  dismissUpdate() {
    app.acknowledgeContentUpdate();
    this.setData({ contentUpdated: false });
    wx.showToast({ title: '已记录当前版本', icon: 'none' });
  }
});
