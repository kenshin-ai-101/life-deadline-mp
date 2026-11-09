const store = require('../../utils/store.js');
const rules = require('../../data/rules.js');
const date = require('../../utils/date.js');

const THREE_YEARS_AGO = date.addYears(date.today(), -3);
const ONE_YEAR_LATER = date.addYears(date.today(), 1);

Page({
  data: {
    viewState: 'ready',
    eventNames: [],
    eventKeys: [],
    selectedIndex: 0,
    selected: null,
    anchorDate: date.today(),
    dateStart: THREE_YEARS_AGO,
    dateEnd: ONE_YEAR_LATER,
    note: '',
    warning: '',
    warningType: '',
    canSubmit: true
  },

  onLoad(query) {
    const keys = rules.events.map(e => e.key);
    const names = rules.events.map(e => e.name);
    let idx = keys.indexOf(query.key || '');
    if (idx < 0) idx = 0;
    this.setData({ eventKeys: keys, eventNames: names, selectedIndex: idx });
    this.applySelection(idx, date.today());
  },

  applySelection(idx, anchor) {
    const tpl = rules.events[idx];
    const warnings = this.checkDate(anchor);
    this.setData({
      selectedIndex: idx,
      selected: {
        key: tpl.key,
        name: tpl.name,
        badge: tpl.badge,
        desc: tpl.desc,
        anchorLabel: tpl.anchorLabel,
        sectionsText: '主要依据：第 ' + (tpl.sections || []).join('、') + ' 节',
        ruleCount: (tpl.rules || []).length,
        actionCount: (tpl.actions || []).length,
        previewText: (tpl.rules || []).length
          ? '将生成 ' + (tpl.rules || []).length + ' 条时限动作 + ' + (tpl.actions || []).length + ' 条书中建议'
          : '将生成 ' + (tpl.actions || []).length + ' 条书中建议（该事件没有已核实的法定时限）'
      },
      anchorDate: anchor,
      warning: warnings.text,
      warningType: warnings.type
    });
  },

  checkDate(value) {
    const n = date.diffDays(value, date.today()); // 今天 - 所选
    if (n < 0) return { type: 'blue', text: '这是未来日期，倒计时将从该日期开始，之前不会提醒。' };
    if (n > 1095) return { type: 'warn', text: '本事件的大部分时限可能已经过去。仍可创建，时间轴会默认展开「已过期」段并保留补救路径。' };
    return { type: '', text: '' };
  },

  onEventChange(e) { this.applySelection(Number(e.detail.value), this.data.anchorDate); },

  onDateChange(e) {
    const value = e.detail.value;
    const w = this.checkDate(value);
    this.setData({ anchorDate: value, warning: w.text, warningType: w.type });
  },

  onNote(e) { this.setData({ note: e.detail.value }); },

  submit() {
    const tpl = rules.events[this.data.selectedIndex];
    if (!tpl) return;
    if (!date.parse(this.data.anchorDate)) {
      wx.showToast({ title: '请选一个有效日期', icon: 'none' });
      return;
    }
    const result = store.createEvent(tpl.key, this.data.anchorDate, this.data.note);
    if (!result) {
      wx.showToast({ title: '创建失败，请重试', icon: 'none' });
      return;
    }
    wx.showToast({ title: '时间轴已生成', icon: 'success' });
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/timeline/timeline?id=' + result.event.id });
    }, 500);
  }
});
