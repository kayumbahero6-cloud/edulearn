'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cfg = require('./config');
const { q } = require('./db');
const { HttpError, rateLimit } = require('./util');

/*
 * One codebase, deployable as one process or several services (see docs/ARCHITECTURE.md).
 * SERVICES=all                         -> everything in one process (default, easiest to run)
 * SERVICES=identity,content            -> only those route groups; put a gateway/load balancer in front
 * Groups: identity, content, assess, proctor, social, admin, realtime
 */
const on = name => cfg.SERVICES.includes('all') || cfg.SERVICES.includes(name);

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(cfg.TRUST_PROXY) ? parseInt(cfg.TRUST_PROXY, 10) : cfg.TRUST_PROXY);

  const started = Date.now();
  const counters = { requests: 0, errors: 0, s4xx: 0, s5xx: 0 };

  // Security headers. 'wasm-unsafe-eval' is needed by the in-browser face/object models; media + connect allow https model hosts.
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), fullscreen=(self), xr-spatial-tracking=(self), accelerometer=(self), gyroscope=(self)',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (cfg.IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!req.path.startsWith('/scorm/') && !req.path.startsWith('/files/')) {
      res.set('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
        "connect-src 'self' ws: wss: https: blob: data:",
        "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
      ].join('; '));
    }
    next();
  });

  app.use((req, res, next) => {
    counters.requests++;
    const t = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 500) counters.s5xx++; else if (res.statusCode >= 400) counters.s4xx++;
      if (cfg.LOG_REQUESTS) console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`);
    });
    next();
  });

  if (cfg.ALLOWED_ORIGINS.length) {
    app.use('/api', (req, res, next) => {
      const o = req.headers.origin;
      if (o && cfg.ALLOWED_ORIGINS.includes(o)) { res.set({ 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', Vary: 'Origin' }); }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  /* ---- health & metrics (for load balancers, k8s probes, Prometheus) ---- */
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/readyz', (req, res) => {
    try { q.get('SELECT 1 x'); res.json({ ready: true, uptime_s: Math.round((Date.now() - started) / 1000), services: cfg.SERVICES }); }
    catch (e) { res.status(503).json({ ready: false }); }
  });
  app.get('/metrics', (req, res) => {
    if (cfg.METRICS_TOKEN && req.headers.authorization !== 'Bearer ' + cfg.METRICS_TOKEN) return res.sendStatus(401);
    let ws = { rooms: 0, clients: 0 };
    try { ws = require('./hub').stats(); } catch { /* hub not attached */ }
    const m = process.memoryUsage();
    res.type('text/plain').send([
      `edulearn_http_requests_total ${counters.requests}`, `edulearn_http_4xx_total ${counters.s4xx}`, `edulearn_http_5xx_total ${counters.s5xx}`,
      `edulearn_ws_clients ${ws.clients}`, `edulearn_ws_rooms ${ws.rooms}`,
      `edulearn_process_rss_bytes ${m.rss}`, `edulearn_uptime_seconds ${Math.round(process.uptime())}`,
    ].join('\n') + '\n');
  });

  /* ---- API ---- */
  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));
  api.use(rateLimit({ windowMs: 60e3, max: 600 }));
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  if (on('identity')) { api.use('/auth', require('./routes/auth')); api.use(require('./routes/schools')); }
  if (on('content')) api.use(require('./routes/content'));
  if (on('assess')) api.use(require('./routes/assess'));
  if (on('proctor')) api.use(require('./routes/proctor'));
  if (on('social')) api.use(require('./routes/social'));
  if (on('admin')) api.use(require('./routes/admin'));
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  /* ---- user uploads: served as inert downloads-or-media, never as HTML ---- */
  app.use('/files', express.static(path.join(cfg.DATA_DIR, 'uploads'), {
    index: false, dotfiles: 'deny', maxAge: '7d', immutable: true,
    setHeaders: (res, file) => {
      res.set('X-Content-Type-Options', 'nosniff');
      // Chrome's built-in PDF viewer refuses sandboxed documents, and PDFs are not HTML, so they are the one exception.
      if (!/\.pdf$/i.test(file)) res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    },
  }));

  /* ---- SCORM packages: third-party JavaScript, so it is sandboxed (opaque origin, no cookies/storage access to our app) ----
   * Every HTML page of a package gets the SCORM API shim injected (public/scorm-shim.js). When the launch URL carries a valid scoped token (?st=)
   * the learner's saved data model is embedded too, so resume works with SCORM's synchronous API. */
  const SCORM_ROOT = path.join(cfg.DATA_DIR, 'scorm');
  const SCORM_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'";
  app.use('/scorm', (req, res, next) => {
    if (!/\.html?$/i.test(req.path)) return next();
    const parts = decodeURIComponent(req.path).split('/').filter(Boolean);
    const file = path.join(SCORM_ROOT, ...parts);
    if (!file.startsWith(SCORM_ROOT + path.sep) || !fs.existsSync(file)) return next();
    let init = { learner: { id: '0', name: 'Learner' }, data: {} };
    const tok = req.query.st ? require('./crypto').verify(String(req.query.st)) : null;
    if (tok && tok.typ === 'scorm' && String(tok.lid) === parts[0]) {
      const u = q.get('SELECT id,name FROM users WHERE id=?', tok.uid);
      const st = q.get('SELECT data FROM scorm_state WHERE user_id=? AND lesson_id=?', tok.uid, tok.lid);
      if (u) init = { learner: { id: String(u.id), name: u.name }, data: st ? JSON.parse(st.data || '{}') : {} };
    }
    let html = fs.readFileSync(file, 'utf8');
    const tag = `<script>window.__EDU_SCORM=${JSON.stringify(init).replace(/</g, '\\u003c')};</script><script src="/scorm-shim.js"></script>`;
    const m = /<head[^>]*>/i.exec(html) || /<html[^>]*>/i.exec(html);
    html = m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : (/^\s*<!doctype[^>]*>/i.exec(html) ? html.replace(/^(\s*<!doctype[^>]*>)/i, '$1' + tag) : tag + html);
    res.set({ 'Content-Security-Policy': SCORM_CSP, 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).type('html').send(html);
  });
  app.use('/scorm', express.static(path.join(cfg.DATA_DIR, 'scorm'), {
    index: false, dotfiles: 'deny', maxAge: 0,
    setHeaders: (res) => res.set({
      'Content-Security-Policy': SCORM_CSP,
      'Cross-Origin-Resource-Policy': 'same-origin',
    }),
  }));

  /* ---- front-end ---- */
  app.use('/vendor', express.static(path.join(cfg.PUBLIC_DIR, 'vendor'), { maxAge: '30d', immutable: true }));
  app.use(express.static(cfg.PUBLIC_DIR, { index: 'index.html', maxAge: cfg.IS_PROD ? '1h' : 0 }));
  app.get(/^\/(?!api\/|files\/|scorm\/|ws).*/, (req, res) => res.sendFile(path.join(cfg.PUBLIC_DIR, 'index.html')));

  /* ---- errors ---- */
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body' });
    if (err && err.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed' });
    counters.errors++;
    console.error('[error]', req.method, req.originalUrl, err && err.stack || err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });
  return app;
}

function jobs() {
  const every = (ms, fn, name) => setInterval(() => { try { fn(); } catch (e) { console.warn(`[job:${name}]`, e.message); } }, ms).unref();
  if (on('assess')) every(60e3, () => { const n = require('./routes/assess').autoSubmitExpired(); if (n) console.log(`[job] auto-submitted ${n} expired attempt(s)`); }, 'auto-submit');
  if (on('proctor')) { every(6 * 3600e3, () => { const r = require('./routes/proctor').purge(); if (r.snapshots || r.prechecks) console.log('[job] retention purge', r); }, 'retention'); }
  every(3600e3, () => { q.run('DELETE FROM audit_log WHERE created_at<?', Date.now() - 365 * 864e5); q.run('DELETE FROM notifications WHERE is_read=1 AND created_at<?', Date.now() - 60 * 864e5); }, 'housekeeping');
}

function bootstrapAdmin() {
  if (!cfg.ADMIN_EMAIL || !cfg.ADMIN_PASSWORD) return;
  if (q.get('SELECT 1 x FROM users WHERE email=?', cfg.ADMIN_EMAIL)) return;
  require('./crypto').hashPassword(cfg.ADMIN_PASSWORD).then(h => {
    q.run(`INSERT INTO users(email,name,role,password_hash,created_at) VALUES(?,?,?,?,?)`, cfg.ADMIN_EMAIL, 'Platform Admin', 'admin', h, Date.now());
    console.log('[boot] created admin account', cfg.ADMIN_EMAIL);
  });
}

function start() {
  const app = createApp();
  const server = cfg.TLS_CERT && cfg.TLS_KEY
    ? https.createServer({ cert: fs.readFileSync(cfg.TLS_CERT), key: fs.readFileSync(cfg.TLS_KEY) }, app)
    : http.createServer(app);
  if (on('realtime')) require('./hub').attach(server);
  server.keepAliveTimeout = 65e3;
  bootstrapAdmin();
  if (cfg.SEED_DEMO && !q.get('SELECT 1 x FROM users LIMIT 1')) require('./seed').run();
  jobs();
  server.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`EduLearn running on ${cfg.TLS_CERT ? 'https' : 'http'}://localhost:${cfg.PORT}  [services: ${cfg.SERVICES.join(',')}]`);
    if (!cfg.TLS_CERT && cfg.IS_PROD) console.log('[security] No TLS_CERT set: terminate HTTPS at your load balancer / reverse proxy and set TRUST_PROXY=1.');
  });
  const stop = () => { console.log('shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return server;
}

if (require.main === module) start();
module.exports = { createApp, start };
