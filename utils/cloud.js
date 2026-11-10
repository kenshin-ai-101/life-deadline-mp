// 云开发的薄封装：初始化、带超时与重试的 callFunction、错误归类。
// 所有网络细节都收在这里，sync.js 只关心「成功 / 失败原因」。
const cfg = require('./config.js');

const config = cfg.config;

const state = {
  inited: false,
  initError: '',
  openid: '',
  calls: 0,
  failures: 0,
  lastError: ''
};

function isReady() {
  return cfg.cloudEnabled() && state.inited;
}

function init() {
  if (state.inited) return true;
  if (!cfg.cloudEnabled()) {
    state.initError = config.cloudEnv ? '当前运行环境不支持云开发' : '未配置云开发环境 ID';
    return false;
  }
  try {
    wx.cloud.init({ env: config.cloudEnv, traceUser: true });
    state.inited = true;
    state.initError = '';
    return true;
  } catch (e) {
    state.initError = String((e && e.message) || e);
    return false;
  }
}

/** 网络类错误值得重试；业务类错误（没有 openid、参数非法）重试没意义 */
function isRetryable(err) {
  const msg = String((err && (err.errMsg || err.message)) || err || '');
  return /timeout|fail|network|ECONN|socket|请求超时|连接/i.test(msg);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 调用云函数。
 * @param {string} action
 * @param {object} payload
 * @param {{timeout?:number, retry?:number}} opts
 * @returns {Promise<object>} 云函数返回值；业务失败会 reject 出带 code 的错误
 */
async function call(action, payload, opts) {
  const o = opts || {};
  const timeout = o.timeout || 12000;
  const maxRetry = o.retry === undefined ? 2 : o.retry;

  if (!init()) {
    const err = new Error(state.initError || '云开发未初始化');
    err.code = 'CLOUD_NOT_READY';
    throw err;
  }

  let attempt = 0;
  let lastErr = null;
  while (attempt <= maxRetry) {
    state.calls += 1;
    try {
      const res = await Promise.race([
        wx.cloud.callFunction({
          name: config.cloudFn,
          data: Object.assign({ action: action }, payload || {})
        }),
        new Promise((resolve, reject) => {
          setTimeout(() => {
            const e = new Error('云函数超时');
            e.errMsg = 'timeout';
            reject(e);
          }, timeout);
        })
      ]);
      const result = (res && res.result) || {};
      if (result.ok === false) {
        const err = new Error(result.message || result.code || '云端返回失败');
        err.code = result.code || 'CLOUD_REJECTED';
        throw err;
      }
      return result;
    } catch (e) {
      lastErr = e;
      // 业务错误直接抛出，不做无意义重试
      if (e && e.code && e.code !== 'CLOUD_REJECTED' && !isRetryable(e)) throw e;
      if (e && e.code === 'CLOUD_REJECTED') throw e;
      if (!isRetryable(e)) throw e;
      attempt += 1;
      if (attempt > maxRetry) break;
      await sleep(400 * Math.pow(2, attempt - 1));
    }
  }
  state.failures += 1;
  state.lastError = String((lastErr && (lastErr.errMsg || lastErr.message)) || lastErr);
  throw lastErr || new Error('云函数调用失败');
}

function status() {
  return {
    enabled: cfg.cloudEnabled(),
    inited: state.inited,
    env: config.cloudEnv,
    openid: state.openid,
    calls: state.calls,
    failures: state.failures,
    lastError: state.lastError,
    initError: state.initError
  };
}

function setOpenid(id) { state.openid = id || ''; }

module.exports = { init, call, status, isReady, setOpenid };
