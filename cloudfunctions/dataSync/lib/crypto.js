// 敏感字段的静态加密：AES-256-GCM，密钥由「服务端密钥 + openid」派生。
// 密钥永远不下发到客户端，客户端拿到的始终是解密后的明文（走 HTTPS）。
// 换密钥会导致老数据无法解密，所以 PII_SECRET 一旦上线就不要改。
const crypto = require('crypto');

const DEFAULT_SECRET = 'dev-only-insecure-secret-change-me';

function secretOf(env) {
  const s = (env && env.PII_SECRET) || process.env.PII_SECRET || '';
  return s || DEFAULT_SECRET;
}

function isDefaultSecret(env) {
  return secretOf(env) === DEFAULT_SECRET;
}

/** 每个用户一把密钥：同一份泄露的密文换个 openid 也解不开 */
function keyFor(secret, openid) {
  return crypto.createHash('sha256').update(String(secret) + '|' + String(openid)).digest();
}

/**
 * @returns {{v:number, iv:string, tag:string, ct:string}}
 */
function encryptObject(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64')
  };
}

/** 解密失败一律返回 null，宁可丢字段也不让整次同步失败 */
function decryptObject(payload, key) {
  if (!payload || !payload.iv || !payload.ct || !payload.tag) return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(payload.ct, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(plain.toString('utf8'));
  } catch (e) {
    return null;
  }
}

/** 拆出敏感字段做密文，其余字段留在明文档里（方便按 status 建索引） */
function splitSensitive(rec, fields) {
  const open = {};
  const secret = {};
  Object.keys(rec || {}).forEach(k => {
    if (fields.indexOf(k) >= 0) secret[k] = rec[k];
    else open[k] = rec[k];
  });
  return { open, secret };
}

function mergeSensitive(open, secret) {
  return Object.assign({}, open || {}, secret || {});
}

module.exports = {
  DEFAULT_SECRET,
  secretOf,
  isDefaultSecret,
  keyFor,
  encryptObject,
  decryptObject,
  splitSensitive,
  mergeSensitive
};
