const store = require('../../utils/store.js');
const date = require('../../utils/date.js');
const rules = require('../../data/rules.js');

const GROUP_META = [
  { key: 'overdue', label: '已过期', hint: '不隐藏，保留补救路径' },
  { key: 'week', label: '7 天内', hint: '' },
  { key: 'month', label: '30 天内', hint: '' },
  { key: 'later', label: '更远', hint: '' },
  { key: 'no_deadline', label: '没有法定时限', hint: '原书建议，可自定提醒' },
  { key: 'done', label: '已办完', hint: '' }
];

Page({
  data: {
    viewState: 'loading',
    event: null,
    groups: [],
    total: 0,
    doneCount: 0,
    canDelete: false,
    showAnchorPicker: false,
    anchorTaskId: '',
    anchorDate: date.today(),
    dateStart: date.addYears(date.today(), -3),
    dateEnd: date.addYears(date.today(), 1)
  },

  onLoad(query) {
    this.eventId = query.id || '';
    if (!this.eventId) {
      this.setData({ viewState: 'error' });
      return;
    }
  },

  onShow() { this.refresh(); },

  refresh() {
    const ev = store.getEvents().filter(e => e.id === this.eventId)[0];
    if (!ev) { this.setData({ viewState: 'error' }); return; }
    const raw = store.getTasks().filter(t => t.eventId === this.eventId);
    const decorated = raw.map(t => this.decorate(t));
    const done = decorated.filter(t => t.status === 'done' || t.status === 'archived');
    const open = decorated.filter(t => t.status !== 'done' && t.status !== 'archived');

    const groups = GROUP_META.map(g => {
      const tasks = g.key === 'done'
        ? done
        : open.filter(t => (g.key === 'no_deadline' ? !t.deadline : t.bucket === g.key));
      return { key: g.key, label: g.label, hint: g.hint, tasks: tasks };
    }).filter(g => g.tasks.length > 0);

    const ageDays = Math.floor((Date.now() - ev.createdAt) / 86400000);
    this.setData({
      viewState: 'ready',
      event: ev,
      groups: groups,
      total: raw.length,
      doneCount: done.length,
      canDelete: ageDays <= 7
    });
    wx.setNavigationBarTitle({ title: ev.name });
  },

  decorate(t) {
    const d = store.decorateTask(t);
    const high = t.variance === 'high';
    const vLabel = rules.varianceLabel[t.variance] || '';
    return Object.assign(d, {
      kindText: t.kind === 'deadline' ? '法定时限' : '书中建议',
      showDays: !!t.deadline && !high,
      dayText: high ? '各地不同' : (t.deadline
        ? (t.customRemind ? '自定义提醒 · ' + date.relativeLabel(t.deadline) : date.relativeLabel(t.deadline))
        : ''),
      dateText: t.deadline ? (date.shortDate(t.deadline) + ' ' + date.weekday(t.deadline)) : t.deadlineLabel,
      varianceText: t.variance ? vLabel : '',
      varianceClass: t.variance === 'high' ? 'tag-danger' : (t.variance === 'mid' ? 'tag-warn' : 'tag-plain'),
      materialsText: (t.materials || []).length ? (t.materials.length + ' 份材料') : '',
      materialCount: (t.materials || []).length,
      firstMaterial: (t.materials || [])[0] || '',
      obligorText: t.obligor ? t.obligor + '办' : '',
      remindText: t.customRemind ? ('已设 ' + t.customRemind) : '',
      receiptCount: (t.receiptIds || []).length,
      done: t.status === 'done' || t.status === 'archived'
    });
  },

  noop() {},

  toggleDone(e) {
    const id = e.currentTarget.dataset.id;
    const t = store.getTasks().filter(x => x.id === id)[0];
    if (!t) return;
    if (t.status !== 'done' && t.deadline && date.bucket(t.deadline) === 'overdue') {
      const n = Math.abs(date.diffDays(date.today(), t.deadline));
      wx.showModal({
        title: '本次已逾期 ' + n + ' 天',
        content: '如已无法补救，请联系当地经办部门确认还有没有别的路径。仍要标记为办完吗？',
        confirmText: '标记办完',
        success: res => { if (res.confirm) { store.toggleTaskDone(id); this.refresh(); } }
      });
      return;
    }
    store.toggleTaskDone(id);
    this.refresh();
  },

  openRemind(e) {
    const id = e.currentTarget.dataset.id;
    const t = store.getTasks().filter(x => x.id === id)[0];
    if (!t) return;
    const base = t.deadline || t.customRemind;
    const items = base ? ['截止前 7 天', '截止前 1 天', '取消提醒'] : ['自己设一个提醒日', '取消提醒'];
    wx.showActionSheet({
      itemList: items,
      success: res => {
        const pick = items[res.tapIndex];
        if (pick === '取消提醒') {
          store.updateTask(id, { remindAt: '', customRemind: '' });
          wx.showToast({ title: '已取消', icon: 'none' });
        } else if (pick === '自己设一个提醒日') {
          this.setData({ anchorTaskId: id, showAnchorPicker: true, anchorPickerMode: 'custom' });
        } else {
          const days = pick.indexOf('7') >= 0 ? 7 : 1;
          const when = date.addDays(base, -days);
          store.updateTask(id, { remindAt: when, remindLabel: 'D-' + days });
          wx.showToast({ title: '已记到 ' + date.shortDate(when), icon: 'none' });
        }
        this.refresh();
      },
      fail: () => {}
    });
  },

  openAnchor(e) {
    this.setData({
      anchorTaskId: e.currentTarget.dataset.id,
      anchorDate: date.today(),
      anchorPickerMode: 'anchor',
      showAnchorPicker: true
    });
  },

  onAnchorDateChange(e) { this.setData({ anchorDate: e.detail.value }); },

  closeAnchor() { this.setData({ showAnchorPicker: false }); },

  confirmAnchor() {
    const id = this.data.anchorTaskId;
    const value = this.data.anchorDate;
    if (this.data.anchorPickerMode === 'custom') {
      store.updateTask(id, { customRemind: value, remindAt: value, remindLabel: '自定义' });
      wx.showToast({ title: '已设提醒日', icon: 'none' });
    } else {
      const ok = store.setTaskAnchor(id, value);
      if (!ok) wx.showToast({ title: '规则未找到', icon: 'none' });
    }
    this.setData({ showAnchorPicker: false });
    this.refresh();
  },

  goItem(e) {
    const id = e.currentTarget.dataset.cite;
    if (!id) return;
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + id });
  },

  copyOfficial(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.setClipboardData({ data: text });
    wx.showToast({ title: '入口名称已复制', icon: 'none' });
  },

  uploadReceipt(e) {
    const id = e.currentTarget.dataset.id;
    wx.chooseMedia({
      count: 5,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: res => {
        const paths = (res.tempFiles || []).map(f => f.tempFilePath);
        store.addReceipt(id, '', paths);
        wx.showToast({ title: '回执已存到本机', icon: 'none' });
        this.refresh();
      },
      fail: () => {}
    });
  },

  archiveEvent() {
    wx.showModal({
      title: '归档这个事件？',
      content: '归档后不再出现在首页，数据仍保留在本机。',
      success: res => {
        if (res.confirm) {
          store.archiveEvent(this.eventId);
          wx.navigateBack();
        }
      }
    });
  },

  deleteEvent() {
    wx.showModal({
      title: '删除事件（创建 7 天内可用）',
      content: '会一并删除该事件下的所有待办与回执，且不可恢复。',
      confirmColor: '#C0392B',
      success: res => {
        if (!res.confirm) return;
        const r = store.deleteEvent(this.eventId);
        if (!r.ok) {
          wx.showToast({ title: r.reason === 'TOO_OLD' ? '超过 7 天，请改用归档' : '未找到事件', icon: 'none' });
          return;
        }
        wx.navigateBack();
      }
    });
  },

  shareSummary() {
    const ev = this.data.event;
    if (!ev) return;
    const open = store.getOpenTasks().filter(t => t.eventId === ev.id && t.status !== 'done');
    const text = '【' + ev.name + '】还有 ' + open.length + ' 件事要办\n'
      + open.slice(0, 3).map(t => '· ' + t.title + (t.deadline ? '（' + date.shortDate(t.deadline) + '）' : '')).join('\n');
    wx.setClipboardData({ data: text });
    wx.showToast({ title: '摘要已复制，可粘贴到家庭群', icon: 'none' });
  }
});
