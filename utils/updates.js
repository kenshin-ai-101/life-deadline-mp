// 「最近更新」取数层：与《人生指南库》「为我推荐」tab 同口径。
//
// 参考实现：HuiTurn_HowToLiveBetter/pages/reco/reco.js 的 loadDaily() / fallbackDaily()
// 与 utils/daily.js。本工程是纯本地数据、没有云端 git 流水，因此用「章节级
// updatedAt」复刻同一套口径：
//   1. 只认章节自身的 updatedAt（上游该章原文最后一次被改动的时刻），按本机
//      时区归到「天」；章节没带时间戳就不参与，等同 fallbackDaily 的
//      .filter(c => c.updatedAt)。主书目录由 sync_content.py 生成、目前无
//      章节级时间戳，所以不计入，不会把「全书入库日」误当成 34 章今天都改过。
//   2. 按天分组、日期倒序，取最近 2 天（对应云端 getDaily(2)）。
//   3. 今天有更新就只列今天的；今天没有则降级到最近那些天，且不把旧日期
//      标成「今日更新」（指南库审查里修过的口径问题）。
//   4. 每天最多 4 章，累计最多 4 章。
//   5. 标题随实际日期：今天有 → 今日更新；否则 → 最近更新；一条没有 → 暂无更新。
//   6. 「新增 / 更新」是篇章级近似：更新日在最近 1 天内标「新增」，其余「更新」，
//      对应 utils/daily.js getLatestSteps 的 isNew 口径。
'use strict';

const lib = require('./library.js');

const LIMIT_DAYS = 2;   // 云端 getDaily(2)
const PER_DAY = 4;      // 每天最多 4 章
const TOTAL = 4;        // 累计最多 4 章
const SHOWN = 2;        // 默认展开前 2 条

function pad(n) { return n < 10 ? '0' + n : String(n); }

function todayStr(now) {
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function daysAgo(day, now) {
  const d = new Date(day + 'T00:00:00');
  if (isNaN(d.getTime())) return 9999;
  return Math.round((now - d) / 86400000);
}

function dayOf(chapter) { return String(chapter.updatedAt || '').slice(0, 10); }

/** 按天聚合，返回 [{ date, chapters[] }]，日期倒序、同日按 updatedAt 倒序 */
function getUpdateDays(limitDays) {
  const map = {};
  lib.getAllChapters().forEach(c => {
    const day = dayOf(c);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    if (!map[day]) map[day] = { date: day, chapters: [] };
    map[day].chapters.push(c);
  });
  return Object.keys(map)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, limitDays || LIMIT_DAYS)
    .map(d => ({
      date: d,
      chapters: map[d].chapters.slice().sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    }));
}

/** 首页列表：返回 { updates, title, count, todayCount, days } */
function getRecentUpdates(nowInput) {
  const now = nowInput || new Date();
  const today = todayStr(now);
  const days = getUpdateDays(LIMIT_DAYS);
  const todayDays = days.filter(d => d.date === today && d.chapters.length);
  // 有今日流水就只取今日，否则降级到最近几天（不混入旧日期并标成今日）
  const source = todayDays.length ? todayDays : days;
  const updates = [];

  source.forEach(d => {
    d.chapters.slice(0, PER_DAY).forEach(c => {
      if (updates.length >= TOTAL) return;
      const book = lib.getBook(c.bookId) || {};
      const isNew = daysAgo(d.date, now) <= 1;
      updates.push({
        uid: c.uid,
        bookId: c.bookId,
        chapterId: c.chapterId,
        sec: c.sec,
        title: c.title,
        bookTitle: book.title || c.bookId,
        accent: lib.getAccent(c.bookId),
        action: isNew ? 'new' : 'update',
        actionLabel: isNew ? '新增' : '更新',
        dateLabel: d.date.slice(5).replace('-', '/'),
        day: d.date
      });
    });
  });

  const title = !updates.length ? '暂无更新' : (todayDays.length ? '今日更新' : '最近更新');
  return {
    updates: updates,
    title: title,
    count: updates.length,
    todayCount: todayDays.reduce((s, d) => s + d.chapters.length, 0),
    days: days
  };
}

/** 默认两条，展开后给全量；与 reco.js setUpdates / onToggleUpdates 一致 */
function shownUpdates(updates, expanded) {
  return expanded ? updates : updates.slice(0, SHOWN);
}

module.exports = {
  LIMIT_DAYS, PER_DAY, TOTAL, SHOWN,
  todayStr, getUpdateDays, getRecentUpdates, shownUpdates
};
