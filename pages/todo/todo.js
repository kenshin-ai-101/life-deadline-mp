const store = require('../../utils/store.js');
const date = require('../../utils/date.js');
const fmt = require('../../utils/format.js');

// 从知识库单独加入的待办没有 eventId，统一归到这个兜底分组
const NO_EVENT_KEY = '__no_event__';

Page({
  data: {
    tab: 'pending',
    viewState: 'loading',
    grouped: true,
    collapsed: {},
    openTasks: [],
    doneTasks: [],
    openGroups: [],
    doneGroups: [],
    activeGroups: [],
    favorites: [],
    weekCount: 0,
    overdueCount: 0,
    notifyHintDismissed: false
  },

  onShow() { this.refresh(); },

  refresh(collapsedOverride) {
    try {
      const events = store.getEvents();
      const eventMap = {};
      events.forEach(e => { eventMap[e.id] = e; });

      const all = store.getOpenTasks();
      const open = all.filter(t => t.status !== 'done' && t.status !== 'archived').map(t =>
        Object.assign({}, t, {
          eventName: (eventMap[t.eventId] || {}).name || '零散待办',
          dateText: t.deadline ? date.shortDate(t.deadline) : '无期限',
          relText: t.deadline ? (t.customRemind ? '自定义提醒 · ' + t.relLabel : t.relLabel) : '可自定提醒',
          kindLabel: t.kind === 'deadline' ? '时限' : '建议'
        })
      );
      const done = all.filter(t => t.status === 'done').map(t =>
        Object.assign({}, t, {
          eventName: (eventMap[t.eventId] || {}).name || '零散待办',
          dateText: t.deadline ? date.shortDate(t.deadline) : '无期限'
        })
      );
      const favorites = store.getFavorites().map(id => {
        const it = store.itemById(id);
        return it
          ? { id: id, title: it.t, section: fmt.sectionTitle(it.s), grade: it.grade }
          : { id: id, title: '该条目已下线（保留本地快照）', section: '', grade: '' };
      });

      const collapsed = collapsedOverride || this.data.collapsed || {};
      const openGroups = this.buildGroups(open, all, eventMap, collapsed, '项待办');
      const doneGroups = this.buildGroups(done, all, eventMap, collapsed, '项已完成');
      const tab = this.data.tab;

      this.setData({
        viewState: 'ready',
        collapsed: collapsed,
        openTasks: open,
        doneTasks: done,
        openGroups: openGroups,
        doneGroups: doneGroups,
        activeGroups: tab === 'done' ? doneGroups : openGroups,
        favorites: favorites,
        weekCount: open.filter(t => t.bucket === 'week').length,
        overdueCount: open.filter(t => t.bucket === 'overdue').length,
        notifyHintDismissed: store.getSettings().notifyHintDismissed
      });
    } catch (e) {
      this.setData({ viewState: 'error' });
    }
  },

  // 把平铺任务按 eventId 归组；进度按该事件下全部任务统计（含已完成的）
  buildGroups(list, allTasks, eventMap, collapsed, countLabel) {
    const stats = {};
    allTasks.forEach(t => {
      const k = t.eventId || NO_EVENT_KEY;
      if (!stats[k]) stats[k] = { total: 0, done: 0 };
      stats[k].total += 1;
      if (t.status === 'done' || t.status === 'archived') stats[k].done += 1;
    });

    const buckets = {};
    list.forEach(t => {
      const k = t.eventId || NO_EVENT_KEY;
      if (!buckets[k]) {
        const ev = eventMap[k];
        buckets[k] = {
          key: k,
          eventId: t.eventId || '',
          name: ev ? ev.name : '零散待办',
          badge: ev ? ev.name.slice(0, 1) : '·',
          badgePlain: !ev,
          subText: ev
            ? (ev.anchorLabel || '事件') + ' · ' + (ev.anchorDate || '未设日期')
            : '从知识库单独加入，未关联事件',
          createdAt: ev ? (ev.createdAt || 0) : 0,
          tasks: [],
          overdueCount: 0,
          weekCount: 0
        };
      }
      const g = buckets[k];
      g.tasks.push(t);
      if (t.bucket === 'overdue') g.overdueCount += 1;
      if (t.bucket === 'week') g.weekCount += 1;
    });

    return Object.keys(buckets).map(k => {
      const g = buckets[k];
      const s = stats[k] || { total: g.tasks.length, done: 0 };
      return Object.assign(g, {
        countText: g.tasks.length + ' ' + countLabel,
        progressText: s.done + ' / ' + s.total + ' 已办完',
        collapsed: !!collapsed[k],
        urgent: g.overdueCount > 0,
        soon: g.overdueCount === 0 && g.weekCount > 0
      });
    }).sort((a, b) => {
      if (a.key === NO_EVENT_KEY) return 1;
      if (b.key === NO_EVENT_KEY) return -1;
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      if (a.soon !== b.soon) return a.soon ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      tab: tab,
      activeGroups: tab === 'done' ? this.data.doneGroups : this.data.openGroups
    });
  },

  toggleGrouped() { this.setData({ grouped: !this.data.grouped }); },

  toggleGroup(e) {
    const key = e.currentTarget.dataset.key;
    const collapsed = Object.assign({}, this.data.collapsed || {});
    collapsed[key] = !collapsed[key];
    this.refresh(collapsed);
  },

  toggleDone(e) {
    const id = e.currentTarget.dataset.id;
    store.toggleTaskDone(id);
    this.refresh();
  },

  goTimeline(e) {
    const id = e.currentTarget.dataset.event;
    if (!id) return;
    wx.navigateTo({ url: '/pages/timeline/timeline?id=' + id });
  },

  goItem(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  dismissHint() {
    store.saveSettings({ notifyHintDismissed: true });
    this.setData({ notifyHintDismissed: true });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/event-create/event-create' });
  }
});
