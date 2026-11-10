const store = require('../../utils/store.js');
const meta = require('../../data/meta.js');
const mineStats = require('../../utils/mine-stats.js');
const calcModels = require('../../utils/calc-models.js');

Page({
  data: {
    meta: meta,
    calcCount: calcModels.MODELS.length,
    stats: [],
    trackRows: [],
    limits: [
      '订阅消息只做站内提醒，正式下发需配置模板与服务端',
      '跨设备同步、家庭成员绑定、回执上云未接入',
      '拼音检索未实现，当前只支持标题与说人话的中文全文匹配',
      '语音朗读需接入微信同声传译插件',
      '证据类型为机器抽取，尚未完成 50 条人工抽检',
      '详情里的收益与来源长文为节选，链接为全量抽取'
    ],
    trackLabels: {
      app_open: '打开小程序', event_create: '新建事件', task_done: '完成动作',
      item_view: '查看条目', item_favorite: '收藏条目', item_to_task: '条目转待办',
      search: '搜索', calc_run: '使用算账器', member_create: '新建成员', receipt_add: '存回执'
    }
  },

  onShow() { this.refresh(); },

  refresh() {
    // 统计口径统一由 utils/mine-stats.js 提供，与统计明细页共用
    const s = mineStats.stats();
    const track = store.getTrack();
    const labels = this.data.trackLabels;
    const rows = Object.keys(track)
      .filter(k => labels[k])
      .map(k => ({ key: k, label: labels[k], count: track[k].count }))
      .sort((a, b) => b.count - a.count);
    this.setData({ stats: s, trackRows: rows });
  },

  onStatTap(e) {
    const type = e.currentTarget.dataset.type || 'events';
    wx.navigateTo({ url: '/pages/stat-detail/stat-detail?type=' + type });
  },

  goCalc() { wx.navigateTo({ url: '/pkg-tool/calc/calc' }); },
  goElder() { wx.navigateTo({ url: '/pkg-family/elder/elder' }); },
  goAid() { wx.navigateTo({ url: '/pkg-aid/aid-list/aid-list' }); },

  copyVersion() {
    wx.setClipboardData({
      data: '人生时限 · 内容版本 ' + meta.commit + '\n'
        + meta.sections + ' 节 / ' + meta.items + ' 条 / ' + meta.aidCards + ' 张急救卡\n'
        + '生成于 ' + meta.builtAt + '\n来源 ' + meta.source
    });
  },

  clearAll() {
    wx.showModal({
      title: '清空本机所有数据？',
      content: '事件、待办、成员、收藏、回执和埋点都会被删除，且不可恢复。内容数据不受影响。',
      confirmColor: '#C0392B',
      success: res => {
        if (!res.confirm) return;
        store.clearAll();
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  },

  copyFeedback() {
    wx.setClipboardData({ data: '【人生时限 · 内容报错】条目编号：\n原文写法：\n疑似问题：\n依据或官方链接：' });
    wx.showToast({ title: '报错模板已复制', icon: 'none' });
  }
});
