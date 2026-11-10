const store = require('../../utils/store.js');
const sync = require('../../utils/sync.js');
const cfg = require('../../utils/config.js');

const config = cfg.config;

function agoText(ts) {
  if (!ts) return '还没同步过';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  return Math.floor(diff / 86400000) + ' 天前';
}

Page({
  data: {
    privacyVersion: config.privacyVersion,
    privacyUpdatedAt: '2026-11-01',
    envConfigured: !!config.cloudEnv,
    env: config.cloudEnv,
    mode: 'local',
    modeText: '仅本机',
    status: 'idle',
    statusText: '未登录',
    statusTone: 'pending',
    lastSyncText: '还没同步过',
    lastError: '',
    pending: 0,
    cloudSync: true,
    consent: { version: 0, at: 0, sensitive: false, trackOptIn: false },
    consentText: '未同意',
    sensitiveText: '未同意',
    memberCount: 0,
    eventCount: 0,
    receiptCount: 0,
    favoriteCount: 0,
    busy: ''
  },

  onLoad() {
    this.unsubscribe = sync.subscribe(() => this.refresh());
    this.refresh();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const s = sync.status();
    const consent = store.getConsent();
    const members = store.getMembers();
    const events = store.getEvents();
    const receipts = store.getReceipts();
    const favorites = store.getFavorites();

    const statusMap = {
      ok: { text: '已与云端同步', tone: 'ok' },
      syncing: { text: '正在同步…', tone: 'pending' },
      offline: { text: '网络不可用，数据暂存在本机', tone: 'warn' },
      error: { text: '同步失败，数据仍在本机', tone: 'warn' },
      disabled: { text: s.envConfigured ? '已关闭云同步' : '未开通云同步', tone: 'pending' },
      idle: { text: '等待同步', tone: 'pending' }
    };
    const st = statusMap[s.status] || statusMap.idle;

    this.setData({
      mode: s.mode,
      modeText: s.mode === 'cloud' ? '本机缓存 + 云端主库' : '仅保存在本机',
      status: s.status,
      statusText: st.text,
      statusTone: st.tone,
      lastSyncText: agoText(s.lastSyncAt),
      lastError: s.lastError || '',
      pending: s.pending,
      cloudSync: s.cloudSync,
      envConfigured: s.envConfigured,
      env: s.env || '',
      consent: consent,
      consentText: consent.version >= config.privacyVersion
        ? '已同意（v' + consent.version + '）'
        : (consent.version ? '协议已更新，需重新确认' : '未同意'),
      sensitiveText: consent.sensitive ? '已单独同意' : '未同意',
      memberCount: members.length,
      eventCount: events.length,
      receiptCount: receipts.length,
      favoriteCount: favorites.length
    });
  },

  onSyncNow() {
    if (this.data.busy) return;
    if (!this.data.envConfigured) {
      wx.showModal({
        title: '还没配置云环境',
        content: '当前构建没有填写云开发环境 ID，数据只保存在本机。配置方法见 docs/cloud-setup.md。',
        showCancel: false
      });
      return;
    }
    this.setData({ busy: 'sync' });
    wx.showLoading({ title: '同步中', mask: true });
    sync.syncNow({ full: true }).then(res => {
      wx.hideLoading();
      this.setData({ busy: '' });
      if (res && res.ok) wx.showToast({ title: '同步完成', icon: 'success' });
      else wx.showToast({ title: (res && (res.message || res.reason)) || '同步失败', icon: 'none' });
      this.refresh();
    }).catch(e => {
      wx.hideLoading();
      this.setData({ busy: '' });
      wx.showToast({ title: String((e && e.message) || '同步失败'), icon: 'none' });
    });
  },

  onToggleCloudSync(e) {
    const on = e.detail.value;
    if (!on) {
      wx.showModal({
        title: '关闭云同步？',
        content: '关闭后新产生的数据只留在这台手机，云端已有数据不会被删除。换手机或清缓存会再也找不回。',
        confirmText: '关闭',
        success: res => {
          if (!res.confirm) {
            this.setData({ cloudSync: true });
            return;
          }
          sync.setCloudSync(false);
          this.refresh();
        }
      });
      return;
    }
    sync.setCloudSync(true);
    wx.showToast({ title: '已开启，正在登录…', icon: 'none' });
    this.refresh();
  },

  onExport() {
    wx.showLoading({ title: '打包数据', mask: true });
    sync.exportData().then(res => {
      wx.hideLoading();
      const json = JSON.stringify(res.data, null, 2);
      const name = 'life-deadline-export-' + new Date().toISOString().slice(0, 10) + '.json';
      try {
        const fs = wx.getFileSystemManager();
        const path = wx.env.USER_DATA_PATH + '/' + name;
        fs.writeFileSync(path, json, 'utf8');
        if (wx.shareFileMessage) {
          wx.shareFileMessage({ filePath: path, fileName: name });
          wx.showToast({ title: res.source === 'cloud' ? '已取云端数据' : '已取本机数据', icon: 'none' });
          return;
        }
      } catch (err) {
        // 落盘失败就退回剪贴板
      }
      wx.setClipboardData({
        data: json,
        success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' })
      });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '导出失败，请稍后再试', icon: 'none' });
    });
  },

  onDeleteCloud() {
    wx.showModal({
      title: '删除云端全部数据？',
      content: '云端的事件、待办、成员、收藏、回执会被物理删除，无法恢复；本机缓存也会一并清空。距离上次同步前产生的、还没上传的改动同样会丢失。',
      confirmText: '删除',
      confirmColor: '#C0392B',
      success: res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        sync.deleteAccount().then(r => {
          wx.hideLoading();
          if (r.ok) {
            wx.showToast({ title: r.cloud ? '云端数据已删除' : '本机数据已清空', icon: 'success' });
          } else {
            wx.showModal({
              title: '删除失败',
              content: (r.message || '网络异常') + '\n\n请检查网络后重试。数据没有被删除，可以稍后再试。',
              showCancel: false
            });
          }
          this.refresh();
        }).catch(e => {
          wx.hideLoading();
          wx.showToast({ title: String((e && e.message) || '删除失败'), icon: 'none' });
        });
      }
    });
  },

  onRevokeSensitive() {
    wx.showModal({
      title: '撤回敏感信息授权？',
      content: '撤回后，云端留存的成员卡密文会被立即物理删除，本机记录保留（你可随时自行删除）。之后新增的成员卡也不会再上传。',
      confirmText: '撤回',
      confirmColor: '#C0392B',
      success: res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '撤回中', mask: true });
        sync.revokeSensitive().then(r => {
          wx.hideLoading();
          this.refresh();
          if (!r.ok) {
            wx.showModal({
              title: '云端删除失败',
              content: (r.message || '网络异常') + '\n\n本机授权已撤回，但云端密文可能还在。请检查网络后重试。',
              showCancel: false
            });
            return;
          }
          wx.showToast({
            title: r.purged ? '已撤回，云端删除 ' + r.purged + ' 张' : '已撤回授权',
            icon: 'none'
          });
        });
      }
    });
  },

  onToggleTrack(e) {
    const on = e.detail.value;
    sync.pushConsent({ trackOptIn: on }).then(() => {
      this.refresh();
      wx.showToast({ title: on ? '已开启匿名统计' : '已关闭匿名统计', icon: 'none' });
    });
  },

  onAgreePrivacy() {
    sync.pushConsent({ version: config.privacyVersion }).then(() => {
      this.refresh();
      wx.showToast({ title: '已同意', icon: 'success' });
    });
  },

  copyContact() {
    wx.setClipboardData({ data: 'privacy@life-deadline.app' });
    wx.showToast({ title: '邮箱已复制', icon: 'none' });
  }
});
