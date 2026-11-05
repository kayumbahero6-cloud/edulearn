'use strict';
const express = require('express');
const { q } = require('../db');
const C = require('../crypto');
const { HttpError, wrap, S, int, audit, notify, json } = require('../util');
const { auth, requireRole } = require('../auth');
const A = require('../access');
const meta = require('../meta');

const router = express.Router();

/* ---------- Schools (public list is needed during sign-up) ---------- */
router.get('/schools', wrap(async (req, res) => {
  const term = '%' + S(req.query.q, 80).replace(/[%_]/g, '') + '%';
  res.json({ schools: q.all('SELECT id,name,country,district,type,verified FROM schools WHERE name LIKE ? OR district LIKE ? ORDER BY verified DESC, name LIMIT 60', term, term) });
}));

router.post('/schools', auth, requireRole('educator', 'admin'), wrap(async (req, res) => {
  const b = req.body || {};
  const name = S(b.name, 120);
  if (name.length < 3) throw new HttpError(400, 'School name is too short');
  const r = q.run('INSERT OR IGNORE INTO schools(name,country,district,type,created_by,created_at) VALUES(?,?,?,?,?,?)', name, S(b.country, 80) || 'Rwanda', S(b.district, 80),
    ['school', 'university', 'training-centre', 'other'].includes(b.type) ? b.type : 'school', req.user.id, Date.now());
  const school = r.changes ? q.get('SELECT * FROM schools WHERE id=?', r.id) : q.get(`SELECT * FROM schools WHERE lower(name)=lower(?) AND lower(ifnull(district,''))=lower(?)`, name, S(b.district, 80));
  if (!req.user.school_id) q.run('UPDATE users SET school_id=? WHERE id=?', school.id, req.user.id);
  audit(req, 'school_create', { id: school.id });
  res.status(201).json({ school });
}));

router.put('/me/school', auth, requireRole('educator'), wrap(async (req, res) => {
  const s = q.get('SELECT id FROM schools WHERE id=?', int(req.body && req.body.school_id));
  if (!s) throw new HttpError(404, 'School not found');
  q.run('UPDATE users SET school_id=? WHERE id=?', s.id, req.user.id);
  res.json({ ok: true });
}));

/* ---------- Classrooms ---------- */
function uniqueCode() { for (let i = 0; i < 20; i++) { const c = C.randomCode(6); if (!q.get('SELECT 1 x FROM classrooms WHERE code=?', c)) return c; } throw new Error('code space exhausted'); }

router.get('/classrooms', auth, wrap(async (req, res) => {
  const u = req.user;
  let rows;
  if (u.role === 'student') {
    rows = q.all(`SELECT c.id,c.name,c.grade,c.subject,c.school_id,c.archived,t.name teacher_name,
        (SELECT COUNT(*) FROM enrollments WHERE classroom_id=c.id) students
      FROM enrollments e JOIN classrooms c ON c.id=e.classroom_id JOIN users t ON t.id=c.teacher_id WHERE e.student_id=? AND c.archived=0`, u.id);
  } else if (u.role === 'admin' || u.role === 'moderator') {
    rows = q.all(`SELECT c.*, t.name teacher_name, (SELECT COUNT(*) FROM enrollments WHERE classroom_id=c.id) students FROM classrooms c JOIN users t ON t.id=c.teacher_id ORDER BY c.id DESC LIMIT 200`);
  } else {
    rows = q.all(`SELECT c.*, t.name teacher_name, (SELECT COUNT(*) FROM enrollments WHERE classroom_id=c.id) students FROM classrooms c JOIN users t ON t.id=c.teacher_id WHERE c.teacher_id=? ORDER BY c.archived, c.id DESC`, u.id);
  }
  res.json({ classrooms: rows });
}));

router.post('/classrooms', auth, requireRole('educator'), wrap(async (req, res) => {
  const b = req.body || {};
  const name = S(b.name, 100);
  if (name.length < 2) throw new HttpError(400, 'Give the classroom a name');
  if (!req.user.school_id) throw new HttpError(400, 'Choose or create your school profile first', 'no_school');
  const grade = meta.gradeKeys.includes(b.grade) ? b.grade : null;
  const id = q.run('INSERT INTO classrooms(school_id,teacher_id,name,grade,subject,code,created_at) VALUES(?,?,?,?,?,?,?)',
    req.user.school_id, req.user.id, name, grade, S(b.subject, 80), uniqueCode(), Date.now()).id;
  audit(req, 'classroom_create', { id });
  res.status(201).json({ classroom: q.get('SELECT * FROM classrooms WHERE id=?', id) });
}));

router.post('/classrooms/join', auth, requireRole('student'), wrap(async (req, res) => {
  const c = A.joinByCode(req.user, req.body && req.body.code);
  notify(c.teacher_id, 'New student joined', `${req.user.name} joined ${c.name}`, '#/classes/' + c.id);
  res.json({ classroom: { id: c.id, name: c.name, grade: c.grade, subject: c.subject } });
}));

router.get('/classrooms/:id', auth, wrap(async (req, res) => {
  const acc = A.classroomAccess(req.user, int(req.params.id));
  if (!acc) throw new HttpError(404, 'Classroom not found');
  const c = acc.classroom;
  const out = { classroom: acc.teacher || acc.moderator ? c : { id: c.id, name: c.name, grade: c.grade, subject: c.subject }, teacher: acc.teacher };
  out.teacher_name = q.get('SELECT name FROM users WHERE id=?', c.teacher_id).name;
  const roster = q.all(`SELECT u.id,u.name,u.grade_level,u.xp,u.streak,u.guardian_consent,u.face_enc IS NOT NULL face_enrolled,u.birth_year,e.joined_at
      FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.classroom_id=? ORDER BY u.name`, c.id);
  if (acc.teacher || acc.moderator) out.students = roster.map(r => ({ ...r, minor: r.birth_year ? new Date().getFullYear() - r.birth_year < 18 : false, birth_year: undefined }));
  else out.students = roster.map(r => ({ id: r.id, name: r.name }));
  out.assessments = q.all(`SELECT id,title,kind,compulsory,proctored,time_limit_min,opens_at,closes_at,published FROM assessments WHERE classroom_id=? ${acc.teacher ? '' : 'AND published=1'} ORDER BY id DESC`, c.id);
  res.json(out);
}));

router.post('/classrooms/:id/code', auth, requireRole('educator', 'admin'), wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!A.isTeacherOf(req.user, id)) throw new HttpError(403, 'Only the classroom teacher can do this');
  const code = uniqueCode();
  q.run('UPDATE classrooms SET code=? WHERE id=?', code, id);
  audit(req, 'classroom_code_regen', { id });
  res.json({ code });
}));

router.post('/classrooms/:id/archive', auth, requireRole('educator', 'admin'), wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!A.isTeacherOf(req.user, id)) throw new HttpError(403, 'Only the classroom teacher can do this');
  q.run('UPDATE classrooms SET archived=? WHERE id=?', req.body && req.body.archived === false ? 0 : 1, id);
  res.json({ ok: true });
}));

router.delete('/classrooms/:id/students/:uid', auth, requireRole('educator', 'admin'), wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!A.isTeacherOf(req.user, id)) throw new HttpError(403, 'Only the classroom teacher can do this');
  q.run('DELETE FROM enrollments WHERE classroom_id=? AND student_id=?', id, int(req.params.uid));
  res.json({ ok: true });
}));

// The school confirms it holds parental consent on file (needed before biometrics / proctoring for under-18s).
router.post('/classrooms/:id/students/:uid/guardian-consent', auth, requireRole('educator', 'admin'), wrap(async (req, res) => {
  const id = int(req.params.id), uid = int(req.params.uid);
  if (!A.isTeacherOf(req.user, id)) throw new HttpError(403, 'Only the classroom teacher can do this');
  if (!q.get('SELECT 1 x FROM enrollments WHERE classroom_id=? AND student_id=?', id, uid)) throw new HttpError(404, 'Student is not in this class');
  const on = req.body && req.body.confirmed === false ? 0 : 1;
  q.run('UPDATE users SET guardian_consent=? WHERE id=?', on, uid);
  audit(req, 'guardian_consent', { student: uid, confirmed: on });
  notify(uid, on ? 'Parental consent confirmed' : 'Parental consent removed', on ? 'Your school confirmed your guardian\'s consent. You can now use face verification and proctored exams.' : 'Face-based features are turned off for your account.', '#/settings');
  res.json({ ok: true });
}));

/* ---------- Classroom analytics (educator) ---------- */
router.get('/classrooms/:id/analytics', auth, requireRole('educator', 'admin', 'moderator'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const acc = A.classroomAccess(req.user, id);
  if (!acc || !(acc.teacher || acc.moderator)) throw new HttpError(403, 'Only the classroom teacher can see analytics');
  const week = Date.now() - 7 * 864e5;
  const students = q.all(`SELECT u.id,u.name,u.xp,u.streak,u.last_active_day FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.classroom_id=? ORDER BY u.name`, id);
  const rows = students.map(s => {
    const att = q.all(`SELECT a.score,a.max_score,a.submitted_at,a.assessment_id FROM attempts a JOIN assessments x ON x.id=a.assessment_id
       WHERE a.user_id=? AND a.status='submitted' AND (x.classroom_id=? OR x.classroom_id IS NULL)`, s.id, id);
    const pct = att.length ? att.reduce((t, a) => t + (a.max_score ? a.score / a.max_score : 0), 0) / att.length * 100 : null;
    const lessons = q.get('SELECT COUNT(*) c FROM progress WHERE user_id=? AND completed=1', s.id).c;
    const recent = q.get('SELECT COUNT(*) c FROM xp_log WHERE user_id=? AND created_at>?', s.id, week).c;
    const flags = [];
    if (pct !== null && pct < 50) flags.push('low scores');
    if (recent === 0) flags.push('inactive 7 days');
    return { ...s, attempts: att.length, avg_percent: pct === null ? null : Math.round(pct), lessons_completed: lessons, active_this_week: recent > 0, at_risk: flags };
  });
  const topics = q.all(`SELECT m.topic, ROUND(AVG(m.rating)) rating, SUM(m.answered) answered, SUM(m.correct) correct FROM mastery m
      WHERE m.user_id IN (SELECT student_id FROM enrollments WHERE classroom_id=?) GROUP BY m.topic ORDER BY rating`, id);
  const assigned = q.all(`SELECT s.id,s.title,s.kind,s.compulsory,s.closes_at,
      (SELECT COUNT(DISTINCT a.user_id) FROM attempts a WHERE a.assessment_id=s.id AND a.status='submitted' AND a.user_id IN (SELECT student_id FROM enrollments WHERE classroom_id=?)) submitted
      FROM assessments s WHERE s.classroom_id=?`, id, id);
  res.json({ students: rows, topics, assigned, total_students: students.length });
}));

module.exports = router;
