// 云端数据模型声明：客户端只传「集合名 + 本地数据」，由这里决定怎么落库。
// 改动这里必须同步 utils/sync.js 的 SYNC_COLLECTIONS，否则会出现「推了但拉不回」。

// 集合的三种形态：
//   records —— 有 id 的记录数组（事件、待办、成员、回执），逐条 upsert，按 id 软删
//   set     —— 字符串数组（收藏、章节收藏、点赞），每个值一条文档，天然去重
//   object  —— 单个对象（设置），整份覆盖
const KINDS = {
  events: 'records',
  tasks: 'records',
  members: 'records',
  receipts: 'records',
  favorites: 'set',
  chapterFavs: 'set',
  chapterLikes: 'set',
  settings: 'object'
};

// 每个逻辑集合对应的物理集合名。独立集合便于单独加索引和单独清空。
const COLLECTIONS = {
  events: 'ld_events',
  tasks: 'ld_tasks',
  members: 'ld_members',
  receipts: 'ld_receipts',
  favorites: 'ld_favorites',
  chapterFavs: 'ld_chapter_favs',
  chapterLikes: 'ld_chapter_likes',
  settings: 'ld_settings'
};

// 需要落库前加密的字段：家庭成员卡里的「姓名 + 年龄 + 性别 + 主要状况」属于敏感个人信息，
// 明文只在传输与内存里存在，库里存 AES-256-GCM 密文。
const SENSITIVE_FIELDS = {
  members: ['name', 'age', 'gender', 'conditions']
};

// object 型集合只有一条记录，用固定 key
const SINGLETON_KEY = 'default';

// 单次调用允许的最大变更条数：微信云函数返回值上限 6MB，留足余量
const MAX_PUSH_DOCS = 500;
const MAX_PULL_DOCS = 2000;
const PAGE_SIZE = 100;

function isCollection(name) {
  return Object.prototype.hasOwnProperty.call(KINDS, name);
}

function kindOf(name) {
  return KINDS[name] || null;
}

function physicalOf(name) {
  return COLLECTIONS[name] || null;
}

function sensitiveOf(name) {
  return SENSITIVE_FIELDS[name] || [];
}

module.exports = {
  KINDS,
  COLLECTIONS,
  SENSITIVE_FIELDS,
  SINGLETON_KEY,
  MAX_PUSH_DOCS,
  MAX_PULL_DOCS,
  PAGE_SIZE,
  isCollection,
  kindOf,
  physicalOf,
  sensitiveOf
};
