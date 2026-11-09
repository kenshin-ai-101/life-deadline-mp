const meta = require('./data/meta.js');
const store = require('./utils/store.js');

App({
  globalData: {
    appName: '人生时限',
    meta: meta
  },

  onLaunch() {
    // 变更雷达（本地版）：记录首次看到的数据版本。
    // 正式版需由服务端比对上游 updates.json 并触发订阅消息，静态版只展示版本差异提示。
    const seen = store.read('ld_seen_commit', '');
    if (seen && seen !== meta.commit) {
      this.globalData.contentUpdated = true;
    }
    if (!seen) store.write('ld_seen_commit', meta.commit);
    store.track('app_open', { commit: meta.commit });
  },

  acknowledgeContentUpdate() {
    store.write('ld_seen_commit', meta.commit);
    this.globalData.contentUpdated = false;
  }
});
