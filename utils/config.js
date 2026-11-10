// 云开发配置。上线前只需要改这里的 cloudEnv。
//
// 三步拿到 env：
//   1) 微信开发者工具 → 云开发 → 开通，创建环境（按量付费有免费额度）
//   2) 环境列表里复制「环境 ID」，形如 life-deadline-6g1a2b3c
//   3) 填到下面 cloudEnv
// 留空时小程序自动退化为「纯本机模式」，功能全部可用、只是不跨设备，方便本地开发与审核兜底。

const config = {
  // ← 唯一需要手填的一行
  cloudEnv: 'life-deadline-d2g6lakbp51687bd1',

  // 数据同步云函数名（部署时保持一致）
  cloudFn: 'dataSync',

  // 当前小程序版本，用于同步诊断与日志
  appVersion: '1.0.0',

  // 隐私政策版本：改一次文案就要 +1，老用户会被重新要求同意
  privacyVersion: 1,

  // 云端全量同步的最短间隔（毫秒），避免频繁切前后台时反复请求
  syncInterval: 30 * 1000,

  // 单次同步最多打包多少个集合的变更
  pushBatch: 6
};

/** 当前构建是否具备云端能力 */
function cloudEnabled() {
  if (!config.cloudEnv) return false;
  try {
    return typeof wx !== 'undefined' && !!wx.cloud && typeof wx.cloud.init === 'function';
  } catch (e) {
    return false;
  }
}

module.exports = {
  config: config,
  cloudEnabled: cloudEnabled
};
