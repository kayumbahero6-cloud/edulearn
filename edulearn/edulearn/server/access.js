'use strict';
// Central place for "who may see/do what" checks, shared by REST routes and the WebSocket hub.
const { q } = require('./db');
const { HttpError } = require('./util');
const C = require('./crypto');
const { ageOf } = require('./auth');

const isAdmin = u => u.role === 'admin';
const isStaffRole = u => u.role === 'admin' || u.role === 'moderator';

function classroomAccess(user, classroomId) {
  const c = q.get('SELECT * FROM classrooms WHERE id=?', classroomId);
  if (!c) return null;
  if (isAdmin(user) || c.teacher_id === user.id) return { classroom: c, teacher: true };
  if (user.role === 'moderator') return { classroom: c, teacher: false, moderator: true };
  if (q.get('SELECT 1 x FROM enrollments WHERE classroom_id=? AND student_id=?', c.id, user.id)) return { classroom: c, teacher: false };
  return null;
}
const isTeacherOf = (user, classroomId) => { const a = classroomAccess(user, classroomId); return !!(a && a.teacher); };

// Is `staff` allowed to review/assess this student (teacher of one of their classes, school admin, platform staff)?
function teachesStudent(staff, studentId) {
  if (isStaffRole(staff)) return true;
  return !!q.get('SELECT 1 x FROM enrollments e JOIN classrooms c ON c.id=e.classroom_id WHERE e.student_id=? AND c.teacher_id=?', studentId, staff.id);
}

function canViewCourse(user, course) {
  return course.status === 'published' || course.creator_id === user.id || isStaffRole(user);
}
const ownsCourse = (user, course) => course.creator_id === user.id || isAdmin(user);

function joinByCode(user, code) {
  const c = q.get('SELECT * FROM classrooms WHERE code=? AND archived=0', String(code || '').trim().toUpperCase());
  if (!c) throw new HttpError(404, 'That classroom code was not found. Check it with your teacher.', 'bad_code');
  q.run('INSERT OR IGNORE INTO enrollments(classroom_id,student_id,joined_at) VALUES(?,?,?)', c.id, user.id, Date.now());
  if (!user.school_id && c.school_id) q.run('UPDATE users SET school_id=? WHERE id=?', c.school_id, user.id);
  return c;
}

// Chat rooms: "class:<id>", "course:<id>", "school:<id>"
function roomAccess(user, room) {
  const [type, idRaw] = String(room).split(':');
  const id = parseInt(idRaw, 10);
  if (!id) return null;
  const age = ageOf(user);
  if (type === 'class') {
    const a = classroomAccess(user, id);
    return a ? { name: a.classroom.name + ' (class)', moderate: a.teacher || isStaffRole(user) } : null;
  }
  if (type === 'course') {
    const c = q.get('SELECT * FROM courses WHERE id=?', id);
    if (!c || c.status !== 'published') return null;
    const ok = c.creator_id === user.id || isStaffRole(user) || q.get('SELECT 1 x FROM course_enrollments WHERE user_id=? AND course_id=?', user.id, id);
    return ok ? { name: c.title + ' (course)', moderate: c.creator_id === user.id || isStaffRole(user) } : null;
  }
  if (type === 'school') {
    const s = q.get('SELECT * FROM schools WHERE id=?', id);
    if (!s) return null;
    if (isStaffRole(user)) return { name: s.name + ' (school)', moderate: true };
    if (user.school_id !== id) return null;
    if (user.role === 'student' && age !== null && age < 13) return null; // youngest learners: class rooms only
    return { name: s.name + ' (school)', moderate: user.role === 'educator' };
  }
  return null;
}

function roomsFor(user) {
  const out = [];
  const add = (key, r) => { if (r) out.push({ room: key, name: r.name }); };
  if (user.role === 'student') {
    for (const r of q.all('SELECT classroom_id id FROM enrollments WHERE student_id=?', user.id)) add('class:' + r.id, roomAccess(user, 'class:' + r.id));
  } else if (user.role === 'educator') {
    for (const r of q.all('SELECT id FROM classrooms WHERE teacher_id=? AND archived=0', user.id)) add('class:' + r.id, roomAccess(user, 'class:' + r.id));
  }
  for (const r of q.all('SELECT course_id id FROM course_enrollments WHERE user_id=?', user.id)) add('course:' + r.id, roomAccess(user, 'course:' + r.id));
  if (user.school_id) add('school:' + user.school_id, roomAccess(user, 'school:' + user.school_id));
  return out;
}

// Forum scope access: returns { ok, moderate } for read/write
function scopeAccess(user, type, id) {
  const age = ageOf(user);
  if (type === 'classroom') { const a = classroomAccess(user, id); return a ? { ok: true, moderate: a.teacher || !!a.moderator } : { ok: false }; }
  if (type === 'course') {
    const c = q.get('SELECT * FROM courses WHERE id=?', id);
    if (!c || !canViewCourse(user, c)) return { ok: false };
    const member = c.creator_id === user.id || isStaffRole(user) || q.get('SELECT 1 x FROM course_enrollments WHERE user_id=? AND course_id=?', user.id, id);
    return { ok: !!member, moderate: c.creator_id === user.id || isStaffRole(user) };
  }
  if (type === 'school') {
    if (isStaffRole(user)) return { ok: true, moderate: true };
    if (user.school_id !== id) return { ok: false };
    if (user.role === 'student' && age !== null && age < 13) return { ok: false };
    return { ok: true, moderate: user.role === 'educator' };
  }
  if (type === 'global') return { ok: !(age !== null && age < 13), moderate: isStaffRole(user) };
  return { ok: false };
}

const sealContact = s => (s ? C.encrypt(s) : null);

module.exports = { isAdmin, isStaffRole, classroomAccess, isTeacherOf, teachesStudent, canViewCourse, ownsCourse, joinByCode, roomAccess, roomsFor, scopeAccess, sealContact };
