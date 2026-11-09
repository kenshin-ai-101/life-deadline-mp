const fmt = require('../../utils/format.js');

const GROUPS = [
  { key: 'grade', label: '证据等级' },
  { key: 'money', label: '花钱' },
  { key: 'time', label: '时间' },
  { key: 'will', label: '毅力' },
  { key: 'gain', label: '收益档位' },
  { key: 'lens', label: '口径' },
  { key: 'who', label: '人群' },
  { key: 'ev', label: '证据类型' }
];

Page({
  data: {
    options: {},
    facets: [],
    filters: {},
    disputedOnly: false,
    groups: [],
    total: 0,
    searched: false
  },

  onLoad() {
    const options = fmt.facetOptions();
    const facets = GROUPS.filter(g => options[g.key] && options[g.key].length).map(g => ({
      key: g.key,
      label: g.label,
      values: options[g.key].slice(0, 12)
    }));
    this.setData({ options: options, facets: facets });
    this.apply();
  },

  markSelected(facets, filters) {
    return facets.map(f => Object.assign({}, f, {
      values: f.values.map(v => Object.assign({}, v, { selected: filters[f.key] === v.value }))
    }));
  },

  choose(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.currentTarget.dataset.value;
    const filters = Object.assign({}, this.data.filters);
    filters[key] = filters[key] === value ? '' : value;
    this.setData({ filters: filters, facets: this.markSelected(this.data.facets, filters) });
    this.apply();
  },

  toggleDisputed(e) {
    this.setData({ disputedOnly: e.detail.value });
    this.apply();
  },

  reset() {
    this.setData({ filters: {}, disputedOnly: false, facets: this.markSelected(this.data.facets, {}) });
    this.apply();
  },

  apply() {
    // 本页的成本/证据分面只由主书生成，检索也限定主书，避免混入另一本的口径
    const filters = Object.assign({ book: 'hltb' }, this.data.filters, { disputed: this.data.disputedOnly });
    const list = fmt.search('', filters);
    const byLens = {};
    list.forEach(it => {
      const k = it.cost.lens || '未标注口径';
      if (!byLens[k]) byLens[k] = [];
      if (byLens[k].length < 30) byLens[k].push({
        id: it.id, title: it.t, plain: it.p, grade: fmt.gradeText(it.grade),
        ev: fmt.evText(it.ev), disputed: it.disputed
      });
    });
    const groups = Object.keys(byLens).map(k => ({
      lens: k,
      count: list.filter(it => (it.cost.lens || '未标注口径') === k).length,
      items: byLens[k]
    }));
    this.setData({ groups: groups, total: list.length, searched: true });
  },

  goItem(e) {
    wx.navigateTo({ url: '/pkg-read/detail/detail?id=' + e.currentTarget.dataset.id });
  }
});
