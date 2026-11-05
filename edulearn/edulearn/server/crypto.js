'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const cfg = require('./config');
const scrypt = promisify(crypto.scrypt);

/* ---------- Field-level encryption at rest (AES-256-GCM) ---------- */
function encrypt(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cfg.DATA_KEY, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  const tag = c.getAuthTag();
  return 'v1.' + [iv, tag, ct].map(b => b.toString('base64url')).join('.');
}
function decrypt(s) {
  const [v, iv, tag, ct] = String(s).split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', cfg.DATA_KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]);
}
const decryptText = s => decrypt(s).toString('utf8');

/* ---------- Passwords (scrypt) ---------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function hashPasswordSync(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + Buffer.alloc(64).toString('base64url');
async function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || DUMMY).split('$');
  if (alg !== 'scrypt') return false;
  const exp = Buffer.from(hash, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), exp.length, { N: 16384, r: 8, p: 1 });
  return got.length === exp.length && crypto.timingSafeEqual(got, exp) && !!stored;
}

/* ---------- Signed tokens (HS256) ---------- */
const b64u = x => Buffer.from(x).toString('base64url');
function mac(data) { return crypto.createHmac('sha256', cfg.JWT_SECRET).update(data).digest(); }
function sign(payload, ttlMs = cfg.TOKEN_TTL_MS) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + ttlMs }));
  return `${head}.${body}.${mac(head + '.' + body).toString('base64url')}`;
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const exp = mac(parts[0] + '.' + parts[1]);
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return p.exp && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
function randomCode(n = 6) {
  let s = '';
  for (const b of crypto.randomBytes(n)) s += ALPHABET[b % ALPHABET.length];
  return s;
}
const randomHex = (n = 16) => crypto.randomBytes(n).toString('hex');

module.exports = { encrypt, decrypt, decryptText, hashPassword, hashPasswordSync, verifyPassword, sign, verify, randomCode, randomHex };
