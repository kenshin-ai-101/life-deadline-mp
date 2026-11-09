const store = require('../../utils/store.js');
const rules = require('../../data/rules.js');

const FREE_LIMIT = 2;
const MAX_LIMIT = 6;
const GENDERS = ['女', '男', '不填'];

Page({
  data: {
    members: [],
    freeLimit: FREE_LIMIT,
    maxLimit: MAX_LIMIT,
    showForm: false,
    genders: GENDERS,
    conditionOptions: rules.conditions.map(c => ({ value: c, selected: false })),
    form: { name: '', age: '', genderIndex: 2, conditions: [] },
    formError: '',
    viewState: 'ready'
  },

  onShow() { this.refresh(); },

  refresh() {
    const members = store.getMembers().map(m => ({
      id: m.id,
      name: m.name,
      age: m.age,
      gender: m.gender,
      conditions: m.conditions,
      conditionText: (m.conditions || []).join('、') || '未填写',
      elder: m.age >= 60,
      initials: (m.name || '?').slice(0, 1)
    }));
    this.setData({ members: members });
  },

  openForm() {
    this.setData({
      showForm: true,
      formError: '',
      form: { name: '', age: '', genderIndex: 2, conditions: [] },
      conditionOptions: rules.conditions.map(c => ({ value: c, selected: false }))
    });
  },

  noop() {},

  closeForm() { this.setData({ showForm: false }); },

  onName(e) { this.setData({ 'form.name': e.detail.value }); },
  onAge(e) { this.setData({ 'form.age': e.detail.value }); },
  onGender(e) { this.setData({ 'form.genderIndex': Number(e.detail.value) }); },

  toggleCondition(e) {
    const value = e.currentTarget.dataset.value;
    let list = this.data.form.conditions.slice();
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else if (value === '无') list = ['无'];
    else { list = list.filter(x => x !== '无'); list.push(value); }
    const options = this.data.conditionOptions.map(o =>
      Object.assign({}, o, { selected: list.indexOf(o.value) >= 0 })
    );
    this.setData({ 'form.conditions': list, conditionOptions: options, formError: '' });
  },

  submit() {
    const f = this.data.form;
    if (!f.name.trim()) { this.setData({ formError: '请填一个称呼，比如「妈妈」' }); return; }
    const age = Number(f.age);
    if (!age || age < 0 || age > 120) { this.setData({ formError: '请填 0 到 120 之间的年龄' }); return; }
    if (this.data.members.length >= MAX_LIMIT) {
      this.setData({ formError: '本地演示版最多 6 位成员' });
      return;
    }
    store.addMember({
      name: f.name,
      age: age,
      gender: f.genderIndex === 2 ? '' : GENDERS[f.genderIndex],
      conditions: f.conditions
    });
    this.setData({ showForm: false });
    this.refresh();
    wx.showToast({ title: '成员卡已建', icon: 'none' });
  },

  removeMember(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这张成员卡？',
      content: '只删除本机记录，不涉及任何健康数据上传。',
      confirmColor: '#C0392B',
      success: res => {
        if (res.confirm) { store.removeMember(id); this.refresh(); }
      }
    });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pkg-family/member-detail/member-detail?id=' + e.currentTarget.dataset.id });
  },

  goElder() {
    wx.navigateTo({ url: '/pkg-family/elder/elder' });
  }
});
