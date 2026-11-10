// 「今天想改善什么」画像与推荐反馈的本地存储。
// 等价《人生指南库》utils/match.js 的 v2 部分：surveyProfileV2 / doingSteps。
// 本工程纯本地、无服务端，因此不存匿名标识、不上传任何答案。
'use strict';

const PROFILE_KEY = 'ld_survey_profile_v1';
const DOING_KEY = 'ld_doing_steps_v1';

function read(key, fallback) {
  try {
    if (typeof wx === 'undefined') return fallback;
    const v = wx.getStorageSync(key);
    return (v === '' || v === undefined || v === null) ? fallback : v;
  } catch (e) { return fallback; }
}

function write(key, value) {
  try {
    if (typeof wx === 'undefined') return false;
    wx.setStorageSync(key, value);
    return true;
  } catch (e) { return false; }
}

function getProfileV2() {
  const p = read(PROFILE_KEY, null);
  return (p && Array.isArray(p.topicIds) && p.topicIds.length) ? p : null;
}

function saveProfileV2(p) { return write(PROFILE_KEY, p || {}); }
function clearProfileV2() { return write(PROFILE_KEY, {}); }

function getDoingList() {
  const v = read(DOING_KEY, []);
  return Array.isArray(v) ? v : [];
}

/** 负反馈：把条目 uid 加进本机排除表，最多留 200 条 */
function sendFeedback(uid, kind) {
  if (kind === 'doing' || kind === 'negative') {
    const list = getDoingList().filter(x => x !== uid);
    list.unshift(uid);
    write(DOING_KEY, list.slice(0, 200));
  }
  return { ok: true, offline: true };
}

module.exports = {
  PROFILE_KEY, DOING_KEY,
  getProfileV2, saveProfileV2, clearProfileV2,
  getDoingList, sendFeedback
};
