const store = require('../../utils/store.js');
const meta = require('../../data/meta.js');
const mineStats = require('../../utils/mine-stats.js');
const calcModels = require('../../utils/calc-models.js');
const sync = require('../../utils/sync.js');

function ago(ts) {
  if (!ts) return '还没同步过';
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚同步';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前同步';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前同步';
  return Math.floor(d / 86400000) + ' 天前同步';
}

Page({
  data: {
    meta: meta,
    calcCount: calcModels.MODELS.length,
    stats: [],
    trackRows: [],
    syncLabel: 'DATA',
    syncTitle: '仅保存在本机',
    syncDetail: '未开启云同步',
    syncHint: '换手机或清缓存会丢失',
    syncTone: 'pending',
    limits: [
      '暂未开放微信订阅消息推送，到期提醒以站内红点与清单呈现',
      '家庭成员为单机记录，暂无多人协同与双向确认流程',
      '检索支持标题与正文中文匹配，不支持拼音输入',
      '暂未提供语音朗读',
      '证据类型由机器抽取，人工抽检仍在进行中',
      '详情页的收益与来源为节选，原文链接为完整来源'
    ],
    trackLabels: {
      app_open: '打开小程序', event_create: '新建事件', task_done: '完成动作',
      item_view: '查看条目', item_favorite: '收藏条目', item_to_task: '条目转待办',
      search: '搜索', calc_run: '使用算账器', member_create: '新建成员', receipt_add: '存回执'
    }
  },

  onLoad() {
    this.unsubscribe = sync.subscribe(() => this.refreshSync());
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
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
    this.refreshSync();
  },

  refreshSync() {
    const s = sync.status();
    let title = '仅保存在本机';
    let detail = '未开启云同步';
    let hint = '换手机或清缓存会丢失';
    let tone = 'pending';

    if (s.mode === 'local') {
      title = s.envConfigured ? '云同步已关闭' : '仅保存在本机';
      detail = s.envConfigured ? '你手动关闭了云端同步' : '当前构建未配置云环境';
      hint = '数据只在这台手机，可随时在隐私页开启';
    } else if (s.status === 'ok') {
      title = '已开启云端同步';
      detail = '本机缓存 + 云端主库';
      hint = ago(s.lastSyncAt) + (s.pending ? ' · 有 ' + s.pending + ' 类待上传' : '');
      tone = 'ok';
    } else if (s.status === 'syncing') {
      title = '正在同步';
      detail = '本机缓存 + 云端主库';
      hint = '首次同步会稍慢一点';
      tone = 'pending';
    } else if (s.status === 'offline') {
      title = '离线中';
      detail = '数据已存本机，联网后自动补传';
      hint = s.lastError || '网络不可用';
      tone = 'warn';
    } else if (s.status === 'error') {
      title = '同步失败';
      detail = '数据仍在本机，不会丢';
      hint = s.lastError || '稍后可手动重试';
      tone = 'warn';
    }

    this.setData({
      syncLabel: s.mode === 'cloud' && s.status === 'ok' ? 'SYNCED' : 'DATA',
      syncTitle: title,
      syncDetail: detail,
      syncHint: hint,
      syncTone: tone
    });
  },

  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

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
    const s = sync.status();
    const cloud = s.mode === 'cloud';
    wx.showModal({
      title: cloud ? '清空本机与云端数据？' : '清空本机所有数据？',
      content: cloud
        ? '事件、待办、成员、收藏、回执和埋点都会被删除：本机缓存立即清空，云端在下次联网时物理删除，不可恢复。内容数据不受影响。'
        : '事件、待办、成员、收藏、回执和埋点都会被删除，且不可恢复。内容数据不受影响。',
      confirmText: '清空',
      confirmColor: '#C0392B',
      success: res => {
        if (!res.confirm) return;
        store.clearAll();
        this.refresh();
        if (cloud) {
          // 交给同步层去删云端；失败会保留 wipePending 标记，下次自动重试
          sync.syncNow({ full: true }).catch(() => {});
          wx.showToast({ title: '本机已清空，云端待同步删除', icon: 'none' });
        } else {
          wx.showToast({ title: '已清空', icon: 'none' });
        }
      }
    });
  },

  copyFeedback() {
    wx.setClipboardData({ data: '【人生时限 · 内容报错】条目编号：\n原文写法：\n疑似问题：\n依据或官方链接：' });
    wx.showToast({ title: '报错模板已复制', icon: 'none' });
  }
});
