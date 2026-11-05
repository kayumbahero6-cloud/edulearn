'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { q, tx } = require('../db');
const C = require('../crypto');
const cfg = require('../config');
const meta = require('../meta');
const G = require('../gamification');
const A = require('../access');
const { HttpError, wrap, S, int, num, json, audit, notify, safeMediaUrl, perUser } = require('../util');
const { auth, requireRole } = require('../auth');

const router = express.Router();
const authors = requireRole('creator', 'educator', 'admin');

/* ---------- reference data ---------- */
router.get('/meta', (req, res) => res.json({
  grades: meta.GRADES, tracks: meta.TRACKS, curricula: meta.CURRICULA, subjects: meta.SUBJECTS, languages: meta.LANGUAGES,
  badges: G.publicBadges(), features: { ai_claude: !!cfg.ANTHROPIC_API_KEY, coco_model_url: cfg.COCO_MODEL_URL || '', face_threshold: cfg.FACE_MATCH_THRESHOLD },
}));

/* ---------- catalogue ---------- */
router.get('/courses', auth, wrap(async (req, res) => {
  const u = req.user, Q = req.query;
  const where = [], p = [u.id, u.id];
  if (Q.mine === '1') { where.push('c.creator_id=?'); p.push(u.id); }
  else if (Q.enrolled === '1') { where.push(`c.status='published' AND EXISTS(SELECT 1 FROM course_enrollments e WHERE e.course_id=c.id AND e.user_id=?)`); p.push(u.id); }
  else if (Q.status && A.isStaffRole(u)) { where.push('c.status=?'); p.push(S(Q.status, 20)); }
  else where.push(`c.status='published'`);
  if (Q.grade && meta.gradeKeys.includes(Q.grade)) { where.push('c.grade_level=?'); p.push(Q.grade); }
  if (Q.band) { const keys = meta.GRADES.filter(g => g.band === Q.band).map(g => g.key); if (keys.length) { where.push(`c.grade_level IN (${keys.map(() => '?').join(',')})`); p.push(...keys); } }
  for (const k of ['track', 'subject', 'curriculum', 'language']) if (Q[k]) { where.push(`c.${k}=?`); p.push(S(Q[k], 100)); }
  if (Q.q) { where.push('(c.title LIKE ? OR c.summary LIKE ? OR c.subject LIKE ?)'); const t = '%' + S(Q.q, 80).replace(/[%_]/g, '') + '%'; p.push(t, t, t); }
  const rows = q.all(`SELECT c.id,c.title,c.summary,c.grade_level,c.track,c.subject,c.curriculum,c.language,c.cover_color,c.status,c.creator_id,c.updated_at,u.name creator_name,
      (SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id) lesson_count,
      (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id=c.id) learners,
      (SELECT COUNT(*) FROM progress pr JOIN lessons l ON l.id=pr.lesson_id WHERE l.course_id=c.id AND pr.user_id=? AND pr.completed=1) done,
      (SELECT 1 FROM course_enrollments e WHERE e.course_id=c.id AND e.user_id=?) enrolled
    FROM courses c JOIN users u ON u.id=c.creator_id WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 200`, ...p);
  res.json({ courses: rows.map(r => ({ ...r, enrolled: !!r.enrolled, percent: r.lesson_count ? Math.round(100 * r.done / r.lesson_count) : 0 })) });
}));

router.get('/courses/:id', auth, wrap(async (req, res) => {
  const c = q.get('SELECT c.*, u.name creator_name FROM courses c JOIN users u ON u.id=c.creator_id WHERE c.id=?', int(req.params.id));
  if (!c || !A.canViewCourse(req.user, c)) throw new HttpError(404, 'Course not found');
  const lessons = q.all(`SELECT l.id,l.position,l.title,l.type,l.duration_min, IFNULL(p.completed,0) completed FROM lessons l
      LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=? WHERE l.course_id=? ORDER BY l.position, l.id`, req.user.id, c.id);
  const owner = A.ownsCourse(req.user, c);
  const assessments = q.all(`SELECT id,title,kind,compulsory,proctored,time_limit_min,published,pass_mark FROM assessments WHERE course_id=? ${owner ? '' : 'AND published=1 AND classroom_id IS NULL'} ORDER BY id`, c.id);
  const enrolled = !!q.get('SELECT 1 x FROM course_enrollments WHERE user_id=? AND course_id=?', req.user.id, c.id);
  const done = lessons.filter(l => l.completed).length;
  res.json({ course: c, lessons, assessments, enrolled, owner, percent: lessons.length ? Math.round(100 * done / lessons.length) : 0 });
}));

function courseInput(b, partial = false) {
  const out = {};
  const need = (k, ok, msg) => { if (b[k] !== undefined || !partial) { if (!ok(b[k])) throw new HttpError(400, msg); out[k] = b[k]; } };
  need('title', v => S(v, 150).length >= 3, 'Title must be at least 3 characters');
  need('grade_level', v => meta.gradeKeys.includes(v), 'Choose a grade level');
  if (out.title) out.title = S(out.title, 150);
  if (b.track !== undefined || !partial) { if (!meta.TRACKS.some(t => t.key === (b.track || 'academic'))) throw new HttpError(400, 'Invalid track'); out.track = b.track || 'academic'; }
  for (const [k, max] of [['summary', 300], ['description', 5000], ['subject', 80], ['curriculum', 80]]) if (b[k] !== undefined) out[k] = S(b[k], max);
  if (b.language !== undefined) { if (!meta.LANGUAGES.some(l => l.key === b.language)) throw new HttpError(400, 'Invalid language'); out.language = b.language; }
  if (b.cover_color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(b.cover_color)) throw new HttpError(400, 'Invalid colour'); out.cover_color = b.cover_color; }
  return out;
}

router.post('/courses', auth, authors, wrap(async (req, res) => {
  const d = courseInput(req.body || {});
  const now = Date.now();
  const id = q.run(`INSERT INTO courses(creator_id,title,summary,description,grade_level,track,subject,curriculum,language,cover_color,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, req.user.id, d.title, d.summary || '', d.description || '', d.grade_level, d.track, d.subject || '', d.curriculum || '', d.language || 'en', d.cover_color || '#0f766e', 'draft', now, now).id;
  audit(req, 'course_create', { id });
  res.status(201).json({ course: q.get('SELECT * FROM courses WHERE id=?', id) });
}));

function ownCourse(req) {
  const c = q.get('SELECT * FROM courses WHERE id=?', int(req.params.id));
  if (!c) throw new HttpError(404, 'Course not found');
  if (!A.ownsCourse(req.user, c)) throw new HttpError(403, 'Only the course owner can change this');
  return c;
}

router.put('/courses/:id', auth, authors, wrap(async (req, res) => {
  const c = ownCourse(req);
  const d = courseInput(req.body || {}, true);
  const keys = Object.keys(d);
  if (keys.length) q.run(`UPDATE courses SET ${keys.map(k => k + '=?').join(',')}, updated_at=? WHERE id=?`, ...keys.map(k => d[k]), Date.now(), c.id);
  res.json({ course: q.get('SELECT * FROM courses WHERE id=?', c.id) });
}));

router.post('/courses/:id/submit', auth, authors, wrap(async (req, res) => {
  const c = ownCourse(req);
  if (!q.get('SELECT 1 x FROM lessons WHERE course_id=?', c.id)) throw new HttpError(400, 'Add at least one lesson before submitting for review');
  const status = A.isAdmin(req.user) ? 'published' : 'pending';
  q.run('UPDATE courses SET status=?, review_notes=NULL, updated_at=?, published_at=CASE WHEN ?=\'published\' THEN ? ELSE published_at END WHERE id=?', status, Date.now(), status, Date.now(), c.id);
  if (status === 'pending') for (const m of q.all(`SELECT id FROM users WHERE role IN ('admin','moderator') AND status='active'`)) notify(m.id, 'Course awaiting review', c.title, '#/admin');
  res.json({ status });
}));

router.delete('/courses/:id', auth, authors, wrap(async (req, res) => {
  const c = ownCourse(req);
  if (c.status === 'published' && !A.isAdmin(req.user)) throw new HttpError(400, 'Published courses can only be removed by an administrator. Ask to unpublish it.');
  q.run('DELETE FROM courses WHERE id=?', c.id);
  audit(req, 'course_delete', { id: c.id });
  res.json({ ok: true });
}));

router.post('/courses/:id/enroll', auth, wrap(async (req, res) => {
  const c = q.get(`SELECT * FROM courses WHERE id=? AND status='published'`, int(req.params.id));
  if (!c) throw new HttpError(404, 'Course not found');
  q.run('INSERT OR IGNORE INTO course_enrollments(user_id,course_id,enrolled_at) VALUES(?,?,?)', req.user.id, c.id, Date.now());
  res.json({ ok: true });
}));
router.delete('/courses/:id/enroll', auth, wrap(async (req, res) => {
  q.run('DELETE FROM course_enrollments WHERE user_id=? AND course_id=?', req.user.id, int(req.params.id));
  res.json({ ok: true });
}));

/* ---------- lessons ---------- */
const LESSON_TYPES = ['text', 'video', 'pdf', 'scorm', 'ar', 'vr'];
const SHAPES = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'plane', 'ring'];
const vec = (s, def) => { const a = String(s || def).trim().split(/\s+/).map(Number); return a.length === 3 && a.every(Number.isFinite) ? a.map(x => Math.max(-500, Math.min(500, x))).join(' ') : def; };

function cleanArConfig(type, cfgIn) {
  if (type !== 'ar' && type !== 'vr') return null;
  const c = cfgIn && typeof cfgIn === 'object' ? cfgIn : {};
  if (type === 'ar') return JSON.stringify({ model_url: safeMediaUrl(c.model_url), alt: S(c.alt, 200), auto_rotate: c.auto_rotate !== false, ar: c.ar !== false, scale: S(c.scale, 20) || '1 1 1' });
  const ents = (Array.isArray(c.entities) ? c.entities : []).slice(0, 60).map(e => ({
    shape: SHAPES.includes(e.shape) ? e.shape : 'sphere', color: /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : '#4cc9f0',
    position: vec(e.position, '0 1.5 -3'), scale: vec(e.scale, '1 1 1'), label: S(e.label, 60), animate: ['spin', 'orbit', ''].includes(e.animate) ? e.animate : '',
  }));
  return JSON.stringify({ sky: /^#[0-9a-fA-F]{6}$/.test(c.sky) ? c.sky : '#0b1020', ground: /^#[0-9a-fA-F]{6}$/.test(c.ground) ? c.ground : '#1b2a41', panorama_url: c.panorama_url ? safeMediaUrl(c.panorama_url) : '', entities: ents });
}

function lessonInput(b, existing) {
  const type = b.type !== undefined ? b.type : (existing ? existing.type : 'text');
  if (!LESSON_TYPES.includes(type)) throw new HttpError(400, 'Invalid lesson type');
  const title = b.title !== undefined ? S(b.title, 150) : existing.title;
  if (title.length < 2) throw new HttpError(400, 'Lesson title is too short');
  return {
    type, title,
    body: b.body !== undefined ? String(b.body).slice(0, 60000) : (existing ? existing.body : ''),
    media_url: b.media_url !== undefined ? safeMediaUrl(b.media_url) : (existing ? existing.media_url : ''),
    ar_config: (b.ar_config !== undefined || type !== (existing && existing.type)) ? cleanArConfig(type, b.ar_config || json(existing && existing.ar_config, {})) : existing.ar_config,
    duration_min: b.duration_min !== undefined ? Math.max(1, Math.min(240, int(b.duration_min, 5))) : (existing ? existing.duration_min : 5),
  };
}

router.post('/courses/:id/lessons', auth, authors, wrap(async (req, res) => {
  const c = ownCourse(req);
  const d = lessonInput(req.body || {}, null);
  const pos = (q.get('SELECT IFNULL(MAX(position),0)+1 n FROM lessons WHERE course_id=?', c.id)).n;
  const id = q.run('INSERT INTO lessons(course_id,position,title,type,body,media_url,ar_config,duration_min,created_at) VALUES(?,?,?,?,?,?,?,?,?)', c.id, pos, d.title, d.type, d.body, d.media_url, d.ar_config, d.duration_min, Date.now()).id;
  q.run('UPDATE courses SET updated_at=? WHERE id=?', Date.now(), c.id);
  res.status(201).json({ lesson: q.get('SELECT * FROM lessons WHERE id=?', id) });
}));

function ownLesson(req) {
  const l = q.get('SELECT * FROM lessons WHERE id=?', int(req.params.id));
  if (!l) throw new HttpError(404, 'Lesson not found');
  const c = q.get('SELECT * FROM courses WHERE id=?', l.course_id);
  if (!A.ownsCourse(req.user, c)) throw new HttpError(403, 'Only the course owner can change this');
  return { l, c };
}

router.put('/lessons/:id', auth, authors, wrap(async (req, res) => {
  const { l, c } = ownLesson(req);
  const d = lessonInput(req.body || {}, l);
  q.run('UPDATE lessons SET title=?,type=?,body=?,media_url=?,ar_config=?,duration_min=? WHERE id=?', d.title, d.type, d.body, d.media_url, d.ar_config, d.duration_min, l.id);
  q.run('UPDATE courses SET updated_at=? WHERE id=?', Date.now(), c.id);
  res.json({ lesson: q.get('SELECT * FROM lessons WHERE id=?', l.id) });
}));
router.delete('/lessons/:id', auth, authors, wrap(async (req, res) => {
  const { l } = ownLesson(req);
  q.run('DELETE FROM lessons WHERE id=?', l.id);
  fs.rmSync(path.join(cfg.DATA_DIR, 'scorm', String(l.id)), { recursive: true, force: true });
  res.json({ ok: true });
}));
router.post('/courses/:id/lessons/reorder', auth, authors, wrap(async (req, res) => {
  const c = ownCourse(req);
  const order = Array.isArray(req.body && req.body.order) ? req.body.order.map(Number) : [];
  tx(() => order.forEach((id, i) => q.run('UPDATE lessons SET position=? WHERE id=? AND course_id=?', i + 1, id, c.id)));
  res.json({ ok: true });
}));

router.get('/lessons/:id', auth, wrap(async (req, res) => {
  const l = q.get('SELECT * FROM lessons WHERE id=?', int(req.params.id));
  const c = l && q.get('SELECT c.*, u.name creator_name FROM courses c JOIN users u ON u.id=c.creator_id WHERE c.id=?', l.course_id);
  if (!l || !A.canViewCourse(req.user, c)) throw new HttpError(404, 'Lesson not found');
  if (c.status === 'published' && req.user.role === 'student') q.run('INSERT OR IGNORE INTO course_enrollments(user_id,course_id,enrolled_at) VALUES(?,?,?)', req.user.id, c.id, Date.now());
  const all = q.all('SELECT id FROM lessons WHERE course_id=? ORDER BY position,id', c.id).map(r => r.id);
  const i = all.indexOf(l.id);
  const prog = q.get('SELECT completed,score FROM progress WHERE user_id=? AND lesson_id=?', req.user.id, l.id);
  G.touch(req.user.id);
  res.json({
    lesson: { ...l, ar_config: json(l.ar_config, null), scorm_entry: undefined, has_scorm: !!l.scorm_entry },
    course: { id: c.id, title: c.title, grade_level: c.grade_level, creator_name: c.creator_name }, prev: all[i - 1] || null, next: all[i + 1] || null,
    completed: !!(prog && prog.completed), index: i + 1, total: all.length,
  });
}));

router.post('/lessons/:id/complete', auth, wrap(async (req, res) => {
  const l = q.get('SELECT * FROM lessons WHERE id=?', int(req.params.id));
  const c = l && q.get('SELECT * FROM courses WHERE id=?', l.course_id);
  if (!l || !A.canViewCourse(req.user, c)) throw new HttpError(404, 'Lesson not found');
  res.json(markComplete(req.user.id, l, num(req.body && req.body.score)));
}));

function markComplete(userId, lesson, score = null) {
  const had = q.get('SELECT completed FROM progress WHERE user_id=? AND lesson_id=?', userId, lesson.id);
  const prevDone = courseDone(userId, lesson.course_id);
  q.run(`INSERT INTO progress(user_id,lesson_id,completed,completed_at,score) VALUES(?,?,1,?,?)
         ON CONFLICT(user_id,lesson_id) DO UPDATE SET completed=1, completed_at=COALESCE(completed_at,excluded.completed_at), score=COALESCE(excluded.score,score)`, userId, lesson.id, Date.now(), score);
  let xp = 0;
  if (!(had && had.completed)) { xp += 10; G.awardXp(userId, 10, 'Lesson completed'); }
  const nowDone = courseDone(userId, lesson.course_id);
  let courseComplete = false;
  if (nowDone && !prevDone) { courseComplete = true; xp += 50; G.awardXp(userId, 50, 'Course completed'); }
  G.touch(userId);
  return { ok: true, xp_awarded: xp, course_complete: courseComplete, badges: G.checkBadges(userId) };
}
const courseDone = (uid, cid) => { const r = q.get(`SELECT COUNT(*) t, SUM(CASE WHEN p.completed=1 THEN 1 ELSE 0 END) d FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=? WHERE l.course_id=?`, uid, cid); return r.t > 0 && r.t === r.d; };

/* ---------- uploads (images, video, audio, pdf, 3D models) ---------- */
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.pdf', '.glb']);
const uploader = multer({
  storage: multer.diskStorage({ destination: path.join(cfg.DATA_DIR, 'uploads'), filename: (req, f, cb) => cb(null, C.randomHex(12) + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => MEDIA_EXT.has(path.extname(f.originalname).toLowerCase()) ? cb(null, true) : cb(new HttpError(400, 'That file type is not allowed. Use png, jpg, gif, webp, mp4, webm, mp3, ogg, wav, pdf or glb.')),
});
router.post('/upload', auth, authors, perUser({ windowMs: 60e3, max: 20 }), uploader.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file received');
  audit(req, 'upload', { name: req.file.filename, size: req.file.size });
  res.status(201).json({ url: '/files/' + req.file.filename, size: req.file.size, name: req.file.originalname });
}));

/* ---------- SCORM 1.2 / 2004 packages ---------- */
const SCORM_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.xml', '.xsd', '.dtd', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.txt', '.pdf', '.map']);
const scormUp = multer({ dest: os.tmpdir(), limits: { fileSize: 150 * 1024 * 1024, files: 1 } });

function extractScorm(zipPath, lessonId) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > 6000) throw new HttpError(400, 'Package has too many files');
  const root = path.join(cfg.DATA_DIR, 'scorm', String(lessonId));
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  let total = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName.replace(/\\/g, '/');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new HttpError(400, 'Package contains unsafe file paths');
    total += e.header.size;
    if (total > 400 * 1024 * 1024) throw new HttpError(400, 'Package is too large when extracted');
    if (!SCORM_EXT.has(path.extname(name).toLowerCase())) continue;
    const dest = path.join(root, name);
    if (!dest.startsWith(root + path.sep)) throw new HttpError(400, 'Package contains unsafe file paths');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
  }
  const mf = fs.readdirSync(root).find(f => f.toLowerCase() === 'imsmanifest.xml');
  if (!mf) throw new HttpError(400, 'imsmanifest.xml not found at the root of the package. Is this a SCORM zip?');
  const xml = fs.readFileSync(path.join(root, mf), 'utf8');
  const version = /<schemaversion>\s*(?:CAM\s*)?1\.2/i.test(xml) ? '1.2' : (/2004|CAM\s*1\.3/i.test(xml) ? '2004' : '1.2');
  let entry = null;
  for (const m of xml.matchAll(/<resource\b[^>]*>/gi)) {
    const href = /\bhref\s*=\s*"([^"]+)"/i.exec(m[0]);
    const type = /scormtype\s*=\s*"([^"]+)"/i.exec(m[0]);
    if (href && (!type || /sco/i.test(type[1]))) { entry = decodeURIComponent(href[1]); break; }
  }
  if (!entry || entry.split('/').includes('..') || !fs.existsSync(path.join(root, entry.split('?')[0]))) throw new HttpError(400, 'Could not find the launch file declared in the manifest');
  return { entry, version };
}

router.post('/lessons/:id/scorm', auth, authors, scormUp.single('file'), wrap(async (req, res) => {
  try {
    const { l, c } = ownLesson(req);
    if (!req.file) throw new HttpError(400, 'No file received');
    if (path.extname(req.file.originalname).toLowerCase() !== '.zip') throw new HttpError(400, 'Upload the SCORM package as a .zip file');
    const r = extractScorm(req.file.path, l.id);
    q.run(`UPDATE lessons SET type='scorm', scorm_entry=?, scorm_version=? WHERE id=?`, r.entry, r.version, l.id);
    q.run('UPDATE courses SET updated_at=? WHERE id=?', Date.now(), c.id);
    audit(req, 'scorm_upload', { lesson: l.id, version: r.version });
    res.json({ ok: true, entry: r.entry, version: r.version });
  } finally { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); }
}));

// SCORM content runs in its own top-level tab with a scoped token (see public/scorm-player.html) so package JavaScript never sees the user's session.
router.get('/lessons/:id/scorm-launch', auth, wrap(async (req, res) => {
  const l = q.get('SELECT * FROM lessons WHERE id=?', int(req.params.id));
  const c = l && q.get('SELECT * FROM courses WHERE id=?', l.course_id);
  if (!l || !l.scorm_entry || !A.canViewCourse(req.user, c)) throw new HttpError(404, 'SCORM lesson not found');
  const token = C.sign({ typ: 'scorm', uid: req.user.id, lid: l.id }, 6 * 3600e3);
  res.json({ url: `/scorm-player.html#lesson=${l.id}&token=${token}`, version: l.scorm_version });
}));

function scormAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const p = h.startsWith('Bearer ') ? C.verify(h.slice(7)) : null;
  if (!p || p.typ !== 'scorm') return next(new HttpError(401, 'Invalid SCORM session'));
  req.scorm = p; next();
}
router.get('/scorm/state', scormAuth, wrap(async (req, res) => {
  const l = q.get('SELECT id,title,scorm_entry,scorm_version FROM lessons WHERE id=?', req.scorm.lid);
  const u = q.get('SELECT id,name FROM users WHERE id=?', req.scorm.uid);
  if (!l || !u) throw new HttpError(404, 'Not found');
  const row = q.get('SELECT data FROM scorm_state WHERE user_id=? AND lesson_id=?', u.id, l.id);
  res.json({ lesson: { id: l.id, title: l.title, entry: l.scorm_entry, version: l.scorm_version }, learner: { id: String(u.id), name: u.name }, data: json(row && row.data, {}) });
}));
router.post('/scorm/commit', scormAuth, express.json({ limit: '300kb' }), wrap(async (req, res) => {
  const data = req.body && typeof req.body.data === 'object' && req.body.data ? req.body.data : {};
  const clean = {};
  for (const [k, v] of Object.entries(data).slice(0, 400)) if (/^cmi\.[A-Za-z0-9_.]{1,120}$/.test(k)) clean[k] = String(v).slice(0, 8000);
  q.run(`INSERT INTO scorm_state(user_id,lesson_id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`, req.scorm.uid, req.scorm.lid, JSON.stringify(clean), Date.now());
  const status = (clean['cmi.core.lesson_status'] || clean['cmi.completion_status'] || '').toLowerCase();
  const success = (clean['cmi.success_status'] || '').toLowerCase();
  const done = ['completed', 'passed'].includes(status) || success === 'passed';
  let out = { saved: true, completed: false };
  if (done) {
    const l = q.get('SELECT * FROM lessons WHERE id=?', req.scorm.lid);
    const raw = num(clean['cmi.core.score.raw'] ?? clean['cmi.score.raw']);
    out = { saved: true, completed: true, ...markComplete(req.scorm.uid, l, raw) };
  }
  res.json(out);
}));

module.exports = router;
module.exports.markComplete = markComplete;
