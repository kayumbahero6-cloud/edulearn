'use strict';
const { q } = require('./db');

class HttpError extends Error {
  constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const S = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, def = null) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : def; };
const num = (v, def = null) => { const n = Number(v); return v !== '' && v !== null && v !== undefined && Number.isFinite(n) ? n : def; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const round2 = n => Math.round(n * 100) / 100;
const json = (v, d = null) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const flag = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function rateLimit({ windowMs = 60000, max = 60, key = r => r.ip, message = 'Too many requests. Please slow down.' } = {}) {
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, Math.max(windowMs, 30000)).unref();
  return (req, res, next) => {
    const k = key(req); const t = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < t) { h = { n: 0, reset: t + windowMs }; hits.set(k, h); }
    if (++h.n > max) { res.set('Retry-After', String(Math.ceil((h.reset - t) / 1000))); return next(new HttpError(429, message, 'rate_limited')); }
    next();
  };
}
const perUser = (opts) => rateLimit({ ...opts, key: r => (r.user ? 'u' + r.user.id : r.ip) });

function audit(req, action, detail) {
  try {
    q.run('INSERT INTO audit_log(user_id,action,detail,ip,created_at) VALUES(?,?,?,?,?)',
      req && req.user ? req.user.id : null, action, typeof detail === 'string' ? detail : JSON.stringify(detail || {}), req ? req.ip : null, Date.now());
  } catch { /* never block a request on audit */ }
}
function notify(userId, title, body = '', link = '') {
  q.run('INSERT INTO notifications(user_id,title,body,link,created_at) VALUES(?,?,?,?,?)', userId, title, body, link, Date.now());
}

// Deterministic PRNG so a question order is stable for the lifetime of one attempt.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(arr, seed) {
  const r = mulberry32(seed); const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Only allow https URLs or our own /files/ uploads for media references.
function safeMediaUrl(u) {
  u = S(u, 1000);
  if (!u) return '';
  if (/^\/files\/[A-Za-z0-9._-]+$/.test(u)) return u;
  try { const x = new URL(u); if (x.protocol === 'https:') return x.toString(); } catch { /* fallthrough */ }
  throw new HttpError(400, 'Media links must be https:// URLs or files uploaded to this platform');
}

module.exports = { HttpError, wrap, S, int, num, clamp, round2, json, flag, rateLimit, perUser, audit, notify, shuffled, mulberry32, safeMediaUrl };
