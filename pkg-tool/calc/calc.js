// 四个纯前端算账器。
// 合规：书中没有可直接套用的统一参数，所有预填值都是「示例输入」，不是书中口径；
// 结果不给倾向性结论，也不连接任何投资或职业建议。

const TYPES = [
  {
    key: 'pension', name: '养老保险回本', back: '第 5 节',
    fields: [
      { key: 'paid', label: '累计已缴金额（元）', value: '120000' },
      { key: 'monthly', label: '预计每月领取（元）', value: '3000' }
    ],
    calc: v => {
      const paid = Number(v.paid), monthly = Number(v.monthly);
      if (!(paid > 0) || !(monthly > 0)) return null;
      const months = Math.ceil(paid / monthly);
      return [
        { label: '回本需要', value: months + ' 个月' },
        { label: '折合', value: (months / 12).toFixed(1) + ' 年' },
        { label: '口径', value: '只算本金收回，不计利息、通胀与调待' }
      ];
    }
  },
  {
    key: 'mortgage', name: '提前还房贷', back: '第 15 节',
    fields: [
      { key: 'principal', label: '剩余本金（元）', value: '800000' },
      { key: 'rate', label: '年利率（%）', value: '3.5' },
      { key: 'months', label: '剩余期数（月）', value: '240' },
      { key: 'prepay', label: '打算提前还（元）', value: '100000' }
    ],
    calc: v => {
      const p = Number(v.principal), r = Number(v.rate), m = Number(v.months), pre = Number(v.prepay);
      if (!(p > 0) || !(r >= 0) || !(m > 0) || !(pre > 0) || pre > p) return null;
      const save = pre * (r / 100 / 12) * m;
      return [
        { label: '按单利近似可省利息', value: Math.round(save).toLocaleString() + ' 元' },
        { label: '提前还款后剩余本金', value: Math.round(p - pre).toLocaleString() + ' 元' },
        { label: '口径', value: '单利近似，未考虑等额本息重算、违约金与利率重定价' }
      ];
    }
  },
  {
    key: 'child', name: '养孩子到 18 岁', back: '第 18 节',
    fields: [
      { key: 'year1', label: '第一年支出（元）', value: '30000' },
      { key: 'growth', label: '每年增长（%）', value: '3' }
    ],
    calc: v => {
      const first = Number(v.year1), g = Number(v.growth) / 100;
      if (!(first > 0) || g < -0.9) return null;
      let sum = 0, yearly = first;
      for (let i = 0; i < 18; i += 1) { sum += yearly; yearly *= (1 + g); }
      return [
        { label: '18 年累计支出', value: Math.round(sum).toLocaleString() + ' 元' },
        { label: '年均', value: Math.round(sum / 18).toLocaleString() + ' 元' },
        { label: '口径', value: '只按你填的固定增长率外推，不含通胀与一次性大额支出' }
      ];
    }
  },
  {
    key: 'study', name: '读书还是打工', back: '第 23 节',
    fields: [
      { key: 'years', label: '读书年数', value: '4' },
      { key: 'loss', label: '读书期间每年少挣（元）', value: '60000' },
      { key: 'gain', label: '毕业后每年多挣（元）', value: '30000' }
    ],
    calc: v => {
      const y = Number(v.years), loss = Number(v.loss), gain = Number(v.gain);
      if (!(y > 0) || !(loss >= 0) || !(gain > 0)) return null;
      const total = y * loss;
      return [
        { label: '累计收入损失', value: Math.round(total).toLocaleString() + ' 元' },
        { label: '按年收入差回本', value: (total / gain).toFixed(1) + ' 年' },
        { label: '口径', value: '不计学费、不计工资增长与就业概率，只按你填的三个数算' }
      ];
    }
  }
];

Page({
  data: {
    types: TYPES,
    activeKey: 'pension',
    active: null,
    fields: [],
    results: [],
    error: ''
  },

  onLoad() { this.select('pension'); },

  select(key) {
    const t = TYPES.filter(x => x.key === key)[0];
    this.setData({
      activeKey: key,
      active: t,
      fields: t.fields.map(f => ({ key: f.key, label: f.label, value: f.value })),
      results: [],
      error: ''
    });
  },

  tapType(e) { this.select(e.currentTarget.dataset.key); },

  onInput(e) {
    const i = e.currentTarget.dataset.index;
    const patch = {};
    patch['fields[' + i + '].value'] = e.detail.value;
    this.setData(patch);
  },

  run() {
    const t = this.data.active;
    const values = {};
    this.data.fields.forEach(f => { values[f.key] = f.value; });
    const res = t.calc(values);
    if (!res) {
      this.setData({ results: [], error: '请检查输入：金额需为正数，提前还款额不能超过剩余本金。' });
      return;
    }
    this.setData({ results: res, error: '' });
    require('../../utils/store.js').track('calc_run', { type: t.key });
  },

  goCatalog() {
    wx.switchTab({ url: '/pages/catalog/catalog' });
  }
});
