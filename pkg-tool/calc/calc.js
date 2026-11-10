// 四个纯前端算账器：计算模型见 utils/calc-models.js（真实口径，可被 Node 测试直接调用）。
// 合规：预填值都是「示例输入」，不是书中口径；结果只报数，不给倾向性结论，也不连接投资或职业建议。

const calcModels = require('../../utils/calc-models.js');

function viewOf(model) {
  return { key: model.key, name: model.name, back: model.back, intro: model.intro };
}

Page({
  data: {
    types: [],
    activeKey: 'pension',
    active: null,
    fields: [],
    results: [],
    error: ''
  },

  onLoad() {
    this.setData({ types: calcModels.MODELS.map(m => ({ key: m.key, name: m.name })) });
    this.select('pension');
  },

  select(key) {
    const t = calcModels.MODELS.filter(x => x.key === key)[0] || calcModels.MODELS[0];
    this._model = t;
    this.setData({
      activeKey: t.key,
      active: viewOf(t),
      fields: t.fields.map(f => ({
        key: f.key,
        label: f.label,
        value: f.value,
        type: f.type || 'number',
        options: f.options || []
      })),
      results: [],
      error: ''
    });
  },

  tapType(e) { this.select(e.currentTarget.dataset.key); },

  onInput(e) {
    const i = e.currentTarget.dataset.index;
    const patch = {};
    patch['fields[' + i + '].value'] = e.detail.value;
    patch.results = [];
    patch.error = '';
    this.setData(patch);
  },

  onChoice(e) {
    const i = e.currentTarget.dataset.index;
    const value = e.currentTarget.dataset.value;
    if (this.data.fields[i].value === value) return;
    const patch = {};
    patch['fields[' + i + '].value'] = value;
    patch.results = [];
    patch.error = '';
    this.setData(patch);
  },

  run() {
    const t = this._model;
    if (!t) return;
    const values = {};
    this.data.fields.forEach(f => { values[f.key] = f.value; });
    const res = t.calc(values);
    if (!res) {
      this.setData({ results: [], error: t.invalid || '请检查输入的数字。' });
      return;
    }
    this.setData({ results: res, error: '' });
    require('../../utils/store.js').track('calc_run', { type: t.key });
  },

  goCatalog() {
    wx.switchTab({ url: '/pages/catalog/catalog' });
  }
});
