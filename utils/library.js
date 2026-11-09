// 书库统一数据层：两本书（高性价比人生 / 人情世故指南）的目录、条目、主题、阅读进度。
// 页面不直接 require 各书的原始数据文件，统一走这里，便于以后加第三本书。
'use strict';

const meta = require('../data/books.js');
const hltbCatalog = require('../data/catalog.js');
const hltbItems = require('../data/items.js');
const socialCatalog = require('../data/social-catalog.js');
const socialItems = require('../data/social-items.js');

const BOOKS = meta.books;
const TOPICS = meta.topics;
const CHAPTER_TOPICS = meta.chapterTopics;
const PROGRESS_KEY = 'ld_read_progress_v1';
const TOPIC_FAV_KEY = 'ld_topic_fav_v1';

function isSocialId(id) { return String(id || '').indexOf('rq') === 0; }
function bookIdOf(id) { return isSocialId(id) ? 'social' : 'hltb'; }
function catalogOf(bookId) { return bookId === 'social' ? socialCatalog : hltbCatalog; }
function itemsOf(bookId) { return bookId === 'social' ? socialItems : hltbItems; }

function getBooks() { return BOOKS; }
function getBook(id) { return BOOKS.filter(b => b.id === id)[0] || null; }
function getAccent(id) { const b = getBook(id); return b ? b.accent : '#226B60'; }

function shortText(text, limit) {
  const s = String(text || '').trim();
  if (s.length <= limit) return s;
  return s.slice(0, limit) + '…';
}

/** 统一章节结构；hltb 目录由 sync_content.py 生成，主题与更新日期从 books.js 补齐 */
function getChapters(bookId) {
  const map = CHAPTER_TOPICS[bookId] || {};
  return catalogOf(bookId).map(c => ({
    uid: bookId + ':' + c.sec,
    bookId: bookId,
    sec: c.sec,
    chapterId: String(c.sec),
    title: c.title,
    intro: c.intro || '',
    brief: c.brief || shortText(c.intro, 60),
    count: c.count,
    topicIds: c.topicIds || map[c.sec] || [],
    updatedAt: c.updatedAt || '',
    accent: getAccent(bookId)
  }));
}

function getAllChapters() { return getChapters('hltb').concat(getChapters('social')); }

function getChapter(bookId, sec) {
  return getChapters(bookId).filter(c => c.sec === Number(sec))[0] || null;
}

function getItems(bookId, sec) {
  const all = itemsOf(bookId);
  return sec ? all.filter(it => it.s === Number(sec)) : all;
}

function getAllItems() { return hltbItems.concat(socialItems); }

function getItem(id) {
  const list = itemsOf(bookIdOf(id));
  return list.filter(it => it.id === id)[0] || null;
}

function sectionTitle(bookId, sec) {
  const c = getChapter(bookId, sec);
  return c ? c.title : '第 ' + sec + ' 章';
}

function getTopics() { return TOPICS; }
function getTopic(id) { return TOPICS.filter(t => t.id === id)[0] || null; }

/** 跨书主题聚合：章节按「书 → 序」排，同书章节相邻 */
function getTopicChapters(topicId) {
  return getAllChapters()
    .filter(c => (c.topicIds || []).indexOf(topicId) > -1)
    .map(c => ({
      uid: c.uid,
      bookId: c.bookId,
      chapterId: c.chapterId,
      sec: c.sec,
      title: c.title,
      count: c.count,
      accent: c.accent,
      bookTitle: (getBook(c.bookId) || {}).title || c.bookId,
      updatedLabel: (c.updatedAt || '').slice(5, 10).replace('-', '/') || '近期'
    }))
    .sort((a, b) => a.bookId === b.bookId
      ? a.sec - b.sec
      : (a.bookId === 'hltb' ? -1 : 1));
}

function getTopicChapterCount(topicId) { return getTopicChapters(topicId).length; }

/** 单本书出现过的主题 chips（按章节数倒序） */
function getBookTopics(bookId) {
  const count = {};
  getChapters(bookId).forEach(c => (c.topicIds || []).forEach(t => { count[t] = (count[t] || 0) + 1; }));
  return Object.keys(count)
    .map(id => ({ id: id, name: (getTopic(id) || {}).name || id, count: count[id] }))
    .sort((a, b) => b.count - a.count);
}

// ---------------- 阅读进度（本地存储，离线可用） ----------------

function getProgress(bookId) {
  try {
    if (typeof wx === 'undefined') return null;
    const all = wx.getStorageSync(PROGRESS_KEY) || {};
    const p = all[bookId];
    if (!p || !getChapter(bookId, p.sec)) return null;
    return p;
  } catch (e) { return null; }
}

function setProgress(bookId, sec) {
  const chapter = getChapter(bookId, sec);
  if (!chapter) return false;
  try {
    if (typeof wx === 'undefined') return false;
    const all = wx.getStorageSync(PROGRESS_KEY) || {};
    all[bookId] = { sec: chapter.sec, title: chapter.title, at: Date.now() };
    wx.setStorageSync(PROGRESS_KEY, all);
    return true;
  } catch (e) { return false; }
}

// ---------------- 主题收藏（本地存储） ----------------

function isTopicFav(id) {
  try {
    if (typeof wx === 'undefined') return false;
    const all = wx.getStorageSync(TOPIC_FAV_KEY) || [];
    return Array.isArray(all) && all.indexOf(id) > -1;
  } catch (e) { return false; }
}

function toggleTopicFav(id) {
  try {
    if (typeof wx === 'undefined') return false;
    let all = wx.getStorageSync(TOPIC_FAV_KEY) || [];
    if (!Array.isArray(all)) all = [];
    const had = all.indexOf(id) > -1;
    all = had ? all.filter(x => x !== id) : all.concat([id]);
    wx.setStorageSync(TOPIC_FAV_KEY, all);
    return !had;
  } catch (e) { return false; }
}

function getStats() {
  return {
    books: BOOKS.length,
    chapters: getAllChapters().length,
    items: getAllItems().length
  };
}

module.exports = {
  isSocialId, bookIdOf, catalogOf, itemsOf,
  getBooks, getBook, getAccent,
  getChapters, getAllChapters, getChapter,
  getItems, getAllItems, getItem, sectionTitle,
  getTopics, getTopic, getTopicChapters, getTopicChapterCount, getBookTopics,
  isTopicFav, toggleTopicFav,
  getProgress, setProgress, getStats
};
