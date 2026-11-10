// 客户端数据形态 <-> 云端文档形态 的相互转换。
// 目标：客户端完全不用知道 _id、_openid、软删这些概念，页面代码一行都不改。
const crypto = require('crypto');
const schema = require('./schema.js');
const cryptoUtil = require('./crypto.js');

/** 文档 _id 用 md5(openid|集合|本地key)，天然按用户隔离且可幂等 upsert（重复推送不会产生重复行） */
function docId(openid, col, key) {
  return crypto
    .createHash('md5')
    .update(String(openid) + '|' + String(col) + '|' + String(key))
    .digest('hex');
}

/**
 * 把客户端提交的 changes 规范化成待写文档。
 * @param {string} col 逻辑集合名
 * @param {{upserts?:Array, deletes?:Array}} payload
 * @param {string} openid
 * @param {Buffer} key 敏感字段加密密钥
 * @returns {Array<object>} 最多 MAX_PUSH_DOCS 条
 */
function normalizeChanges(col, payload, openid, key) {
  const kind = schema.kindOf(col);
  if (!kind) return [];
  const p = payload || {};
  // object 型传的是对象而不是数组，这里不能提前压成数组，否则设置会被整份丢掉
  const rawUpserts = p.upserts;
  const upserts = Array.isArray(rawUpserts) ? rawUpserts : [];
  const deletes = Array.isArray(p.deletes) ? p.deletes : [];
  const fields = schema.sensitiveOf(col);
  const out = [];

  if (kind === 'records') {
    upserts.forEach(rec => {
      if (!rec || !rec.id) return;
      let body = rec;
      let pii = null;
      if (fields.length) {
        const split = cryptoUtil.splitSensitive(rec, fields);
        body = split.open;
        pii = cryptoUtil.encryptObject(split.secret, key);
      }
      out.push({
        _id: docId(openid, col, rec.id),
        _openid: openid,
        col: col,
        key: String(rec.id),
        rec: body,
        pii: pii,
        deleted: false
      });
    });
    deletes.forEach(id => {
      if (!id) return;
      out.push({
        _id: docId(openid, col, id),
        _openid: openid,
        col: col,
        key: String(id),
        rec: null,
        pii: null,
        deleted: true
      });
    });
  } else if (kind === 'set') {
    // set 型：数组元素本身就是 key，收藏同一项重复推送会被 md5 归一
    upserts.forEach(v => {
      if (v === undefined || v === null || v === '') return;
      out.push({
        _id: docId(openid, col, v),
        _openid: openid,
        col: col,
        key: String(v),
        rec: { v: 1 },
        pii: null,
        deleted: false
      });
    });
    deletes.forEach(v => {
      if (v === undefined || v === null || v === '') return;
      out.push({
        _id: docId(openid, col, v),
        _openid: openid,
        col: col,
        key: String(v),
        rec: null,
        pii: null,
        deleted: true
      });
    });
  } else {
    // object 型：整份覆盖，空对象也要写（用户可能清空了设置）
    const body = rawUpserts && typeof rawUpserts === 'object' && !Array.isArray(rawUpserts)
      ? rawUpserts
      : (Array.isArray(rawUpserts) ? rawUpserts[0] : null);
    if (body && typeof body === 'object') {
      out.push({
        _id: docId(openid, col, schema.SINGLETON_KEY),
        _openid: openid,
        col: col,
        key: schema.SINGLETON_KEY,
        rec: body,
        pii: null,
        deleted: false
      });
    }
    deletes.forEach(() => {
      out.push({
        _id: docId(openid, col, schema.SINGLETON_KEY),
        _openid: openid,
        col: col,
        key: schema.SINGLETON_KEY,
        rec: null,
        pii: null,
        deleted: true
      });
    });
  }

  // 同一次提交里同一个 key 出现两次时，后出现的（删除）覆盖先出现的
  const byId = {};
  out.forEach(d => { byId[d._id] = d; });
  return Object.keys(byId).map(k => byId[k]).slice(0, schema.MAX_PUSH_DOCS);
}

/** 文档 -> 回给客户端的精简形态（去掉 _openid/col/pii 等内部字段） */
function toWire(doc, key) {
  let rec = doc.rec || null;
  if (doc.pii) {
    const secret = cryptoUtil.decryptObject(doc.pii, key);
    rec = cryptoUtil.mergeSensitive(rec, secret || {});
  }
  return {
    key: doc.key,
    rec: rec,
    deleted: !!doc.deleted,
    updatedAt: doc.updatedAt || 0
  };
}

/**
 * 把某一集合的文档列表还原成客户端使用的数据形态。
 * @param {string} col
 * @param {Array} docs 已经过滤掉 deleted 的文档
 * @param {string} kind
 */
function toLocalValue(col, docs, kind) {
  const k = kind || schema.kindOf(col);
  if (k === 'records') {
    return docs
      .filter(d => d.rec)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(d => d.rec);
  }
  if (k === 'set') {
    return docs
      .filter(d => !d.deleted)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(d => d.key);
  }
  const one = docs.filter(d => d.rec)[0];
  return one ? one.rec : {};
}

module.exports = {
  docId,
  normalizeChanges,
  toWire,
  toLocalValue
};
