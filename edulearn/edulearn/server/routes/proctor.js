'use strict';
// Proctoring service: pre-exam environment check, continuous event ingestion, risk scoring, and human review/appeals.
// Design principle: the system FLAGS, humans DECIDE. Nothing here ever voids an attempt automatically.
const express = require('express');
const { q } = require('../db');
const C = require('../crypto');
const cfg = require('../config');
const face = require('../face');
const A = require('../access');
const { ageOf, auth } = require('../auth');
const { HttpError, wrap, S, int, num, json, clamp, audit, notify, perUser } = require('../util');
const { canReview, canManage } = require('./assess');

const router = express.Router();

const WEIGHT = {
  face_missing: 5, multiple_faces: 20, face_mismatch: 25, object_detected: 12, phone_detected: 30,
  tab_hidden: 10, window_blur: 4, fullscreen_exit: 8, copy_paste: 6, excessive_motion: 4,
  monitoring_lost: 15, camera_stopped: 30, devtools: 12, looking_away: 3,
};
const CAP = { window_blur: 8, excessive_motion: 6, looking_away: 8, face_missing: 8 };
const BANNED = ['cell phone', 'book', 'laptop', 'remote', 'tv', 'tablet'];
const NOTICE = {
  multiple_faces: 'Another face was detected. You must be alone for this exam.',
  face_missing: 'We cannot see your face. Please stay in view of the camera.',
  face_mismatch: 'The person on camera does not match the registered learner.',
  phone_detected: 'A phone was detected. Please put it out of reach.',
  object_detected: 'An unauthorised object was detected in view.',
  tab_hidden: 'Please stay on the exam page.', fullscreen_exit: 'Please return to full-screen mode.',
  camera_stopped: 'Your camera stopped. Turn it back on right away.',
};
const THRESHOLDS = { handsMinMotion: 0.012, panMinScore: 0.035, panMinSeconds: 6, minSamples: 12, banned: BANNED };

const statusFor = risk => (risk >= 60 ? 'flagged' : risk >= 25 ? 'review' : 'clear');

function recompute(attemptId) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', attemptId);
  const rows = q.all('SELECT kind, COUNT(*) n FROM proctor_events WHERE attempt_id=? GROUP BY kind', attemptId);
  const risk = Math.min(100, rows.reduce((s, r) => s + (WEIGHT[r.kind] || 0) * Math.min(r.n, CAP[r.kind] || 5), 0));
  // A teacher's decision is final; never overwrite it.
  const decided = ['cleared', 'voided'].includes(att.proctor_status);
  q.run('UPDATE attempts SET risk=?, proctor_status=? WHERE id=?', risk, decided ? att.proctor_status : statusFor(risk), attemptId);
  return { risk, status: decided ? att.proctor_status : statusFor(risk) };
}

function storeSnapshot(ownerType, ownerId, label, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length > 160000) return null;
  return q.run('INSERT INTO snapshots(owner_type,owner_id,label,data_enc,created_at) VALUES(?,?,?,?,?)', ownerType, ownerId, S(label, 40), C.encrypt(dataUrl), Date.now()).id;
}

function eligible(u) {
  const age = ageOf(u);
  if (!u.face_enc || !u.consent_biometric) throw new HttpError(403, 'Enroll your face in Settings first', 'face_required');
  if (age !== null && age < 18 && !u.guardian_consent) throw new HttpError(403, 'Your teacher must confirm parental consent before proctored exams', 'guardian_consent_required');
}

/* ------------------------------------------------------------ pre-exam checks */
router.post('/proctor/precheck/start', auth, perUser({ windowMs: 60e3, max: 10 }), wrap(async (req, res) => {
  const a = q.get('SELECT * FROM assessments WHERE id=?', int(req.body && req.body.assessment_id));
  if (!a || !a.proctored || !a.published) throw new HttpError(404, 'Proctored assessment not found');
  eligible(req.user);
  const now = Date.now();
  const id = q.run('INSERT INTO precheck_sessions(user_id,assessment_id,nonce,created_at,expires_at) VALUES(?,?,?,?,?)', req.user.id, a.id, C.randomHex(12), now, now + 20 * 60e3).id;
  const s = q.get('SELECT * FROM precheck_sessions WHERE id=?', id);
  res.status(201).json({ id, nonce: s.nonce, steps: ['face', 'hands', 'surroundings'], thresholds: { ...THRESHOLDS, face: cfg.FACE_MATCH_THRESHOLD }, expires_at: s.expires_at });
}));

router.post('/proctor/precheck/:id/step', auth, perUser({ windowMs: 60e3, max: 40 }), wrap(async (req, res) => {
  const s = q.get('SELECT * FROM precheck_sessions WHERE id=? AND user_id=?', int(req.params.id), req.user.id);
  if (!s || s.expires_at < Date.now() || s.used) throw new HttpError(410, 'This pre-exam check expired. Start again.', 'expired');
  const b = req.body || {}; const d = b.data || {};
  if (b.nonce !== s.nonce) throw new HttpError(400, 'Session mismatch. Start the check again.');
  if (s.tries >= 40) throw new HttpError(429, 'Too many attempts. Ask your teacher for help.');
  const steps = json(s.steps, {});
  let ok = false, reason = '', extra = {}, degraded = false;

  if (b.step === 'face') {
    if (!face.valid(d.descriptor)) reason = 'We could not see a clear face. Move closer and face the camera.';
    else if (!d.liveness || d.liveness.passed !== true) reason = 'Liveness check was not completed. Follow the on-screen head-turn prompts.';
    else if (Number(d.faces) !== 1) reason = 'Exactly one person must be visible.';
    else {
      const dist = face.distance(face.open(req.user.face_enc), d.descriptor);
      extra.distance = +dist.toFixed(3);
      ok = dist <= cfg.FACE_MATCH_THRESHOLD;
      if (!ok) reason = 'Your face does not match the registered learner for this account.';
    }
  } else if (b.step === 'hands') {
    const l = num(d.left, 0), r = num(d.right, 0), n = num(d.samples, 0);
    extra = { left: l, right: r };
    if (d.faceVisible !== true || Number(d.faces) !== 1) reason = 'Keep your face in view while showing your arms.';
    else if (n < THRESHOLDS.minSamples) reason = 'The check was too short. Try again.';
    else if (l < THRESHOLDS.handsMinMotion) reason = 'We did not see your left arm move. Raise and wave your left arm in front of the camera.';
    else if (r < THRESHOLDS.handsMinMotion) reason = 'We did not see your right arm move. Raise and wave your right arm in front of the camera.';
    else ok = true;
  } else if (b.step === 'surroundings') {
    const pan = num(d.panScore, 0), secs = num(d.seconds, 0), n = num(d.samples, 0);
    const objects = (Array.isArray(d.objects) ? d.objects : []).map(o => S(String(o), 40).toLowerCase());
    const bad = [...new Set(objects.filter(o => BANNED.includes(o)))];
    extra = { panScore: pan, objects: [...new Set(objects)].slice(0, 12), model: !!d.model };
    degraded = !d.model;
    if (secs < THRESHOLDS.panMinSeconds || n < THRESHOLDS.minSamples) reason = 'Take at least 6 seconds to slowly show your desk and the room around you.';
    else if (pan < THRESHOLDS.panMinScore) reason = 'We did not detect enough movement. Slowly turn your camera (or laptop) left, right and across your desk.';
    else if (num(d.maxFaces, 1) > 1 || objects.filter(o => o === 'person').length > 1) reason = 'Another person was detected in the room. You must be alone.';
    else if (bad.length) reason = `Please remove: ${bad.join(', ')}.`;
    else ok = true;
  } else throw new HttpError(400, 'Unknown step');

  steps[b.step] = { ok, at: Date.now(), ...extra, reason: ok ? '' : reason };
  const snapId = ok || b.snapshot ? storeSnapshot('precheck', s.id, b.step + (ok ? '' : '-fail'), b.snapshot) : null;
  if (snapId) steps[b.step].snapshot_id = snapId;
  const passed = ['face', 'hands', 'surroundings'].every(k => steps[k] && steps[k].ok) ? 1 : 0;
  q.run('UPDATE precheck_sessions SET steps=?, tries=tries+1, passed=?, degraded=? WHERE id=?', JSON.stringify(steps), passed, degraded || s.degraded ? 1 : 0, s.id);
  audit(req, 'precheck_step', { session: s.id, step: b.step, ok });
  const out = { ok, reason, step: b.step, passed: !!passed, degraded };
  if (passed) out.token = C.sign({ typ: 'precheck', uid: req.user.id, aid: s.assessment_id, pid: s.id }, 15 * 60e3);
  res.json(out);
}));

/* ------------------------------------------------------------ continuous monitoring */
router.post('/proctor/events', auth, perUser({ windowMs: 60e3, max: 120 }), express.json({ limit: '3mb' }), wrap(async (req, res) => {
  const att = q.get('SELECT * FROM attempts WHERE id=? AND user_id=?', int(req.body && req.body.attempt_id), req.user.id);
  if (!att || att.status !== 'in_progress') throw new HttpError(409, 'No active attempt', 'inactive');
  const a = q.get('SELECT proctored FROM assessments WHERE id=?', att.assessment_id);
  if (!a.proctored) throw new HttpError(400, 'This attempt is not proctored');
  const now = Date.now();
  // Gap in client heartbeats means monitoring was lost (tab frozen, camera blocked, network cut).
  if (att.last_heartbeat && now - att.last_heartbeat > 60000) q.run('INSERT INTO proctor_events(attempt_id,user_id,kind,severity,detail,created_at) VALUES(?,?,?,?,?,?)', att.id, att.user_id, 'monitoring_lost', WEIGHT.monitoring_lost, JSON.stringify({ gap_s: Math.round((now - att.last_heartbeat) / 1000) }), now);
  const list = (Array.isArray(req.body.events) ? req.body.events : []).slice(0, 20);
  // Identity re-check happens HERE, against the encrypted template, so a modified client cannot declare itself a match.
  if (req.user.face_enc && face.valid(req.body.descriptor)) {
    const dist = face.distance(face.open(req.user.face_enc), req.body.descriptor);
    if (dist > cfg.FACE_MATCH_THRESHOLD + 0.07) list.push({ kind: 'face_mismatch', detail: { distance: +dist.toFixed(3) }, snapshot: req.body.snapshot });
  }
  let notice = '', snaps = q.get(`SELECT COUNT(*) c FROM snapshots WHERE owner_type='attempt' AND owner_id=?`, att.id).c;
  for (const e of list) {
    const kind = S(e.kind, 40);
    if (!(kind in WEIGHT)) continue;
    q.run('INSERT INTO proctor_events(attempt_id,user_id,kind,severity,detail,created_at) VALUES(?,?,?,?,?,?)', att.id, att.user_id, kind, WEIGHT[kind], JSON.stringify(e.detail || {}).slice(0, 500), now);
    if (e.snapshot && WEIGHT[kind] >= 12 && snaps < 30 && storeSnapshot('attempt', att.id, kind, e.snapshot)) snaps++;
    if (NOTICE[kind]) notice = NOTICE[kind];
  }
  q.run('UPDATE attempts SET last_heartbeat=? WHERE id=?', now, att.id);
  const r = recompute(att.id);
  res.json({ ...r, notice });
}));

/* ------------------------------------------------------------ review (teacher / moderator) */
function reviewable(req) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', int(req.params.id));
  if (!att) throw new HttpError(404, 'Attempt not found');
  const a = q.get('SELECT * FROM assessments WHERE id=?', att.assessment_id);
  const staff = canReview(req.user, a) || A.teachesStudent(req.user, att.user_id);
  if (!staff && att.user_id !== req.user.id) throw new HttpError(403, 'No access');
  return { att, a, staff };
}

router.get('/proctor/queue', auth, wrap(async (req, res) => {
  if (!['educator', 'admin', 'moderator', 'creator'].includes(req.user.role)) throw new HttpError(403, 'Staff only');
  const params = [];
  let sql = `SELECT t.id,t.assessment_id,t.user_id,u.name student,a.title,t.risk,t.proctor_status,t.status,t.submitted_at,t.started_at,
      (SELECT COUNT(*) FROM proctor_appeals p WHERE p.attempt_id=t.id AND p.status='open') appeals
    FROM attempts t JOIN assessments a ON a.id=t.assessment_id JOIN users u ON u.id=t.user_id WHERE a.proctored=1`;
  if (req.query.assessment_id) { sql += ' AND t.assessment_id=?'; params.push(int(req.query.assessment_id)); }
  else sql += ` AND (t.proctor_status IN ('review','flagged') OR EXISTS(SELECT 1 FROM proctor_appeals p WHERE p.attempt_id=t.id AND p.status='open'))`;
  sql += ' ORDER BY (t.proctor_status=\'flagged\') DESC, t.risk DESC, t.id DESC LIMIT 300';
  const rows = q.all(sql, ...params).filter(r => {
    const a = q.get('SELECT * FROM assessments WHERE id=?', r.assessment_id);
    return canReview(req.user, a) || A.teachesStudent(req.user, r.user_id);
  });
  res.json({ attempts: rows });
}));

router.get('/proctor/attempts/:id', auth, wrap(async (req, res) => {
  const { att, a, staff } = reviewable(req);
  const events = q.all('SELECT id,kind,severity,detail,created_at FROM proctor_events WHERE attempt_id=? ORDER BY id', att.id).map(e => ({ ...e, detail: json(e.detail, {}) }));
  const summary = {};
  for (const e of events) summary[e.kind] = (summary[e.kind] || 0) + 1;
  const out = { attempt: { id: att.id, status: att.status, risk: att.risk, proctor_status: att.proctor_status, proctor_note: att.proctor_note, started_at: att.started_at, submitted_at: att.submitted_at }, assessment: { id: a.id, title: a.title }, summary, events, appeals: q.all('SELECT * FROM proctor_appeals WHERE attempt_id=? ORDER BY id', att.id) };
  if (staff) {
    out.student = q.get('SELECT id,name FROM users WHERE id=?', att.user_id);
    out.snapshots = q.all(`SELECT id,owner_type,label,created_at FROM snapshots WHERE (owner_type='attempt' AND owner_id=?) OR (owner_type='precheck' AND owner_id=?) ORDER BY id`, att.id, att.precheck_id || 0);
    const pre = att.precheck_id && q.get('SELECT steps,degraded FROM precheck_sessions WHERE id=?', att.precheck_id);
    out.precheck = pre ? { steps: json(pre.steps, {}), degraded: !!pre.degraded } : null;
  }
  res.json(out);
}));

router.get('/proctor/snapshots/:id', auth, wrap(async (req, res) => {
  const s = q.get('SELECT * FROM snapshots WHERE id=?', int(req.params.id));
  if (!s) throw new HttpError(404, 'Snapshot not found');
  const attId = s.owner_type === 'attempt' ? s.owner_id : (q.get('SELECT id FROM attempts WHERE precheck_id=?', s.owner_id) || {}).id;
  const att = attId && q.get('SELECT * FROM attempts WHERE id=?', attId);
  const a = att && q.get('SELECT * FROM assessments WHERE id=?', att.assessment_id);
  if (!att || !(canReview(req.user, a) || A.teachesStudent(req.user, att.user_id))) throw new HttpError(403, 'Staff only');
  audit(req, 'snapshot_view', { snapshot: s.id });
  res.json({ data_url: C.decryptText(s.data_enc), label: s.label, created_at: s.created_at });
}));

router.post('/proctor/attempts/:id/decision', auth, wrap(async (req, res) => {
  const { att, a, staff } = reviewable(req);
  if (!staff || att.user_id === req.user.id) throw new HttpError(403, 'Only a teacher or moderator can decide');
  const decision = req.body && req.body.decision;
  if (!['clear', 'invalidate'].includes(decision)) throw new HttpError(400, 'Decision must be clear or invalidate');
  const note = S(req.body.note, 800);
  if (decision === 'invalidate' && note.length < 5) throw new HttpError(400, 'Add a short note explaining why the attempt is invalidated');
  if (decision === 'clear') q.run(`UPDATE attempts SET proctor_status='cleared', proctor_note=? WHERE id=?`, note, att.id);
  else q.run(`UPDATE attempts SET proctor_status='voided', status='voided', passed=0, proctor_note=? WHERE id=?`, note, att.id);
  q.run(`UPDATE proctor_appeals SET status='resolved', resolved_by=?, resolution=? WHERE attempt_id=? AND status='open'`, req.user.id, decision + (note ? ': ' + note : ''), att.id);
  notify(att.user_id, decision === 'clear' ? 'Your result has been released' : 'Your attempt was invalidated', `${a.title}${note ? ' — ' + note : ''}`, '#/attempt/' + att.id);
  audit(req, 'proctor_decision', { attempt: att.id, decision });
  res.json({ ok: true });
}));

router.post('/proctor/attempts/:id/appeal', auth, wrap(async (req, res) => {
  const { att, a } = reviewable(req);
  if (att.user_id !== req.user.id) throw new HttpError(403, 'Only the learner can appeal');
  const msg = S(req.body && req.body.message, 1000);
  if (msg.length < 5) throw new HttpError(400, 'Tell us what happened (a few words is fine)');
  q.run('INSERT INTO proctor_appeals(attempt_id,user_id,message,created_at) VALUES(?,?,?,?)', att.id, req.user.id, msg, Date.now());
  const reviewers = new Set([a.creator_id]);
  for (const r of q.all('SELECT DISTINCT c.teacher_id id FROM enrollments e JOIN classrooms c ON c.id=e.classroom_id WHERE e.student_id=?', att.user_id)) reviewers.add(r.id);
  for (const id of reviewers) notify(id, 'Proctoring appeal', `${req.user.name} appealed on "${a.title}"`, '#/proctor');
  res.status(201).json({ ok: true });
}));

/* ------------------------------------------------------------ retention */
function purge() {
  const cutoff = Date.now() - cfg.PROCTOR_RETENTION_DAYS * 864e5;
  const s = q.run('DELETE FROM snapshots WHERE created_at<?', cutoff).changes;
  const p = q.run('DELETE FROM precheck_sessions WHERE created_at<?', cutoff).changes;
  return { snapshots: s, prechecks: p };
}

module.exports = router;
module.exports.purge = purge;
module.exports.WEIGHT = WEIGHT;
