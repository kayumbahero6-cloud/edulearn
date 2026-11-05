'use strict';
const express = require('express');
const { q } = require('../db');
const G = require('../gamification');
const A = require('../access');
const M = require('../moderation');
const meta = require('../meta');
const { ageOf, auth } = require('../auth');
const { HttpError, wrap, S, int, flag, audit, notify, perUser, json } = require('../util');

const router = express.Router();
const isMinor = u => { const a = ageOf(u); return a !== null && a < 18; };

/* ---------------------------------------------------------------- moderation core (shared with chat hub) */
function screen(user, text) {
  const r = M.check(text, { minor: isMinor(user) });
  if (r.blocked) throw new (require('../util').HttpError)(422, r.reasons.join('. ') || 'That message cannot be posted', 'moderated', { flags: r.flags });
  return r;
}
function queueReport(reporterId, type, id, reason, priority = 0) {
  q.run('INSERT INTO reports(reporter_id,target_type,target_id,reason,priority,created_at) VALUES(?,?,?,?,?,?)', reporterId, type, id, reason, priority, Date.now());
  for (const m of q.all(`SELECT id FROM users WHERE role IN ('admin','moderator') AND status='active' LIMIT 20`)) notify(m.id, priority >= 3 ? 'Urgent: welfare concern' : 'New report', reason.slice(0, 120), '#/admin');
}
function afterScreen(user, r, type, id) {
  if (r.welfare) {
    queueReport(null, type, id, 'Possible welfare concern in a student message', 3);
    notify(user.id, 'You are not alone', r.welfareNote, '');
  }
}

/* ---------------------------------------------------------------- forum */
function scopeFrom(req, src) {
  const type = S(src.scope_type, 20), id = int(src.scope_id, 0);
  const s = A.scopeAccess(req.user, type, id);
  if (!s.ok) throw new HttpError(403, 'You do not have access to this discussion board', 'forbidden');
  return { type, id, moderate: !!s.moderate };
}

router.get('/forum/scopes', auth, wrap(async (req, res) => {
  const u = req.user, out = [];
  if (A.scopeAccess(u, 'global', 0).ok) out.push({ scope_type: 'global', scope_id: 0, name: 'Everyone (global)' });
  if (u.school_id && A.scopeAccess(u, 'school', u.school_id).ok) out.push({ scope_type: 'school', scope_id: u.school_id, name: (q.get('SELECT name FROM schools WHERE id=?', u.school_id) || {}).name + ' (school)' });
  for (const c of A.roomsFor(u)) {
    const [t, id] = c.room.split(':');
    if (t === 'class') out.push({ scope_type: 'classroom', scope_id: +id, name: c.name });
    if (t === 'course') out.push({ scope_type: 'course', scope_id: +id, name: c.name });
  }
  res.json({ scopes: out });
}));

router.get('/forum/threads', auth, wrap(async (req, res) => {
  const sc = scopeFrom(req, req.query);
  const rows = q.all(`SELECT t.id,t.title,t.pinned,t.locked,t.created_at,t.last_post_at,t.author_id,u.name author,u.role author_role,
      (SELECT COUNT(*) FROM posts p WHERE p.thread_id=t.id AND p.deleted=0) replies FROM threads t JOIN users u ON u.id=t.author_id
      WHERE t.scope_type=? AND t.scope_id=? AND t.deleted=0 ORDER BY t.pinned DESC, t.last_post_at DESC LIMIT 100`, sc.type, sc.id);
  res.json({ threads: rows, can_moderate: sc.moderate });
}));

router.post('/forum/threads', auth, perUser({ windowMs: 10 * 60e3, max: 10, message: 'You are posting too quickly. Try again in a few minutes.' }), wrap(async (req, res) => {
  const sc = scopeFrom(req, req.body || {});
  if (req.user.muted_until > Date.now()) throw new HttpError(403, 'You are temporarily muted by a moderator', 'muted');
  const title = S(req.body.title, 150), body = S(req.body.body, 4000);
  if (title.length < 3 || body.length < 3) throw new HttpError(400, 'Add a title and a message');
  const rt = screen(req.user, title), rb = screen(req.user, body);
  const now = Date.now();
  const id = q.run('INSERT INTO threads(scope_type,scope_id,author_id,title,body,created_at,last_post_at) VALUES(?,?,?,?,?,?,?)', sc.type, sc.id, req.user.id, rt.text, rb.text, now, now).id;
  afterScreen(req.user, { welfare: rt.welfare || rb.welfare, welfareNote: rb.welfareNote || rt.welfareNote }, 'thread', id);
  G.touch(req.user.id); G.checkBadges(req.user.id);
  res.status(201).json({ id });
}));

router.get('/forum/threads/:id', auth, wrap(async (req, res) => {
  const t = q.get('SELECT t.*,u.name author,u.role author_role FROM threads t JOIN users u ON u.id=t.author_id WHERE t.id=? AND t.deleted=0', int(req.params.id));
  if (!t) throw new HttpError(404, 'Thread not found');
  const s = A.scopeAccess(req.user, t.scope_type, t.scope_id);
  if (!s.ok) throw new HttpError(403, 'No access');
  const posts = q.all(`SELECT p.id,p.body,p.created_at,p.author_id,u.name author,u.role author_role FROM posts p JOIN users u ON u.id=p.author_id WHERE p.thread_id=? AND p.deleted=0 ORDER BY p.id LIMIT 500`, t.id);
  res.json({ thread: { id: t.id, title: t.title, body: t.body, author: t.author, author_id: t.author_id, author_role: t.author_role, created_at: t.created_at, pinned: !!t.pinned, locked: !!t.locked, scope_type: t.scope_type, scope_id: t.scope_id }, posts, can_moderate: !!s.moderate });
}));

router.post('/forum/threads/:id/posts', auth, perUser({ windowMs: 60e3, max: 12, message: 'Slow down a little, then reply again.' }), wrap(async (req, res) => {
  const t = q.get('SELECT * FROM threads WHERE id=? AND deleted=0', int(req.params.id));
  if (!t) throw new HttpError(404, 'Thread not found');
  if (!A.scopeAccess(req.user, t.scope_type, t.scope_id).ok) throw new HttpError(403, 'No access');
  if (t.locked) throw new HttpError(403, 'This thread is locked', 'locked');
  if (req.user.muted_until > Date.now()) throw new HttpError(403, 'You are temporarily muted by a moderator', 'muted');
  const r = screen(req.user, S(req.body && req.body.body, 4000));
  const now = Date.now();
  const id = q.run('INSERT INTO posts(thread_id,author_id,body,created_at) VALUES(?,?,?,?)', t.id, req.user.id, r.text, now).id;
  q.run('UPDATE threads SET last_post_at=? WHERE id=?', now, t.id);
  afterScreen(req.user, r, 'post', id);
  if (t.author_id !== req.user.id) notify(t.author_id, 'New reply to your thread', t.title, `#/forum/${t.id}`);
  G.touch(req.user.id); G.checkBadges(req.user.id);
  res.status(201).json({ id });
}));

function modTarget(req, type, id) {
  const row = q.get(type === 'thread' ? 'SELECT * FROM threads WHERE id=?' : 'SELECT p.*, t.scope_type, t.scope_id FROM posts p JOIN threads t ON t.id=p.thread_id WHERE p.id=?', id);
  if (!row) throw new HttpError(404, 'Not found');
  const s = A.scopeAccess(req.user, row.scope_type, row.scope_id);
  return { row, canMod: s.ok && s.moderate, own: row.author_id === req.user.id };
}
router.delete('/forum/threads/:id', auth, wrap(async (req, res) => {
  const { canMod, own } = modTarget(req, 'thread', int(req.params.id));
  if (!canMod && !own) throw new HttpError(403, 'Only the author or a moderator can delete this');
  q.run('UPDATE threads SET deleted=1 WHERE id=?', int(req.params.id)); audit(req, 'thread_delete', { id: req.params.id });
  res.json({ ok: true });
}));
router.delete('/forum/posts/:id', auth, wrap(async (req, res) => {
  const { canMod, own } = modTarget(req, 'post', int(req.params.id));
  if (!canMod && !own) throw new HttpError(403, 'Only the author or a moderator can delete this');
  q.run('UPDATE posts SET deleted=1 WHERE id=?', int(req.params.id)); audit(req, 'post_delete', { id: req.params.id });
  res.json({ ok: true });
}));
router.post('/forum/threads/:id/moderate', auth, wrap(async (req, res) => {
  const { canMod } = modTarget(req, 'thread', int(req.params.id));
  if (!canMod) throw new HttpError(403, 'Moderators only');
  const b = req.body || {};
  if (b.pinned !== undefined) q.run('UPDATE threads SET pinned=? WHERE id=?', flag(b.pinned), int(req.params.id));
  if (b.locked !== undefined) q.run('UPDATE threads SET locked=? WHERE id=?', flag(b.locked), int(req.params.id));
  res.json({ ok: true });
}));

router.post('/report', auth, perUser({ windowMs: 10 * 60e3, max: 20 }), wrap(async (req, res) => {
  const b = req.body || {};
  if (!['thread', 'post', 'chat', 'user'].includes(b.target_type)) throw new HttpError(400, 'Invalid report target');
  const reason = S(b.reason, 400);
  if (reason.length < 3) throw new HttpError(400, 'Tell us briefly what is wrong');
  const tid = int(b.target_id);
  const table = { thread: 'threads', post: 'posts', chat: 'chat_messages', user: 'users' }[b.target_type];
  if (!q.get(`SELECT 1 x FROM ${table} WHERE id=?`, tid)) throw new HttpError(404, 'Target not found');
  const col = { thread: 'threads', post: 'posts', chat: 'chat_messages' }[b.target_type];
  if (col) q.run(`UPDATE ${col} SET flagged=1 WHERE id=?`, tid);
  queueReport(req.user.id, b.target_type, tid, reason, /unsafe|threat|hurt|abuse|bully/i.test(reason) ? 2 : 1);
  res.status(201).json({ ok: true });
}));

/* ---------------------------------------------------------------- chat history (live delivery is over WebSocket) */
router.get('/chat/rooms', auth, wrap(async (req, res) => res.json({ rooms: A.roomsFor(req.user) })));
router.get('/chat/:room/history', auth, wrap(async (req, res) => {
  const ra = A.roomAccess(req.user, req.params.room);
  if (!ra) throw new HttpError(403, 'No access to this chat room');
  const before = int(req.query.before, 9e15);
  const rows = q.all(`SELECT m.id,m.user_id,u.name,u.role,m.body,m.created_at FROM chat_messages m JOIN users u ON u.id=m.user_id
     WHERE m.room=? AND m.deleted=0 AND m.id<? ORDER BY m.id DESC LIMIT 50`, req.params.room, before).reverse();
  res.json({ messages: rows, room: { name: ra.name, can_moderate: ra.moderate } });
}));
router.delete('/chat/messages/:id', auth, wrap(async (req, res) => {
  const m = q.get('SELECT * FROM chat_messages WHERE id=?', int(req.params.id));
  if (!m) throw new HttpError(404, 'Not found');
  const ra = A.roomAccess(req.user, m.room);
  if (!(m.user_id === req.user.id || (ra && ra.moderate))) throw new HttpError(403, 'Only the author or a moderator can delete this');
  q.run('UPDATE chat_messages SET deleted=1 WHERE id=?', m.id);
  require('../hub').broadcastDelete(m.room, m.id);
  audit(req, 'chat_delete', { id: m.id });
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- gamification */
router.get('/gamification/me', auth, wrap(async (req, res) => {
  const u = req.user;
  const lvl = G.levelFor(u.xp);
  const earned = new Map(q.all('SELECT badge,earned_at FROM user_badges WHERE user_id=?', u.id).map(r => [r.badge, r.earned_at]));
  const mastery = q.all('SELECT topic,ROUND(rating) rating,answered,correct FROM mastery WHERE user_id=? ORDER BY rating DESC', u.id)
    .map(m => ({ ...m, level: m.rating >= 700 ? 'Strong' : m.rating >= 450 ? 'Developing' : 'Needs practice' }));
  const week = q.all('SELECT SUBSTR(DATE((created_at/1000)+?,\'unixepoch\'),1,10) d, SUM(amount) xp FROM xp_log WHERE user_id=? AND created_at>? GROUP BY d ORDER BY d', Math.round(require('../config').TZ_OFFSET_HOURS * 3600), u.id, Date.now() - 7 * 864e5);
  res.json({
    xp: u.xp, level: lvl, level_floor: G.xpForLevel(lvl), next_level_xp: G.xpForLevel(lvl + 1), streak: u.streak, best_streak: u.best_streak,
    badges: G.publicBadges().map(b => ({ ...b, earned: earned.has(b.key), earned_at: earned.get(b.key) || null })), mastery, week,
    recent_xp: q.all('SELECT amount,reason,created_at FROM xp_log WHERE user_id=? ORDER BY id DESC LIMIT 12', u.id),
  });
}));

router.get('/leaderboard', auth, wrap(async (req, res) => {
  const u = req.user;
  const scope = ['global', 'school', 'class'].includes(req.query.scope) ? req.query.scope : 'school';
  const period = req.query.period === 'week' ? 'week' : 'all';
  const where = [`u.role='student'`, `u.status='active'`, 'u.show_on_leaderboard=1'], p = [];
  if (scope === 'school') { if (!u.school_id) throw new HttpError(400, 'Join a school or class to see the school board'); where.push('u.school_id=?'); p.push(u.school_id); }
  if (scope === 'class') {
    const cid = int(req.query.classroom_id);
    if (!A.classroomAccess(u, cid)) throw new HttpError(403, 'No access to this class');
    where.push('u.id IN (SELECT student_id FROM enrollments WHERE classroom_id=?)'); p.push(cid);
  }
  const valueSql = period === 'week' ? `COALESCE((SELECT SUM(amount) FROM xp_log x WHERE x.user_id=u.id AND x.created_at>${Date.now() - 7 * 864e5}),0)` : 'u.xp';
  const rows = q.all(`SELECT u.id,u.name,u.streak,u.grade_level,${valueSql} points,(SELECT COUNT(*) FROM user_badges b WHERE b.user_id=u.id) badges FROM users u
     WHERE ${where.join(' AND ')} ORDER BY points DESC, u.name LIMIT 50`, ...p);
  // Public boards show first name + initial only (privacy for minors).
  const short = n => { const [f, ...r] = String(n).split(' '); return r.length ? `${f} ${r[r.length - 1][0]}.` : f; };
  const board = rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.id === u.id ? r.name : short(r.name), points: r.points, streak: r.streak, badges: r.badges, level: G.levelFor(r.points), me: r.id === u.id }));
  let me = board.find(r => r.me) || null;
  if (!me && u.role === 'student') {
    me = { rank: null, points: period === 'week' ? 0 : u.xp, hidden: !u.show_on_leaderboard };
  }
  res.json({ scope, period, board, me });
}));

/* ---------------------------------------------------------------- notifications & dashboard */
router.get('/notifications', auth, wrap(async (req, res) => {
  res.json({ notifications: q.all('SELECT id,title,body,link,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', req.user.id), unread: q.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', req.user.id).c });
}));
router.post('/notifications/read', auth, wrap(async (req, res) => {
  const id = int(req.body && req.body.id);
  if (id) q.run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', id, req.user.id); else q.run('UPDATE notifications SET is_read=1 WHERE user_id=?', req.user.id);
  res.json({ ok: true });
}));

router.get('/dashboard', auth, wrap(async (req, res) => {
  const u = req.user, now = Date.now();
  const out = { role: u.role };
  const c = (sql, ...p) => q.get(sql, ...p).c;
  if (u.role === 'student') {
    out.continue = q.all(`SELECT c.id,c.title,c.cover_color,c.grade_level,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id) total,
        (SELECT COUNT(*) FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE l.course_id=c.id AND p.user_id=? AND p.completed=1) done,
        (SELECT l.id FROM lessons l WHERE l.course_id=c.id AND NOT EXISTS(SELECT 1 FROM progress p WHERE p.lesson_id=l.id AND p.user_id=? AND p.completed=1) ORDER BY l.position,l.id LIMIT 1) next_lesson
      FROM course_enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=? AND c.status='published' ORDER BY e.enrolled_at DESC LIMIT 6`, u.id, u.id, u.id).filter(r => r.total > r.done);
    out.due = q.all(`SELECT a.id,a.title,a.kind,a.compulsory,a.proctored,a.closes_at,cl.name classroom FROM assessments a JOIN classrooms cl ON cl.id=a.classroom_id
        WHERE a.published=1 AND a.classroom_id IN (SELECT classroom_id FROM enrollments WHERE student_id=?)
        AND NOT EXISTS(SELECT 1 FROM attempts t WHERE t.assessment_id=a.id AND t.user_id=? AND t.status='submitted') AND (a.closes_at IS NULL OR a.closes_at>?) ORDER BY IFNULL(a.closes_at,9e15) LIMIT 8`, u.id, u.id, now);
    out.recent = q.all(`SELECT t.id,a.title,a.kind,t.score,t.max_score,t.passed,t.submitted_at,t.proctor_status FROM attempts t JOIN assessments a ON a.id=t.assessment_id WHERE t.user_id=? AND t.status='submitted' ORDER BY t.id DESC LIMIT 5`, u.id)
      .map(r => ({ ...r, percent: r.proctor_status === 'flagged' ? null : (r.max_score ? Math.round(100 * r.score / r.max_score) : 0), score: undefined, max_score: undefined }));
    out.classrooms = c('SELECT COUNT(*) c FROM enrollments WHERE student_id=?', u.id);
    const weak = q.get('SELECT topic FROM mastery WHERE user_id=? AND answered>=3 ORDER BY rating LIMIT 1', u.id);
    out.focus_topic = weak ? weak.topic : null;
  } else if (u.role === 'educator') {
    out.classrooms = q.all(`SELECT c.id,c.name,c.code,(SELECT COUNT(*) FROM enrollments WHERE classroom_id=c.id) students FROM classrooms c WHERE c.teacher_id=? AND c.archived=0 ORDER BY c.id DESC LIMIT 12`, u.id);
    out.students = c('SELECT COUNT(DISTINCT e.student_id) c FROM enrollments e JOIN classrooms c ON c.id=e.classroom_id WHERE c.teacher_id=?', u.id);
    out.to_review = c(`SELECT COUNT(*) c FROM attempts t JOIN assessments a ON a.id=t.assessment_id WHERE a.proctored=1 AND t.proctor_status IN ('review','flagged') AND (a.creator_id=? OR a.classroom_id IN (SELECT id FROM classrooms WHERE teacher_id=?))`, u.id, u.id);
    out.my_courses = c('SELECT COUNT(*) c FROM courses WHERE creator_id=?', u.id);
    out.my_assessments = c('SELECT COUNT(*) c FROM assessments WHERE creator_id=?', u.id);
  } else if (u.role === 'creator') {
    out.my_courses = q.all(`SELECT c.id,c.title,c.status,c.review_notes,(SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id=c.id) learners,(SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id) lessons FROM courses c WHERE c.creator_id=? ORDER BY c.updated_at DESC LIMIT 20`, u.id);
    out.total_learners = c('SELECT COUNT(DISTINCT e.user_id) c FROM course_enrollments e JOIN courses c ON c.id=e.course_id WHERE c.creator_id=?', u.id);
  } else {
    out.pending_courses = c(`SELECT COUNT(*) c FROM courses WHERE status='pending'`);
    out.open_reports = c(`SELECT COUNT(*) c FROM reports WHERE status='open'`);
    out.users = c('SELECT COUNT(*) c FROM users');
  }
  res.json(out);
}));

module.exports = router;
module.exports.screen = screen;
module.exports.afterScreen = afterScreen;
module.exports.queueReport = queueReport;
