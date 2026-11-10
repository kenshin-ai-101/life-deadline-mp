// utils/sources.js
// 「来源」多条时按 [1] [2] [3] 逐条编号。
//
// 上游数据里，一份来源可能被写成：「条例第二十七条：「…」；第二十八条：「…」. <url>」，
// 中文分号既用于分隔不同文献，也出现在同一份法条原文内部。因此这里分两步：
//   1) 按参考工程 splitSrc 的括号/引号感知规则切出候选段；
//   2) 以 URL 作为「一条独立来源」的锚点，把不带链接的候选段并回相邻段，
//      避免把同一份法条的若干条款误拆成 [1][2][3]。
// source 字段按 450 字截断，links 是全量抽取结果；未出现在可见正文中的链接
// 追加为编号项并标记 extra，保证每个可核对来源都有唯一编号。
'use strict';

var SRC_OPEN = '「『（';
var SRC_CLOSE = '」』）';
var URL_RE = /https?:\/\/[^\s）)；;；，,」』"'》<>]+/g;

/** 去掉 md 的 <URL> 尖括号；截断造成尖括号未闭合时丢掉残缺链接 */
function cleanSource(text) {
  var s = String(text || '').replace(/<(https?:\/\/[^>]+)>/g, '$1');
  return s.replace(/<https?:\/\/[^\s>]*$/, '').trim();
}

/** 参考工程 splitSrc：括号/引号内的分号不做分隔 */
function splitCandidates(text) {
  var s = cleanSource(text);
  var parts = [];
  var buf = '';
  var depth = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (SRC_OPEN.indexOf(c) >= 0) depth++;
    if (SRC_CLOSE.indexOf(c) >= 0) depth = Math.max(0, depth - 1);
    var semi = c === '；' || (c === ';' && /\s/.test(s.charAt(i - 1) || '') && /\s/.test(s.charAt(i + 1) || ''));
    if (semi && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  parts.push(buf);
  return parts.map(function (p) { return p.trim(); }).filter(Boolean);
}

function urlsIn(text) {
  var out = [];
  var m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) out.push(m[0]);
  return out;
}

/** 把候选段合并成「独立来源」：遇到带链接的段就封口 */
function groupReferences(text) {
  var cand = splitCandidates(text);
  if (cand.length <= 1) return cand;
  var out = [];
  var buf = '';
  cand.forEach(function (p) {
    buf = buf ? buf + '；' + p : p;
    if (urlsIn(p).length) {
      out.push(buf);
      buf = '';
    }
  });
  if (buf) {
    // 截断只剩省略号的尾巴不是一条独立来源，并回上一条
    if (out.length && /^[….\s。]+$/.test(buf)) out[out.length - 1] += buf;
    else out.push(buf);
  }
  return out;
}

/** 把一段文字拆成普通文本 + 可点复制的 URL */
function runsOf(text) {
  var runs = [];
  var last = 0;
  var m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) });
    runs.push({ t: m[0], url: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs.length ? runs : [{ t: '' }];
}

/**
 * @param {Object} detail 条目长文本（source / links / sourceTrimmed）
 * @returns {{refs: Array, count: Number, multi: Boolean, linkCount: Number, sourceTrimmed: Boolean}}
 *          refs[i] = { no, text, runs, extra }
 */
function buildRefs(detail) {
  var d = detail || {};
  var links = d.links || [];
  var seen = urlsIn(cleanSource(d.source));
  var refs = groupReferences(d.source).map(function (t, i) {
    return { no: i + 1, text: t, runs: runsOf(t), extra: false };
  });

  function alreadyShown(url) {
    for (var i = 0; i < refs.length; i++) if (refs[i].text === url) return true;
    return false;
  }
  function inSource(url) {
    for (var i = 0; i < seen.length; i++) {
      var s = seen[i];
      // 正文里的 URL 可能被截断，或带上了尾部标点
      if (s === url || s.indexOf(url) === 0 || url.indexOf(s) === 0) return true;
    }
    return false;
  }

  links.forEach(function (u) {
    if (!u || inSource(u) || alreadyShown(u)) return;
    refs.push({ no: refs.length + 1, text: u, runs: [{ t: u, url: true }], extra: true });
  });

  return {
    refs: refs,
    count: refs.length,
    multi: refs.length > 1,
    linkCount: links.length,
    sourceTrimmed: !!d.sourceTrimmed
  };
}

module.exports = {
  cleanSource: cleanSource,
  splitCandidates: splitCandidates,
  groupReferences: groupReferences,
  runsOf: runsOf,
  buildRefs: buildRefs
};
