'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
for (const d of ['', 'uploads', 'scorm']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

// Secrets come from the environment in production; in development they are generated once and kept in DATA_DIR.
function persistentSecret(envName, fileName, bytes = 32) {
  if (process.env[envName]) return process.env[envName];
  const f = path.join(DATA_DIR, fileName);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const v = crypto.randomBytes(bytes).toString('hex');
  fs.writeFileSync(f, v, { mode: 0o600 });
  return v;
}

const dataKeyRaw = persistentSecret('DATA_KEY', '.datakey');
const DATA_KEY = /^[0-9a-f]{64}$/i.test(dataKeyRaw)
  ? Buffer.from(dataKeyRaw, 'hex')
  : crypto.createHash('sha256').update(dataKeyRaw).digest();

const env = process.env;
module.exports = {
  ROOT,
  DATA_DIR,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  NODE_ENV: env.NODE_ENV || 'development',
  IS_PROD: env.NODE_ENV === 'production',
  PORT: parseInt(env.PORT || '3000', 10),
  HOST: env.HOST || '0.0.0.0',
  TRUST_PROXY: env.TRUST_PROXY || '',            // e.g. "1" behind nginx / a cloud load balancer
  TLS_CERT: env.TLS_CERT || '',                  // optional: terminate TLS in Node itself
  TLS_KEY: env.TLS_KEY || '',
  JWT_SECRET: persistentSecret('JWT_SECRET', '.jwtsecret'),
  DATA_KEY,                                      // AES-256-GCM key for field-level encryption at rest
  TOKEN_TTL_MS: parseInt(env.TOKEN_TTL_HOURS || '12', 10) * 3600e3,
  TZ_OFFSET_HOURS: parseFloat(env.TZ_OFFSET_HOURS || '2'),  // Kigali = UTC+2, used for daily streaks
  FACE_MATCH_THRESHOLD: parseFloat(env.FACE_MATCH_THRESHOLD || '0.5'),
  ID_MATCH_THRESHOLD: parseFloat(env.ID_MATCH_THRESHOLD || '0.55'),
  PROCTOR_RETENTION_DAYS: parseInt(env.PROCTOR_RETENTION_DAYS || '30', 10),
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  COCO_MODEL_URL: env.COCO_MODEL_URL || '',      // host the object-detection model yourself for offline use
  HELPLINE_TEXT: env.HELPLINE_TEXT || 'Please talk to a trusted adult, your teacher, or your local child / mental-health helpline right now.',
  SERVICES: (env.SERVICES || 'all').split(',').map(s => s.trim()).filter(Boolean),
  ADMIN_EMAIL: env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  SEED_DEMO: env.SEED_DEMO === '1' || (env.SEED_DEMO !== '0' && env.NODE_ENV !== 'production'),
  METRICS_TOKEN: env.METRICS_TOKEN || '',
  ALLOWED_ORIGINS: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  LOG_REQUESTS: env.LOG_REQUESTS === '1',
};
