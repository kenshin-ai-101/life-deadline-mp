#!/usr/bin/env node
/**
 * 把上游《人情世故指南》(changxueyi/renqing-shigu) 的 book/*.md 编译成小程序数据模块。
 *
 * 用法（工程根目录执行）：node tools/sync_social.js
 *
 * 输入：
 *   ../upstream-social/book/*.md                 31 章原文（CC BY 4.0）
 *   ../mp/HuiTurn_HowToLiveBetter/data/v2/*     参考工程的章节主题/更新日期/主题定义
 * 产物（均在主包，供知识库 tab、搜索、详情、章节阅读共用）：
 *   data/books.js           两本书元数据 + 主题字典 + 章节→主题映射
 *   data/social-catalog.js  31 章目录
 *   data/social-items.js    640 条精简索引
 *   data/social-details.js  640 条长文本（按包体预算截断）
 *
 * 设计要点：
 * - 条目 id 用 rq 前缀，与《高性价比人生》的 01-1 等 id 完全隔离，可跨书共存。
 * - 字段结构对齐 data/items.js，另保留原书特色的「怎么说」话术字段 tip。
 * - 主包预算 1.5MB：索引与长文本都做按句截断，正文不重复存储。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const BOOK = path.resolve(BASE, '../upstream-social/book');
const REF = path.resolve(BASE, '../mp/HuiTurn_HowToLiveBetter/data/v2');

// 截断口径（字符数）：控制主包体积，按完整句截断避免断在半句
const LIMIT = { plain: 120, tip: 80, gain: 150, remark: 150, source: 180, intro: 160 };

const FIELD_RE = /^- (成本|说人话|收益|证据等级|来源|备注|怎么说)：(.*)$/gm;
const TAG_RE = /<!--\s*成本标签:\s*(.*?)-->/s;
const KV_RE = /([^\s=]+)=([^\s=]+)/g;
const HEAD_RE = /^#\s*(\d+)\.\s*(.*)$/m;
const ITEM_RE = /^(\d+)\.\s*(.*)/;
const LINK_RE = /https?:\/\/[^\s<>\u3000]+/g;

function cut(text, limit, marker) {
  marker = marker === undefined ? '…' : marker;
  text = (text || '').trim();
  if (text.length <= limit) return [text, false];
  let head = text.slice(0, limit);
  const pos = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('，'));
  if (pos > limit * 0.6) head = head.slice(0, pos + 1);
  return [head + marker, true];
}

function evidenceType(f) {
  const gain = f['收益'] || '';
  const source = f['来源'] || '';
  if (gain.includes('随机分成两组') || (gain.includes('随机分组') && gain.includes('试验'))) return '随机对照试验';
  if (/队列|只记录|不分组|观察性|跟踪一大批/.test(gain)) return '观察性研究';
  if (/(法|条例|规定|办法)\s*第|第.{1,4}条/.test(source)) return '法条';
  if (/(统计局|卫健委|人社部|国务院|公安部|财政部|教育部|市场监管|国家标准|官方公告|发布通知)/.test(source)) return '官方文件';
  if (/(报道|新闻|媒体)/.test(source)) return '仅媒体报道';
  return '经验共识';
}

function parseFile(filename) {
  const sec = parseInt(filename.slice(0, 2), 10);
  const text = fs.readFileSync(path.join(BOOK, filename), 'utf8');
  const head = HEAD_RE.exec(text);
  const title = head ? head[2].trim() : filename.slice(3, -3);
  const introMatch = /^#\s*\d+\..*?\n\n([\s\S]*?)\n\n/m.exec(text);
  const intro = introMatch ? introMatch[1].trim().replace(/\n/g, ' ') : '';

  const items = [];
  const details = {};
  for (const block of text.split('\n### ').slice(1)) {
    const m = ITEM_RE.exec(block);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const name = m[2].trim();
    const fields = {};
    for (const f of block.matchAll(FIELD_RE)) fields[f[1]] = f[2];
    const tagMatch = TAG_RE.exec(block);
    const tags = {};
    if (tagMatch) for (const kv of tagMatch[1].matchAll(KV_RE)) tags[kv[1]] = kv[2];

    const plain = fields['说人话'] || '';
    const tip = fields['怎么说'] || '';
    const remark = fields['备注'] || '';
    const source = fields['来源'] || '';
    const id = 'rq' + String(sec).padStart(2, '0') + '-' + num;
    const links = (source.match(LINK_RE) || []);
    const ev = evidenceType(fields);

    items.push({
      id: id,
      b: 'social',
      s: sec,
      n: num,
      t: name,
      p: cut(plain, LIMIT.plain)[0],
      tip: cut(tip, LIMIT.tip)[0],
      cost: {
        money: tags['钱'] || '',
        time: tags['时间'] || '',
        will: tags['毅力'] || '',
        gain: tags['收益'] || '',
        lens: tags['口径'] || '',
        who: tags['人群'] || ''
      },
      grade: fields['证据等级'] || '',
      disputed: remark.includes('争议'),
      ev: ev,
      hasRef: /见第\s*\d+\s*(章|节)/.test(block)
    });

    details[id] = {
      costText: fields['成本'] || '',
      gainText: cut(fields['收益'] || '', LIMIT.gain)[0],
      gainTrimmed: cut(fields['收益'] || '', LIMIT.gain)[1],
      remark: cut(remark, LIMIT.remark)[0],
      source: cut(source, LIMIT.source)[0],
      sourceTrimmed: cut(source, LIMIT.source)[1],
      tip: cut(tip, LIMIT.tip)[0],
      links: links,
      evType: ev
    };
  }
  return { sec, title, intro, items, details };
}

function js(file, obj, header) {
  const payload = JSON.stringify(obj);
  fs.writeFileSync(path.join(BASE, file),
    '// ' + header + '\n// 由 tools/sync_social.js 生成，请勿手工编辑\n// 来源：changxueyi/renqing-shigu · book/*.md · CC BY 4.0\nmodule.exports = ' + payload + ';\n',
    'utf8');
  return Buffer.byteLength(payload, 'utf8');
}

function main() {
  if (!fs.existsSync(BOOK)) {
    console.error('找不到上游 book 目录：' + BOOK);
    process.exit(1);
  }

  // 参考工程元数据（章节主题 / 更新日期 / 主题字典）
  let refChapters = { hltb: [], social: [] };
  let refTopics = [];
  if (fs.existsSync(path.join(REF, 'chapters.js'))) {
    refChapters = require(path.join(REF, 'chapters.js'));
    refTopics = require(path.join(REF, 'topics.js'));
  } else {
    console.warn('[WARN] 未找到参考工程 data/v2，主题映射将留空');
  }

  const files = fs.readdirSync(BOOK).filter(f => f.endsWith('.md')).sort();
  const catalog = [];
  let allItems = [];
  let allDetails = {};
  for (const f of files) {
    const r = parseFile(f);
    const ref = (refChapters.social || []).find(c => c.ord === r.sec) || {};
    catalog.push({
      sec: r.sec,
      title: ref.title || r.title,
      intro: cut(ref.summary || r.intro, LIMIT.intro)[0],
      brief: ref.brief || cut(r.intro, 60)[0],
      count: r.items.length,
      topicIds: ref.topicIds || [],
      updatedAt: ref.updatedAt || ''
    });
    allItems = allItems.concat(r.items);
    Object.assign(allDetails, r.details);
  }

  const topicMeta = {
    sleep: { short: '睡眠', icon: '/images/topic-sleep.png' },
    mind: { short: '情绪', icon: '/images/topic-mind.png' },
    relation: { short: '人际', icon: '/images/topic-relation.png' },
    learn: { short: '学习', icon: '/images/topic-learn.png' },
    work: { short: '工作', icon: '/images/topic-work.png' },
    money: { short: '财务', icon: '/images/topic-money.png' },
    safety: { short: '安全', icon: '/images/topic-safety.png' },
    family: { short: '家庭', icon: '/images/topic-family.png' }
  };
  // 主推主题按设计稿顺序：睡眠 情绪 人际 学习 工作 财务 安全 家庭
  const PRIMARY_ORDER = ['sleep', 'mind', 'relation', 'learn', 'work', 'money', 'safety', 'family'];
  const rank = (id) => {
    const i = PRIMARY_ORDER.indexOf(id);
    return i === -1 ? PRIMARY_ORDER.length : i;
  };
  const topics = refTopics.map(t => ({
    id: t.id,
    name: t.name,
    short: (topicMeta[t.id] || {}).short || t.name.slice(0, 4),
    icon: (topicMeta[t.id] || {}).icon || '/images/topic-default.png',
    primary: !!t.primary
  })).sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return rank(a.id) - rank(b.id);
  });

  const chapterTopics = { hltb: {}, social: {} };
  (refChapters.hltb || []).forEach(c => { chapterTopics.hltb[c.ord] = c.topicIds || []; });
  (refChapters.social || []).forEach(c => { chapterTopics.social[c.ord] = c.topicIds || []; });

  const books = [
    {
      id: 'hltb', title: '高性价比人生指南', author: 'eternity4719',
      descLine1: '长寿防病 · 急救 · 理财 · 法律红线 · 育儿',
      descLine2: '每条写明成本、收益与证据等级',
      cover: '/images/cover-hltb.jpg', accent: '#226B60',
      stats: { chapters: 34, steps: 772 },
      badges: ['34 章 · 772 条', '证据分级', '可推荐'],
      license: 'CC BY-NC-SA 4.0（原书）',
      sourceUrl: 'https://github.com/eternity4719/HowToLiveBetter',
      updatedAt: '2026-11-09',
      capabilities: { evidence: true, matchable: true }
    },
    {
      id: 'social', title: '人情世故指南', author: 'changxueyi',
      descLine1: '说话 · 人情 · 工作 · 家庭 · 人生阶段',
      descLine2: '讲清规则，也讲清人心',
      cover: '/images/cover-social.jpg', accent: '#C99975',
      stats: { chapters: 31, steps: 640 },
      badges: ['31 章 · 640 条', '证据分级', '可推荐'],
      license: 'CC BY 4.0',
      sourceUrl: 'https://github.com/changxueyi/renqing-shigu',
      updatedAt: (refChapters.social[0] || {}).updatedAt || '2026-10-23',
      capabilities: { evidence: true, matchable: true }
    }
  ];

  const sizes = {};
  sizes['books.js'] = js('data/books.js', { books, topics, chapterTopics }, '书库元数据：两本书 / 主题字典 / 章节主题映射');
  sizes['social-catalog.js'] = js('data/social-catalog.js', catalog, '人情世故指南 31 章目录');
  sizes['social-items.js'] = js('data/social-items.js', allItems, '人情世故指南 640 条精简索引');
  sizes['social-details.js'] = js('data/social-details.js', allDetails, '人情世故指南条目长文本');

  console.log('章 ' + catalog.length + ' / 条目 ' + allItems.length +
    ' / 含话术 ' + allItems.filter(i => i.tip).length + ' 条');
  for (const k of Object.keys(sizes)) {
    console.log('  ' + k.padEnd(20) + (sizes[k] / 1024).toFixed(1) + ' KB');
  }
  console.log('  合计 ' +
    (Object.values(sizes).reduce((a, b) => a + b, 0) / 1024).toFixed(1) + ' KB');

  if (catalog.length !== 31 || allItems.length !== 640) {
    console.error('[ERROR] 章节/条目数与上游不符，停止生成');
    process.exit(2);
  }
  const perChapter = catalog.map(c => c.count).join(',');
  const refCounts = (refChapters.social || []).map(c => c.stepCount).join(',');
  if (refCounts && perChapter !== refCounts) {
    console.error('[WARN] 各章条目数与参考工程索引不一致');
    console.error('  本地：' + perChapter);
    console.error('  参考：' + refCounts);
  }
}

main();
