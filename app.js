const meta = require('./data/meta.js');
const store = require('./utils/store.js');
const sync = require('./utils/sync.js');
const cfg = require('./utils/config.js');

App({
  globalData: {
    appName: '人生时限',
    meta: meta,
    syncStatus: null,
    cloudReady: false
  },

  onLaunch() {
    // 变更雷达（本地版）：记录首次看到的数据版本。
    // 正式版需由服务端比对上游 updates.json 并触发订阅消息，静态版只展示版本差异提示。
    const seen = store.read('ld_seen_commit', '');
    if (seen && seen !== meta.commit) {
      this.globalData.contentUpdated = true;
    }
    if (!seen) store.write('ld_seen_commit', meta.commit);

    // 本地一有改动就安排一次后台推送（未配置云环境时该钩子什么都不做）
    store.setDirtyHook(() => sync.scheduleFlush());

    // 同步状态变化广播给页面（「我的」页会订阅它显示同步时间）
    sync.subscribe(s => {
      this.globalData.syncStatus = s;
      this.globalData.cloudReady = s.status === 'ok';
    });

    // 启动同步不阻塞首屏：先渲染本地缓存，云端返回后在后台覆盖并通知页面
    sync.bootstrap().then(s => {
      this.globalData.syncStatus = s;
      this.globalData.cloudReady = s.status === 'ok';
    }).catch(() => {});

    store.track('app_open', { commit: meta.commit });
  },

  onShow() {
    // 切回前台补一次增量同步（内部有 30s 节流）
    sync.syncOnShow().catch(() => {});
  },

  onHide() {
    // 离开时尽力推一次，避免刚编辑的内容滞留本机
    sync.syncNow({ full: false }).catch(() => {});
  },

  acknowledgeContentUpdate() {
    store.write('ld_seen_commit', meta.commit);
    this.globalData.contentUpdated = false;
  },

  /** 供页面读取的同步配置信息 */
  syncInfo() {
    return {
      status: sync.status(),
      cloudConfigured: !!cfg.config.cloudEnv,
      privacyVersion: cfg.config.privacyVersion
    };
  }
});
