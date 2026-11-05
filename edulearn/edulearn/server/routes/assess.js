'use strict';
const express = require('express');
const { q, tx } = require('../db');
const C = require('../crypto');
const G = require('../gamification');
const A = require('../access');
const AI = require('../ai');
const M = require('../moderation');
const { ageOf, auth, requireRole } = require('../auth');
const { HttpError, wrap, S, int, num, json, flag, clamp, round2, shuffled, audit, notify, perUser } = require('../util');

const router = express.Router();
const authors = requireRole('creator', 'educator', 'admin');
const QTYPES = ['mcq', 'multi', 'truefalse', 'short'];
const KINDS = ['practice', 'adaptive', 'test', 'exam'];
const instant = a => a.kind === 'practice' || a.kind === 'adaptive';

/* ------------------------------------------------------------------ grading */
const normText = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.\-\/ ]/g, ' ').replace(/\s+/g, ' ').trim();

function gradeQ(row, given) {
  const ans = json(row.answer);
  if (given === undefined || given === null || given === '' || (Array.isArray(given) && !given.length)) return { answered: false, correct: false, earned: 0 };
  let correct = false, earned = 0;
  if (row.type === 'mcq') { correct = Number(given) === Number(ans); earned = correct ? row.points : 0; }
  else if (row.type === 'truefalse') { correct = (given === true || given === 'true') === ans; earned = correct ? row.points : 0; }
  else if (row.type === 'multi') {
    const want = new Set(ans.map(Number)); let right = 0, wrong = 0;
    for (const x of new Set((Array.isArray(given) ? given : []).map(Number))) want.has(x) ? right++ : wrong++;
    correct = right === want.size && wrong === 0;
    earned = row.points * Math.max(0, right - wrong) / want.size;      // partial credit, penalised for wrong picks
  } else if (row.type === 'short') {
    const g = normText(given);
    const numeric = String(given).trim() !== '' && Number.isFinite(Number(given));
    correct = (ans || []).some(a => normText(a) === g || (numeric && String(a).trim() !== '' && Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(given)) <= 1e-9 + 1e-6 * Math.abs(Number(a))));
    earned = correct ? row.points : 0;
  }
  return { answered: true, correct, earned: round2(earned) };
}

function updateMastery(userId, topic, difficulty, correct, K = 32) {
  const row = q.get('SELECT * FROM mastery WHERE user_id=? AND topic=?', userId, topic) || { rating: 500, answered: 0, correct: 0 };
  const qr = 200 + 200 * (difficulty - 1);
  const expected = 1 / (1 + Math.pow(10, (qr - row.rating) / 400));
  const rating = clamp(row.rating + K * ((correct ? 1 : 0) - expected), 100, 1000);
  q.run(`INSERT INTO mastery(user_id,topic,rating,answered,correct,updated_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(user_id,topic) DO UPDATE SET rating=excluded.rating, answered=excluded.answered, correct=excluded.correct, updated_at=excluded.updated_at`,
    userId, topic, rating, row.answered + 1, row.correct + (correct ? 1 : 0), Date.now());
}

// Adaptive engine: pick the unseen question whose difficulty best matches the learner's current topic rating (with a little variety).
function pickAdaptive(att, a) {
  const served = new Set(json(att.meta, {}).served || []);
  const pool = q.all('SELECT * FROM questions WHERE assessment_id=?', a.id).filter(r => !served.has(r.id));
  if (!pool.length) return null;
  const ratings = new Map(q.all('SELECT topic,rating FROM mastery WHERE user_id=?', att.user_id).map(r => [r.topic, r.rating]));
  const last = json(att.meta, {}).last_topic;
  let best = null, bestScore = Infinity;
  for (const r of pool) {
    const gap = Math.abs((200 + 200 * (r.difficulty - 1)) - (ratings.get(r.topic) ?? 500)) / 200;
    const score = gap + (r.topic === last ? 0.35 : 0) + Math.random() * 0.4;
    if (score < bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/* ------------------------------------------------------------------ helpers */
const sanitize = r => ({ id: r.id, type: r.type, prompt: r.prompt, options: json(r.options, null), points: r.points, topic: r.topic, difficulty: r.difficulty });
const fb = (r, given) => { const g = gradeQ(r, given); return { correct: g.correct, earned: g.earned, correct_answer: json(r.answer), explanation: r.explanation || '' }; };

function loadAssessment(id) {
  const a = q.get('SELECT * FROM assessments WHERE id=?', id);
  if (!a) throw new HttpError(404, 'Assessment not found');
  return a;
}
function canManage(user, a) {
  if (A.isAdmin(user) || a.creator_id === user.id) return true;
  if (a.classroom_id && A.isTeacherOf(user, a.classroom_id)) return true;
  if (a.course_id) { const c = q.get('SELECT creator_id FROM courses WHERE id=?', a.course_id); if (c && c.creator_id === user.id) return true; }
  return false;
}
function canTake(user, a) {
  if (!a.published) return false;
  if (a.classroom_id) return !!q.get('SELECT 1 x FROM enrollments WHERE classroom_id=? AND student_id=?', a.classroom_id, user.id);
  if (a.course_id) { const c = q.get('SELECT status FROM courses WHERE id=?', a.course_id); return !!c && c.status === 'published'; }
  return true;
}
const canReview = (user, a) => canManage(user, a) || A.isStaffRole(user);

function loadAttempt(req, { open = false } = {}) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', int(req.params.id));
  if (!att) throw new HttpError(404, 'Attempt not found');
  const a = loadAssessment(att.assessment_id);
  if (att.user_id !== req.user.id) {
    if (!(canReview(req.user, a) || A.teachesStudent(req.user, att.user_id))) throw new HttpError(403, 'This is not your attempt');
    att._viewer = 'staff';
  }
  if (open && att.status !== 'in_progress') throw new HttpError(409, 'This attempt is already submitted', 'already_submitted');
  return { att, a };
}

function orderedRows(att, a) {
  const meta = json(att.meta, {});
  const ids = (a.kind === 'adaptive' ? meta.served : meta.order) || [];
  return ids.map(id => q.get('SELECT * FROM questions WHERE id=?', id)).filter(Boolean);
}

function revealAllowed(att, a) {
  if (instant(a)) return true;
  return att.status === 'submitted' && !!a.show_answers && !['flagged'].includes(att.proctor_status);
}

function buildResult(att, a) {
  const answers = json(att.answers, {});
  const reveal = revealAllowed(att, a);
  let score = 0, max = 0;
  const topics = {};
  const items = orderedRows(att, a).map(r => {
    const given = answers[r.id] ? answers[r.id].answer : null;
    const g = gradeQ(r, given);
    score += g.earned; max += r.points;
    const t = (topics[r.topic] ||= { correct: 0, total: 0 });
    t.total++; if (g.correct) t.correct++;
    const show = reveal && (!instant(a) || g.answered);
    return { id: r.id, type: r.type, prompt: r.prompt, options: json(r.options, null), topic: r.topic, difficulty: r.difficulty, points: r.points,
      your_answer: given, answered: g.answered, correct: g.correct, earned: g.earned,
      ...(show ? { correct_answer: json(r.answer), explanation: r.explanation || '' } : {}) };
  });
  const percent = max ? round2(100 * score / max) : 0;
  return { score: round2(score), max_score: round2(max), percent, passed: percent >= a.pass_mark, topics, items, reveal };
}

function finishAttempt(att, a, by = 'student') {
  const r = buildResult({ ...att, status: 'in_progress' }, a);
  const now = Date.now();
  const passed = r.percent >= a.pass_mark ? 1 : 0;
  tx(() => {
    q.run(`UPDATE attempts SET status='submitted', submitted_at=?, score=?, max_score=?, passed=? WHERE id=? AND status='in_progress'`, now, r.score, r.max_score, passed, att.id);
    const K = instant(a) ? 24 : 16;
    if (!instant(a)) for (const it of r.items) if (it.answered) updateMastery(att.user_id, it.topic, it.difficulty, it.correct, K);
    const today = q.get(`SELECT COUNT(*) c FROM attempts WHERE user_id=? AND assessment_id=? AND status='submitted' AND submitted_at>?`, att.user_id, a.id, now - 864e5).c;
    if (!instant(a) || today <= 3) {
      const base = { practice: 5, adaptive: 8, test: 20, exam: 25 }[a.kind];
      const xp = base + Math.round(r.percent / 100 * (a.kind === 'practice' ? 10 : 30)) + (r.max_score && r.score >= r.max_score ? 25 : 0);
      G.awardXp(att.user_id, xp, `Completed ${a.kind}: ${a.title}`);
    }
    G.touch(att.user_id);
  });
  const badges = G.checkBadges(att.user_id);
  const held = att.proctor_status === 'flagged';
  notify(att.user_id, held ? 'Result held for review' : 'Result ready', held ? `${a.title}: your teacher will review proctoring flags before releasing your result.` : `${a.title}: ${r.percent}%`, '#/attempt/' + att.id);
  if (by === 'auto') audit({ ip: 'system' }, 'attempt_auto_submit', { attempt: att.id });
  return { result: r, badges };
}

function attemptPayload(att, a) {
  const answers = json(att.answers, {});
  const now = Date.now();
  const questions = orderedRows(att, a).map(r => {
    const given = answers[r.id] ? answers[r.id].answer : null;
    return { ...sanitize(r), answer: given, feedback: instant(a) && answers[r.id] ? fb(r, given) : null };
  });
  const meta = json(att.meta, {});
  return {
    attempt: { id: att.id, assessment_id: a.id, status: att.status, started_at: att.started_at, deadline: att.deadline, proctored: !!a.proctored, risk: att.risk, precheck_degraded: !!meta.precheck_degraded },
    assessment: { id: a.id, title: a.title, kind: a.kind, compulsory: !!a.compulsory, time_limit_min: a.time_limit_min, proctored: !!a.proctored, adaptive_length: a.adaptive_length, pass_mark: a.pass_mark },
    questions, server_time: now, remaining_ms: att.deadline ? Math.max(0, att.deadline - now) : null,
  };
}

function validateQuestion(b) {
  if (!QTYPES.includes(b.type)) throw new HttpError(400, 'Invalid question type');
  const prompt = S(b.prompt, 2000);
  if (prompt.length < 2) throw new HttpError(400, 'Question text is too short');
  let options = null, answer;
  if (b.type === 'mcq' || b.type === 'multi') {
    options = (Array.isArray(b.options) ? b.options : []).map(o => S(String(o), 300));
    if (options.length < 2 || options.length > 8 || options.some(o => !o)) throw new HttpError(400, 'Provide 2 to 8 non-empty answer options');
    if (b.type === 'mcq') { answer = int(b.answer); if (answer === null || answer < 0 || answer >= options.length) throw new HttpError(400, 'Mark the correct option'); }
    else {
      answer = [...new Set((Array.isArray(b.answer) ? b.answer : []).map(Number))].sort();
      if (!answer.length || answer.some(i => !Number.isInteger(i) || i < 0 || i >= options.length)) throw new HttpError(400, 'Mark at least one correct option');
    }
  } else if (b.type === 'truefalse') {
    if (typeof b.answer !== 'boolean') throw new HttpError(400, 'Choose True or False as the answer');
    answer = b.answer;
  } else {
    answer = (Array.isArray(b.answer) ? b.answer : [b.answer]).map(x => S(String(x ?? ''), 200)).filter(Boolean);
    if (!answer.length) throw new HttpError(400, 'Provide at least one accepted answer');
  }
  return { type: b.type, prompt, options: options ? JSON.stringify(options) : null, answer: JSON.stringify(answer), explanation: S(b.explanation, 2000),
    topic: S(b.topic, 80) || 'general', difficulty: clamp(int(b.difficulty, 3), 1, 5), points: clamp(num(b.points, 1), 0.5, 20) };
}

/* ------------------------------------------------------------------ authoring */
router.get('/assessments', auth, wrap(async (req, res) => {
  const u = req.user, Q = req.query;
  const where = [], p = [u.id, u.id, u.id];
  if (Q.mine === '1') { where.push('(a.creator_id=? OR a.classroom_id IN (SELECT id FROM classrooms WHERE teacher_id=?) OR a.course_id IN (SELECT id FROM courses WHERE creator_id=?))'); p.push(u.id, u.id, u.id); }
  else if (Q.course_id) { where.push(`a.course_id=? AND a.classroom_id IS NULL AND (a.published=1 OR a.creator_id=? OR a.course_id IN (SELECT id FROM courses WHERE creator_id=?))`); p.push(int(Q.course_id), u.id, u.id); }
  else if (Q.classroom_id) { where.push('a.classroom_id=?'); p.push(int(Q.classroom_id)); if (!A.classroomAccess(u, int(Q.classroom_id))) throw new HttpError(403, 'No access to this class'); where.push('(a.published=1 OR a.creator_id=?)'); p.push(u.id); }
  else {
    where.push(`a.published=1 AND (a.classroom_id IN (SELECT classroom_id FROM enrollments WHERE student_id=?) OR (a.classroom_id IS NULL AND a.course_id IN (SELECT course_id FROM course_enrollments WHERE user_id=?)))`);
    p.push(u.id, u.id);
  }
  const rows = q.all(`SELECT a.id,a.title,a.description,a.kind,a.compulsory,a.time_limit_min,a.proctored,a.pass_mark,a.max_attempts,a.opens_at,a.closes_at,a.published,a.course_id,a.classroom_id,a.creator_id,
      (SELECT COUNT(*) FROM questions WHERE assessment_id=a.id) question_count,
      (SELECT COUNT(*) FROM attempts t WHERE t.assessment_id=a.id AND t.user_id=? AND t.status!='in_progress') attempts_used,
      (SELECT id FROM attempts t WHERE t.assessment_id=a.id AND t.user_id=? AND t.status='in_progress' ORDER BY id DESC LIMIT 1) open_attempt,
      (SELECT MAX(100.0*score/max_score) FROM attempts t WHERE t.assessment_id=a.id AND t.user_id=? AND t.status='submitted' AND max_score>0) best_percent,
      c.title course_title, cl.name classroom_name
    FROM assessments a LEFT JOIN courses c ON c.id=a.course_id LEFT JOIN classrooms cl ON cl.id=a.classroom_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 200`, ...p);
  res.json({ assessments: rows.map(r => ({ ...r, best_percent: r.best_percent === null ? null : Math.round(r.best_percent) })) });
}));

router.get('/assessments/:id', auth, wrap(async (req, res) => {
  const a = loadAssessment(int(req.params.id));
  const manage = canManage(req.user, a);
  if (!manage && !canTake(req.user, a) && !A.isStaffRole(req.user)) throw new HttpError(404, 'Assessment not found');
  const out = { assessment: a, can_manage: manage, question_count: q.get('SELECT COUNT(*) c FROM questions WHERE assessment_id=?', a.id).c };
  if (manage) out.questions = q.all('SELECT * FROM questions WHERE assessment_id=? ORDER BY position,id', a.id).map(r => ({ ...r, options: json(r.options, null), answer: json(r.answer) }));
  out.my_attempts = q.all('SELECT id,status,score,max_score,passed,submitted_at,proctor_status FROM attempts WHERE assessment_id=? AND user_id=? ORDER BY id DESC', a.id, req.user.id);
  if (a.course_id) out.course = q.get('SELECT id,title FROM courses WHERE id=?', a.course_id);
  if (a.proctored) out.proctor_ready = { face_enrolled: !!req.user.face_enc, consent: !!req.user.consent_biometric, guardian_ok: !(ageOf(req.user) !== null && ageOf(req.user) < 18) || !!req.user.guardian_consent };
  res.json(out);
}));

function assessmentFields(b, existing) {
  const f = {};
  const kind = b.kind !== undefined ? b.kind : (existing ? existing.kind : 'practice');
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Invalid assessment type');
  f.kind = kind;
  if (b.title !== undefined || !existing) { f.title = S(b.title, 150); if (f.title.length < 3) throw new HttpError(400, 'Title must be at least 3 characters'); }
  if (b.description !== undefined) f.description = S(b.description, 1000);
  if (b.compulsory !== undefined) f.compulsory = flag(b.compulsory);
  if (b.proctored !== undefined) f.proctored = flag(b.proctored);
  if (instant({ kind })) { f.proctored = 0; f.compulsory = 0; }
  if (b.time_limit_min !== undefined) f.time_limit_min = b.time_limit_min ? clamp(int(b.time_limit_min, 30), 1, 360) : null;
  if (b.pass_mark !== undefined) f.pass_mark = clamp(int(b.pass_mark, 50), 0, 100);
  if (b.shuffle !== undefined) f.shuffle = flag(b.shuffle);
  if (b.max_attempts !== undefined) f.max_attempts = clamp(int(b.max_attempts, 0), 0, 20);
  if (b.show_answers !== undefined) f.show_answers = flag(b.show_answers);
  if (b.adaptive_length !== undefined) f.adaptive_length = clamp(int(b.adaptive_length, 10), 3, 50);
  if (b.opens_at !== undefined) f.opens_at = b.opens_at ? int(b.opens_at) : null;
  if (b.closes_at !== undefined) f.closes_at = b.closes_at ? int(b.closes_at) : null;
  if (f.opens_at && f.closes_at && f.closes_at <= f.opens_at) throw new HttpError(400, 'Closing time must be after opening time');
  return f;
}

router.post('/assessments', auth, authors, wrap(async (req, res) => {
  const b = req.body || {};
  const f = assessmentFields(b, null);
  let courseId = null, classroomId = null;
  if (b.course_id) {
    const c = q.get('SELECT * FROM courses WHERE id=?', int(b.course_id));
    if (!c || !A.ownsCourse(req.user, c)) throw new HttpError(403, 'You can only add assessments to your own courses');
    courseId = c.id;
  }
  if (b.classroom_id) {
    if (!A.isTeacherOf(req.user, int(b.classroom_id))) throw new HttpError(403, 'You can only assign assessments to your own classes');
    classroomId = int(b.classroom_id);
  }
  const id = q.run(`INSERT INTO assessments(course_id,classroom_id,creator_id,title,description,kind,compulsory,time_limit_min,proctored,pass_mark,shuffle,max_attempts,show_answers,adaptive_length,opens_at,closes_at,published,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    courseId, classroomId, req.user.id, f.title, f.description || '', f.kind, f.compulsory || 0, f.time_limit_min ?? null, f.proctored || 0, f.pass_mark ?? 50, f.shuffle ?? 1, f.max_attempts ?? 0,
    f.show_answers ?? (f.kind === 'exam' ? 0 : 1), f.adaptive_length ?? 10, f.opens_at ?? null, f.closes_at ?? null, Date.now()).id;
  audit(req, 'assessment_create', { id });
  res.status(201).json({ assessment: q.get('SELECT * FROM assessments WHERE id=?', id) });
}));

router.put('/assessments/:id', auth, authors, wrap(async (req, res) => {
  const a = loadAssessment(int(req.params.id));
  if (!canManage(req.user, a)) throw new HttpError(403, 'Only the owner can change this assessment');
  const b = req.body || {};
  const f = assessmentFields(b, a);
  if (b.published !== undefined) {
    const pub = flag(b.published);
    if (pub) {
      const n = q.get('SELECT COUNT(*) c FROM questions WHERE assessment_id=?', a.id).c;
      if (!n) throw new HttpError(400, 'Add at least one question before publishing');
      if ((f.kind || a.kind) === 'adaptive' && n < Math.min(5, f.adaptive_length || a.adaptive_length)) throw new HttpError(400, 'Adaptive quizzes need a larger question bank (at least 5 questions)');
    }
    f.published = pub;
  }
  const keys = Object.keys(f);
  if (keys.length) q.run(`UPDATE assessments SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => f[k]), a.id);
  if (f.published && !a.published && a.classroom_id) {
    for (const s of q.all('SELECT student_id FROM enrollments WHERE classroom_id=?', a.classroom_id))
      notify(s.student_id, `New ${f.kind || a.kind}: ${a.title}`, a.closes_at ? 'Due ' + new Date(a.closes_at).toLocaleString() : 'Open now', '#/assessments/' + a.id);
  }
  res.json({ assessment: q.get('SELECT * FROM assessments WHERE id=?', a.id) });
}));

router.delete('/assessments/:id', auth, authors, wrap(async (req, res) => {
  const a = loadAssessment(int(req.params.id));
  if (!canManage(req.user, a)) throw new HttpError(403, 'Only the owner can delete this assessment');
  if (q.get(`SELECT 1 x FROM attempts WHERE assessment_id=? AND status='submitted'`, a.id) && !A.isAdmin(req.user)) throw new HttpError(400, 'Learners have already submitted this. Unpublish it instead.');
  q.run('DELETE FROM assessments WHERE id=?', a.id);
  res.json({ ok: true });
}));

router.post('/assessments/:id/questions', auth, authors, wrap(async (req, res) => {
  const a = loadAssessment(int(req.params.id));
  if (!canManage(req.user, a)) throw new HttpError(403, 'Only the owner can edit questions');
  const list = Array.isArray(req.body && req.body.questions) ? req.body.questions.slice(0, 100) : [];
  if (!list.length) throw new HttpError(400, 'Send at least one question');
  const clean = list.map(validateQuestion);
  let pos = q.get('SELECT IFNULL(MAX(position),0) n FROM questions WHERE assessment_id=?', a.id).n;
  const ids = tx(() => clean.map(d => q.run('INSERT INTO questions(assessment_id,position,type,prompt,options,answer,explanation,topic,difficulty,points) VALUES(?,?,?,?,?,?,?,?,?,?)',
    a.id, ++pos, d.type, d.prompt, d.options, d.answer, d.explanation, d.topic, d.difficulty, d.points).id));
  res.status(201).json({ ids });
}));

function ownQuestion(req) {
  const row = q.get('SELECT * FROM questions WHERE id=?', int(req.params.id));
  if (!row) throw new HttpError(404, 'Question not found');
  const a = loadAssessment(row.assessment_id);
  if (!canManage(req.user, a)) throw new HttpError(403, 'Only the owner can edit questions');
  if (q.get(`SELECT 1 x FROM attempts WHERE assessment_id=? AND status='submitted'`, a.id)) throw new HttpError(400, 'Learners have already submitted answers, so questions are locked. Create a new version instead.');
  return row;
}
router.put('/questions/:id', auth, authors, wrap(async (req, res) => {
  const row = ownQuestion(req);
  const d = validateQuestion({ ...row, options: json(row.options), answer: json(row.answer), ...(req.body || {}) });
  q.run('UPDATE questions SET type=?,prompt=?,options=?,answer=?,explanation=?,topic=?,difficulty=?,points=? WHERE id=?', d.type, d.prompt, d.options, d.answer, d.explanation, d.topic, d.difficulty, d.points, row.id);
  res.json({ ok: true });
}));
router.delete('/questions/:id', auth, authors, wrap(async (req, res) => {
  const row = ownQuestion(req);
  q.run('DELETE FROM questions WHERE id=?', row.id);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ taking */
router.post('/assessments/:id/start', auth, perUser({ windowMs: 60e3, max: 20 }), wrap(async (req, res) => {
  const u = req.user, a = loadAssessment(int(req.params.id));
  if (!canTake(u, a)) throw new HttpError(404, 'Assessment not found');
  const now = Date.now();
  if (a.opens_at && now < a.opens_at) throw new HttpError(403, 'This assessment has not opened yet', 'not_open');
  if (a.closes_at && now > a.closes_at) throw new HttpError(403, 'This assessment is closed', 'closed');
  const nq = q.get('SELECT COUNT(*) c FROM questions WHERE assessment_id=?', a.id).c;
  if (!nq) throw new HttpError(400, 'This assessment has no questions yet');

  const open = q.get(`SELECT * FROM attempts WHERE assessment_id=? AND user_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1`, a.id, u.id);
  if (open) {
    if (open.deadline && now > open.deadline + 30000) finishAttempt(open, a, 'auto');
    else return res.json(attemptPayload(open, a));
  }
  const used = q.get(`SELECT COUNT(*) c FROM attempts WHERE assessment_id=? AND user_id=? AND status!='in_progress'`, a.id, u.id).c;
  if (a.max_attempts > 0 && used >= a.max_attempts) throw new HttpError(403, `You have used all ${a.max_attempts} attempt(s)`, 'no_attempts_left');

  let precheck = null;
  if (a.proctored) {
    const age = ageOf(u);
    if (!u.face_enc || !u.consent_biometric) throw new HttpError(403, 'Enroll your face in Settings before taking a proctored exam', 'face_required');
    if (age !== null && age < 18 && !u.guardian_consent) throw new HttpError(403, 'Your teacher must confirm parental consent before proctored exams', 'guardian_consent_required');
    const tok = C.verify((req.body && req.body.precheck_token) || '');
    if (!tok || tok.typ !== 'precheck' || tok.uid !== u.id || tok.aid !== a.id) throw new HttpError(403, 'Complete the pre-exam check first', 'precheck_required');
    precheck = q.get('SELECT * FROM precheck_sessions WHERE id=?', tok.pid);
    if (!precheck || !precheck.passed || precheck.used || precheck.user_id !== u.id) throw new HttpError(403, 'Pre-exam check expired. Please repeat it.', 'precheck_required');
  }

  const seed = (u.id * 7919 + now) >>> 0;
  const meta = { proctored: !!a.proctored, precheck_degraded: !!(precheck && precheck.degraded) };
  if (a.kind === 'adaptive') meta.length = Math.min(a.adaptive_length, nq);
  let deadline = a.time_limit_min ? now + a.time_limit_min * 60000 : null;
  if (a.closes_at && deadline) deadline = Math.min(deadline, a.closes_at); else if (a.closes_at && !deadline && a.kind !== 'practice') deadline = a.closes_at;
  const attId = tx(() => {
    if (precheck) q.run('UPDATE precheck_sessions SET used=1 WHERE id=?', precheck.id);
    const id = q.run('INSERT INTO attempts(assessment_id,user_id,started_at,deadline,status,meta,last_heartbeat,precheck_id,proctor_status) VALUES(?,?,?,?,?,?,?,?,?)',
      a.id, u.id, now, deadline, 'in_progress', '{}', now, precheck ? precheck.id : null, a.proctored ? 'clear' : 'none').id;
    const att = q.get('SELECT * FROM attempts WHERE id=?', id);
    if (a.kind === 'adaptive') {
      meta.served = [];
      const first = pickAdaptive({ ...att, meta: JSON.stringify(meta) }, a);
      meta.served.push(first.id); meta.last_topic = first.topic;
    } else {
      const ids = q.all('SELECT id FROM questions WHERE assessment_id=? ORDER BY position,id', a.id).map(r => r.id);
      meta.order = a.shuffle ? shuffled(ids, seed) : ids;
    }
    q.run('UPDATE attempts SET meta=? WHERE id=?', JSON.stringify(meta), id);
    return id;
  });
  G.touch(u.id);
  audit(req, 'attempt_start', { attempt: attId, assessment: a.id });
  res.status(201).json(attemptPayload(q.get('SELECT * FROM attempts WHERE id=?', attId), a));
}));

router.get('/attempts', auth, wrap(async (req, res) => {
  const rows = q.all(`SELECT t.id,t.assessment_id,t.started_at,t.submitted_at,t.status,t.score,t.max_score,t.passed,t.proctor_status,a.title,a.kind
    FROM attempts t JOIN assessments a ON a.id=t.assessment_id WHERE t.user_id=? ORDER BY t.id DESC LIMIT 100`, req.user.id);
  res.json({ attempts: rows.map(r => ({ ...r, percent: r.max_score ? Math.round(100 * r.score / r.max_score) : null, score: r.proctor_status === 'flagged' ? null : r.score })) });
}));

router.get('/attempts/:id', auth, wrap(async (req, res) => {
  const { att, a } = loadAttempt(req);
  if (att.status === 'in_progress' && att.deadline && Date.now() > att.deadline + 30000) { finishAttempt(att, a, 'auto'); return res.json({ expired: true }); }
  res.json(attemptPayload(att, a));
}));

router.post('/attempts/:id/heartbeat', auth, wrap(async (req, res) => {
  const { att, a } = loadAttempt(req, { open: true });
  // For proctored exams only the camera-monitoring channel counts as a heartbeat, otherwise a cheater could kill the camera and keep pinging.
  if (!a.proctored) q.run('UPDATE attempts SET last_heartbeat=? WHERE id=?', Date.now(), att.id);
  res.json({ ok: true, remaining_ms: att.deadline ? Math.max(0, att.deadline - Date.now()) : null });
}));

function normaliseGiven(row, v) {
  if (row.type === 'mcq') { const n = int(v); const o = json(row.options, []); if (n === null || n < 0 || n >= o.length) throw new HttpError(400, 'Invalid option'); return n; }
  if (row.type === 'multi') { const o = json(row.options, []); const arr = [...new Set((Array.isArray(v) ? v : []).map(Number))]; if (arr.some(n => !Number.isInteger(n) || n < 0 || n >= o.length)) throw new HttpError(400, 'Invalid option'); return arr.sort(); }
  if (row.type === 'truefalse') return v === true || v === 'true';
  return S(String(v ?? ''), 200);
}

router.post('/attempts/:id/answer', auth, wrap(async (req, res) => {
  const { att, a } = loadAttempt(req, { open: true });
  if (att._viewer) throw new HttpError(403, 'Not your attempt');
  const now = Date.now();
  if (att.deadline && now > att.deadline + 5000) throw new HttpError(409, 'Time is up', 'time_up');
  const qid = int(req.body && req.body.question_id);
  const meta = json(att.meta, {});
  const ids = (a.kind === 'adaptive' ? meta.served : meta.order) || [];
  if (!ids.includes(qid)) throw new HttpError(400, 'That question is not part of this attempt');
  const row = q.get('SELECT * FROM questions WHERE id=?', qid);
  const answers = json(att.answers, {});
  if (a.kind === 'adaptive' && answers[qid]) throw new HttpError(409, 'Already answered', 'already_answered');
  const given = normaliseGiven(row, req.body.answer);
  answers[qid] = { answer: given, ts: now };
  const out = { saved: true };
  if (instant(a)) {
    Object.assign(out, fb(row, given));
    updateMastery(att.user_id, row.topic, row.difficulty, out.correct, 24);
  }
  if (a.kind === 'adaptive') {
    if (meta.served.length >= meta.length) out.done = true;
    else {
      const next = pickAdaptive({ ...att, meta: JSON.stringify(meta) }, a);
      if (!next) out.done = true; else { meta.served.push(next.id); meta.last_topic = next.topic; out.next = sanitize(next); }
    }
  }
  q.run(a.proctored ? 'UPDATE attempts SET answers=?, meta=? WHERE id=?' : 'UPDATE attempts SET answers=?, meta=?, last_heartbeat=? WHERE id=?', ...(a.proctored ? [JSON.stringify(answers), JSON.stringify(meta), att.id] : [JSON.stringify(answers), JSON.stringify(meta), now, att.id]));
  res.json(out);
}));

router.post('/attempts/:id/submit', auth, wrap(async (req, res) => {
  const { att, a } = loadAttempt(req);
  if (att._viewer) throw new HttpError(403, 'Not your attempt');
  if (att.status !== 'in_progress') return res.json({ already: true });
  const now = Date.now();
  const pastDeadline = att.deadline && now > att.deadline;
  if (a.compulsory && !pastDeadline) {
    const answers = json(att.answers, {});
    const missing = orderedRows(att, a).filter(r => !gradeQ(r, answers[r.id] && answers[r.id].answer).answered).map(r => r.id);
    if (missing.length) throw new HttpError(400, `This is a compulsory test: answer every question before submitting (${missing.length} left).`, 'compulsory_incomplete', { missing });
  }
  const { badges } = finishAttempt(att, a);
  const fresh = q.get('SELECT * FROM attempts WHERE id=?', att.id);
  res.json({ submitted: true, held: fresh.proctor_status === 'flagged', badges, ...resultView(fresh, a) });
}));

function resultView(att, a) {
  if (att.proctor_status === 'flagged' && att.status === 'submitted') return { pending_review: true, message: 'Your teacher will review automatic proctoring flags before your result is released. You can add a note to your appeal if something looked wrong.' };
  if (att.status === 'voided') return { voided: true, message: 'This attempt was invalidated after teacher review. Ask your teacher about a retake.' };
  const r = buildResult(att, a);
  return { result: r };
}

router.get('/attempts/:id/result', auth, wrap(async (req, res) => {
  const { att, a } = loadAttempt(req);
  if (att.status === 'in_progress') {
    if (!instant(a)) throw new HttpError(409, 'Submit the attempt to see the result', 'in_progress');
  }
  const base = { attempt: { id: att.id, status: att.status, submitted_at: att.submitted_at, proctor_status: att.proctor_status, risk: att._viewer ? att.risk : undefined }, assessment: { id: a.id, title: a.title, kind: a.kind, pass_mark: a.pass_mark, proctored: !!a.proctored } };
  res.json({ ...base, ...(att._viewer ? { result: buildResult(att, a) } : resultView(att, a)) });
}));

/* ------------------------------------------------------------------ AI feedback chat */
router.get('/attempts/:id/feedback', auth, wrap(async (req, res) => {
  const { att } = loadAttempt(req);
  res.json({ messages: q.all('SELECT id,role,content,created_at FROM ai_chats WHERE attempt_id=? AND user_id=? ORDER BY id', att.id, att.user_id) });
}));

router.post('/attempts/:id/feedback', auth, perUser({ windowMs: 10 * 60e3, max: 30, message: 'You are chatting very fast. Take a breath and try again in a moment.' }), wrap(async (req, res) => {
  const { att, a } = loadAttempt(req);
  if (att._viewer) throw new HttpError(403, 'Not your attempt');
  if (att.status === 'in_progress' && !instant(a)) throw new HttpError(403, 'Feedback opens after you submit this test.', 'feedback_locked');
  if (att.status === 'voided' || att.proctor_status === 'flagged') throw new HttpError(403, 'Feedback is paused while your teacher reviews this attempt.', 'feedback_locked');
  const message = S(req.body && req.body.message, 500);
  if (!message) throw new HttpError(400, 'Type a question');
  const mod = M.check(message, { minor: !!(ageOf(req.user) !== null && ageOf(req.user) < 18), allowLinks: false });
  q.run('INSERT INTO ai_chats(attempt_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)', att.id, att.user_id, 'user', mod.text || message, Date.now());
  let text, source = 'safety';
  if (mod.welfare) {
    text = `I'm really glad you told me, ${req.user.name.split(' ')[0]}. ${mod.welfareNote} I'm just a study helper, so please speak to someone you trust today. Your teacher has been quietly notified so a real person can check in.`;
    q.run('INSERT INTO reports(reporter_id,target_type,target_id,reason,priority,created_at) VALUES(?,?,?,?,3,?)', null, 'user', att.user_id, 'Welfare concern detected in AI feedback chat', Date.now());
    for (const t of q.all('SELECT DISTINCT c.teacher_id id FROM enrollments e JOIN classrooms c ON c.id=e.classroom_id WHERE e.student_id=?', att.user_id)) notify(t.id, 'Student welfare check needed', `${req.user.name} may need support. Please check in privately.`, '#/classes');
  } else if (mod.blocked) {
    text = 'Let\'s keep our chat kind and focused on learning. Ask me about a question number, like "explain question 2".';
  } else {
    const history = q.all('SELECT role,content FROM ai_chats WHERE attempt_id=? AND user_id=? ORDER BY id DESC LIMIT 12', att.id, att.user_id).reverse().slice(0, -1);
    const r = buildResult(att, a);
    const out = await AI.reply({ user: req.user, assessment: a, result: r, history, message: mod.text, reveal: r.reveal });
    text = out.text; source = out.source;
  }
  q.run('INSERT INTO ai_chats(attempt_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)', att.id, att.user_id, 'assistant', text, Date.now());
  res.json({ reply: text, source });
}));

/* ------------------------------------------------------------------ teacher results */
router.get('/assessments/:id/results', auth, wrap(async (req, res) => {
  const a = loadAssessment(int(req.params.id));
  if (!canReview(req.user, a)) throw new HttpError(403, 'Only the owner or class teacher can see results');
  const rows = q.all(`SELECT t.id,t.user_id,u.name,t.status,t.score,t.max_score,t.passed,t.risk,t.proctor_status,t.submitted_at,t.started_at
     FROM attempts t JOIN users u ON u.id=t.user_id WHERE t.assessment_id=? AND t.status!='in_progress' ORDER BY t.submitted_at DESC`, a.id);
  const qs = q.all('SELECT * FROM questions WHERE assessment_id=? ORDER BY position,id', a.id);
  const sub = q.all(`SELECT answers FROM attempts WHERE assessment_id=? AND status='submitted'`, a.id).map(r => json(r.answers, {}));
  const qstats = qs.map(r => {
    let n = 0, ok = 0;
    for (const ans of sub) if (ans[r.id]) { n++; if (gradeQ(r, ans[r.id].answer).correct) ok++; }
    return { id: r.id, prompt: r.prompt, topic: r.topic, difficulty: r.difficulty, answered: n, percent_correct: n ? Math.round(100 * ok / n) : null };
  });
  const done = rows.filter(r => r.status === 'submitted' && r.max_score);
  const avg = done.length ? Math.round(done.reduce((s, r) => s + 100 * r.score / r.max_score, 0) / done.length) : null;
  let missing = [];
  if (a.classroom_id) missing = q.all(`SELECT u.id,u.name FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.classroom_id=?
      AND NOT EXISTS(SELECT 1 FROM attempts t WHERE t.assessment_id=? AND t.user_id=u.id AND t.status='submitted') ORDER BY u.name`, a.classroom_id, a.id);
  res.json({ assessment: { id: a.id, title: a.title, kind: a.kind, pass_mark: a.pass_mark, proctored: !!a.proctored }, attempts: rows.map(r => ({ ...r, percent: r.max_score ? Math.round(100 * r.score / r.max_score) : null })),
    question_stats: qstats, average_percent: avg, pass_rate: done.length ? Math.round(100 * done.filter(r => r.passed).length / done.length) : null, not_submitted: missing });
}));

function autoSubmitExpired() {
  const rows = q.all(`SELECT * FROM attempts WHERE status='in_progress' AND deadline IS NOT NULL AND deadline < ?`, Date.now() - 60000);
  for (const att of rows) { try { finishAttempt(att, loadAssessment(att.assessment_id), 'auto'); } catch (e) { console.warn('[auto-submit]', e.message); } }
  return rows.length;
}

module.exports = router;
module.exports.autoSubmitExpired = autoSubmitExpired;
module.exports.gradeQ = gradeQ;
module.exports.canManage = canManage;
module.exports.canReview = canReview;
