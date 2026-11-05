'use strict';
const express = require('express');
const { q } = require('../db');
const A = require('../access');
const cfg = require('../config');
const { auth, requireRole } = require('../auth');
const { HttpError, wrap, S, int, audit, notify, json } = require('../util');

const router = express.Router();
const staff = requireRole('admin', 'moderator');
const adminOnly = requireRole('admin');

router.get('/admin/overview', auth, staff, wrap(async (req, res) => {
  const c = (sql, ...p) => q.get(sql, ...p).c;
  const day = Date.now() - 864e5;
  res.json({
    users: { total: c('SELECT COUNT(*) c FROM users'), students: c(`SELECT COUNT(*) c FROM users WHERE role='student'`), educators: c(`SELECT COUNT(*) c FROM users WHERE role='educator'`), creators: c(`SELECT COUNT(*) c FROM users WHERE role='creator'`), active_24h: c('SELECT COUNT(*) c FROM users WHERE last_login_at>?', day), face_enrolled: c('SELECT COUNT(*) c FROM users WHERE face_enc IS NOT NULL') },
    schools: c('SELECT COUNT(*) c FROM schools'), classrooms: c('SELECT COUNT(*) c FROM classrooms'),
    courses: { published: c(`SELECT COUNT(*) c FROM courses WHERE status='published'`), pending: c(`SELECT COUNT(*) c FROM courses WHERE status='pending'`) },
    attempts: { total: c(`SELECT COUNT(*) c FROM attempts WHERE status='submitted'`), flagged: c(`SELECT COUNT(*) c FROM attempts WHERE proctor_status='flagged'`) },
    reports_open: c(`SELECT COUNT(*) c FROM reports WHERE status='open'`), appeals_open: c(`SELECT COUNT(*) c FROM proctor_appeals WHERE status='open'`),
  });
}));

/* ---------- course review queue ---------- */
router.get('/admin/courses/pending', auth, staff, wrap(async (req, res) => {
  res.json({ courses: q.all(`SELECT c.id,c.title,c.summary,c.grade_level,c.track,c.subject,c.curriculum,c.language,c.updated_at,u.name creator_name,
     (SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id) lessons FROM courses c JOIN users u ON u.id=c.creator_id WHERE c.status='pending' ORDER BY c.updated_at`) });
}));
router.post('/admin/courses/:id/review', auth, staff, wrap(async (req, res) => {
  const c = q.get('SELECT * FROM courses WHERE id=?', int(req.params.id));
  if (!c) throw new HttpError(404, 'Course not found');
  const d = req.body && req.body.decision;
  if (!['approve', 'reject', 'unpublish'].includes(d)) throw new HttpError(400, 'Invalid decision');
  const note = S(req.body.note, 600);
  if (d === 'reject' && note.length < 3) throw new HttpError(400, 'Tell the creator what to fix');
  const now = Date.now();
  if (d === 'approve') q.run(`UPDATE courses SET status='published', published_at=?, review_notes=NULL, updated_at=? WHERE id=?`, now, now, c.id);
  else q.run(`UPDATE courses SET status='draft', review_notes=?, updated_at=? WHERE id=?`, note || 'Unpublished by a moderator', now, c.id);
  notify(c.creator_id, d === 'approve' ? 'Course published 🎉' : 'Course needs changes', `${c.title}${note ? ' — ' + note : ''}`, '#/studio');
  audit(req, 'course_review', { id: c.id, d });
  res.json({ ok: true });
}));

/* ---------- reports ---------- */
router.get('/admin/reports', auth, staff, wrap(async (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const rows = q.all(`SELECT r.*, u.name reporter FROM reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status=? ORDER BY r.priority DESC, r.id DESC LIMIT 100`, status);
  const out = rows.map(r => {
    let content = null, author = null, author_id = null;
    if (r.target_type === 'chat') { const m = q.get('SELECT m.body,m.user_id,u.name FROM chat_messages m JOIN users u ON u.id=m.user_id WHERE m.id=?', r.target_id); if (m) { content = m.body; author = m.name; author_id = m.user_id; } }
    if (r.target_type === 'post') { const m = q.get('SELECT m.body,m.author_id user_id,u.name FROM posts m JOIN users u ON u.id=m.author_id WHERE m.id=?', r.target_id); if (m) { content = m.body; author = m.name; author_id = m.user_id; } }
    if (r.target_type === 'thread') { const m = q.get('SELECT m.title||char(10)||m.body body,m.author_id user_id,u.name FROM threads m JOIN users u ON u.id=m.author_id WHERE m.id=?', r.target_id); if (m) { content = m.body; author = m.name; author_id = m.user_id; } }
    if (r.target_type === 'user') { const m = q.get('SELECT id user_id,name FROM users WHERE id=?', r.target_id); if (m) { author = m.name; author_id = m.user_id; } }
    return { ...r, content, author, author_id };
  });
  res.json({ reports: out });
}));
router.post('/admin/reports/:id/resolve', auth, staff, wrap(async (req, res) => {
  const r = q.get('SELECT * FROM reports WHERE id=?', int(req.params.id));
  if (!r) throw new HttpError(404, 'Report not found');
  const action = (req.body && req.body.action) || 'dismiss';
  const note = S(req.body && req.body.note, 400);
  if (action === 'remove') {
    const t = { thread: 'threads', post: 'posts', chat: 'chat_messages' }[r.target_type];
    if (t) q.run(`UPDATE ${t} SET deleted=1 WHERE id=?`, r.target_id);
    if (r.target_type === 'chat') { const m = q.get('SELECT room FROM chat_messages WHERE id=?', r.target_id); if (m) require('../hub').broadcastDelete(m.room, r.target_id); }
  }
  if (action === 'mute' && r.target_type !== 'user') {
    const t = { thread: ['threads', 'author_id'], post: ['posts', 'author_id'], chat: ['chat_messages', 'user_id'] }[r.target_type];
    const row = t && q.get(`SELECT ${t[1]} uid FROM ${t[0]} WHERE id=?`, r.target_id);
    if (row) q.run('UPDATE users SET muted_until=? WHERE id=? AND role NOT IN (\'admin\')', Date.now() + 24 * 3600e3, row.uid);
  }
  if (action === 'mute' && r.target_type === 'user') q.run(`UPDATE users SET muted_until=? WHERE id=? AND role!='admin'`, Date.now() + 24 * 3600e3, r.target_id);
  q.run(`UPDATE reports SET status='resolved', resolved_by=?, resolution=? WHERE id=?`, req.user.id, action + (note ? ': ' + note : ''), r.id);
  audit(req, 'report_resolve', { id: r.id, action });
  res.json({ ok: true });
}));

/* ---------- users (admin) ---------- */
router.get('/admin/users', auth, staff, wrap(async (req, res) => {
  const term = '%' + S(req.query.q, 80).replace(/[%_]/g, '') + '%';
  const rows = q.all(`SELECT u.id,u.email,u.name,u.role,u.status,u.muted_until,u.xp,u.face_enc IS NOT NULL face_enrolled,u.identity_verified,u.created_at,u.last_login_at,s.name school
     FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE (u.name LIKE ? OR u.email LIKE ?) ${req.query.role ? 'AND u.role=?' : ''} ORDER BY u.id DESC LIMIT 100`, ...[term, term, ...(req.query.role ? [S(req.query.role, 20)] : [])]);
  res.json({ users: rows.map(r => req.user.role === 'admin' ? r : { ...r, email: r.email.replace(/^(.).*(@.*)$/, '$1***$2') }) });
}));
router.post('/admin/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  const u = q.get('SELECT * FROM users WHERE id=?', id);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'You cannot change your own role or status');
  if (b.role !== undefined) {
    if (!['student', 'creator', 'educator', 'moderator', 'admin'].includes(b.role)) throw new HttpError(400, 'Invalid role');
    q.run('UPDATE users SET role=? WHERE id=?', b.role, id);
  }
  if (b.status !== undefined) {
    if (!['active', 'suspended'].includes(b.status)) throw new HttpError(400, 'Invalid status');
    q.run('UPDATE users SET status=? WHERE id=?', b.status, id);
  }
  if (b.unmute) q.run('UPDATE users SET muted_until=0 WHERE id=?', id);
  audit(req, 'admin_user_update', { id, b: { role: b.role, status: b.status } });
  res.json({ ok: true });
}));

router.post('/admin/schools/:id/verify', auth, adminOnly, wrap(async (req, res) => {
  q.run('UPDATE schools SET verified=? WHERE id=?', req.body && req.body.verified === false ? 0 : 1, int(req.params.id));
  res.json({ ok: true });
}));

router.get('/admin/appeals', auth, staff, wrap(async (req, res) => {
  res.json({ appeals: q.all(`SELECT p.*, u.name student, a.title FROM proctor_appeals p JOIN users u ON u.id=p.user_id JOIN attempts t ON t.id=p.attempt_id JOIN assessments a ON a.id=t.assessment_id WHERE p.status='open' ORDER BY p.id DESC LIMIT 100`) });
}));

router.get('/admin/audit', auth, adminOnly, wrap(async (req, res) => {
  res.json({ log: q.all('SELECT l.id,l.action,l.detail,l.ip,l.created_at,u.name FROM audit_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200') });
}));

module.exports = router;
