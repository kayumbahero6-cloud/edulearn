'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const file = process.env.DB_FILE === ':memory:' ? ':memory:' : path.join(cfg.DATA_DIR, process.env.DB_FILE || 'edulearn.db');
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS schools(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT, district TEXT, type TEXT DEFAULT 'school',
  verified INTEGER DEFAULT 0, created_by INTEGER, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ux_schools ON schools(lower(name), lower(ifnull(district,'')));

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL,
  password_hash TEXT NOT NULL, school_id INTEGER REFERENCES schools(id), grade_level TEXT, birth_year INTEGER,
  guardian_contact_enc TEXT, guardian_consent INTEGER DEFAULT 0,
  consent_biometric INTEGER DEFAULT 0, consent_at INTEGER,
  face_enc TEXT, face_enrolled_at INTEGER, identity_verified INTEGER DEFAULT 0, identity_distance REAL, face_login INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0, last_active_day TEXT,
  lang TEXT DEFAULT 'en', settings TEXT DEFAULT '{}', show_on_leaderboard INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active', muted_until INTEGER DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER);
CREATE INDEX IF NOT EXISTS ix_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role);

CREATE TABLE IF NOT EXISTS classrooms(
  id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), teacher_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, grade TEXT, subject TEXT, code TEXT NOT NULL UNIQUE, archived INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments(
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL,
  PRIMARY KEY(classroom_id, student_id));

CREATE TABLE IF NOT EXISTS courses(
  id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, summary TEXT, description TEXT,
  grade_level TEXT NOT NULL, track TEXT NOT NULL DEFAULT 'academic', subject TEXT, curriculum TEXT, language TEXT DEFAULT 'en',
  cover_color TEXT DEFAULT '#0f766e', status TEXT NOT NULL DEFAULT 'draft', review_notes TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER);
CREATE INDEX IF NOT EXISTS ix_courses_filter ON courses(status, grade_level, track);
CREATE TABLE IF NOT EXISTS lessons(
  id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text', body TEXT, media_url TEXT, scorm_entry TEXT, scorm_version TEXT,
  ar_config TEXT, duration_min INTEGER DEFAULT 5, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_lessons_course ON lessons(course_id, position);
CREATE TABLE IF NOT EXISTS course_enrollments(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at INTEGER NOT NULL, PRIMARY KEY(user_id, course_id));
CREATE TABLE IF NOT EXISTS progress(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed INTEGER DEFAULT 0, completed_at INTEGER, score REAL, PRIMARY KEY(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS scorm_state(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  data TEXT, updated_at INTEGER, PRIMARY KEY(user_id, lesson_id));

CREATE TABLE IF NOT EXISTS assessments(
  id INTEGER PRIMARY KEY, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT,
  kind TEXT NOT NULL DEFAULT 'practice', compulsory INTEGER DEFAULT 0, time_limit_min INTEGER, proctored INTEGER DEFAULT 0,
  pass_mark INTEGER DEFAULT 50, shuffle INTEGER DEFAULT 1, max_attempts INTEGER DEFAULT 0, show_answers INTEGER DEFAULT 1,
  adaptive_length INTEGER DEFAULT 10, opens_at INTEGER, closes_at INTEGER, published INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS questions(
  id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE, position INTEGER DEFAULT 0,
  type TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT, answer TEXT NOT NULL, explanation TEXT, topic TEXT DEFAULT 'general',
  difficulty INTEGER DEFAULT 3, points REAL DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_questions_a ON questions(assessment_id, position);
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, deadline INTEGER, submitted_at INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress', answers TEXT DEFAULT '{}', meta TEXT DEFAULT '{}',
  score REAL, max_score REAL, passed INTEGER, risk INTEGER DEFAULT 0, proctor_status TEXT DEFAULT 'none', proctor_note TEXT,
  last_heartbeat INTEGER, precheck_id INTEGER);
CREATE INDEX IF NOT EXISTS ix_attempts_user ON attempts(user_id, assessment_id);
CREATE INDEX IF NOT EXISTS ix_attempts_a ON attempts(assessment_id, status);
CREATE TABLE IF NOT EXISTS mastery(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic TEXT NOT NULL, rating REAL DEFAULT 500,
  answered INTEGER DEFAULT 0, correct INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY(user_id, topic));
CREATE TABLE IF NOT EXISTS ai_chats(
  id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS precheck_sessions(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL, steps TEXT DEFAULT '{}', tries INTEGER DEFAULT 0, passed INTEGER DEFAULT 0, used INTEGER DEFAULT 0, degraded INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS proctor_events(
  id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
  kind TEXT NOT NULL, severity INTEGER DEFAULT 0, detail TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_pe_attempt ON proctor_events(attempt_id);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL, label TEXT, data_enc TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_snap_owner ON snapshots(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS proctor_appeals(
  id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
  message TEXT NOT NULL, status TEXT DEFAULT 'open', created_at INTEGER NOT NULL, resolved_by INTEGER, resolution TEXT);

CREATE TABLE IF NOT EXISTS xp_log(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_xp_user ON xp_log(user_id, created_at);
CREATE TABLE IF NOT EXISTS user_badges(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, badge TEXT NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY(user_id, badge));

CREATE TABLE IF NOT EXISTS threads(
  id INTEGER PRIMARY KEY, scope_type TEXT NOT NULL, scope_id INTEGER NOT NULL DEFAULT 0, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL, last_post_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_threads_scope ON threads(scope_type, scope_id, deleted);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, deleted INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_posts_thread ON posts(thread_id);
CREATE TABLE IF NOT EXISTS chat_messages(
  id INTEGER PRIMARY KEY, room TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, deleted INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_chat_room ON chat_messages(room, id);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY, reporter_id INTEGER, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, reason TEXT, priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open', created_at INTEGER NOT NULL, resolved_by INTEGER, resolution TEXT);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT, link TEXT,
  is_read INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT, ip TEXT, created_at INTEGER NOT NULL);
`);

const cache = new Map();
function stmt(sql) { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; }
const norm = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const q = {
  all: (sql, ...p) => stmt(sql).all(...norm(p)),
  get: (sql, ...p) => stmt(sql).get(...norm(p)),
  run: (sql, ...p) => { const r = stmt(sql).run(...norm(p)); return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }; },
  exec: sql => db.exec(sql),
};
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}
module.exports = { db, q, tx };
