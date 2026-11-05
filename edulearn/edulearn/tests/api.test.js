'use strict';
process.env.DB_FILE = ':memory:';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'edu-test-'));
process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { createApp } = require('../server/index');
const { q } = require('../server/db');
require('../server/seed').run();

let base, server;
test.before(async () => { server = createApp().listen(0); await new Promise(r => server.on('listening', r)); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => server.close());

async function api(method, path, body, token) {
  const r = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, body: json };
}
const login = async email => (await api('POST', '/auth/login', { email: email + '@edulearn.demo', password: 'Demo1234' })).body;
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.body)); return r.body; };

function descriptor(seed, noise = 0) {
  let a = seed; const rnd = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 - 0.5; };
  let n = 0; const v = Array.from({ length: 128 }, () => { const x = rnd(); n += x * x; return x; });
  const s = 1 / Math.sqrt(n);
  let b = seed + 99; const rnd2 = () => { b = (b * 22695477 + 1) % 4294967296; return b / 4294967296 - 0.5; };
  return v.map(x => x * s + rnd2() * noise);
}

// Minimal "stored" zip writer so we can create archives with hostile entry names (adm-zip sanitises them on addFile).
function rawZip(files) {
  const zlib = require('zlib'); const parts = [], central = []; let offset = 0;
  for (const [name, data] of files) {
    const nm = Buffer.from(name), crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const T = {};
test('demo logins work and wrong passwords fail', async () => {
  for (const r of ['student', 'adult', 'kid', 'teacher', 'creator', 'moderator', 'admin']) { const b = await login(r); assert.ok(b.token, r); T[r] = b.token; }
  assert.equal((await api('POST', '/auth/login', { email: 'student@edulearn.demo', password: 'nope' })).status, 401);
  assert.equal((await api('GET', '/auth/me')).status, 401);
});

test('registration: validation, minors need a guardian, educator creates a school, classroom code join', async () => {
  assert.equal((await api('POST', '/auth/register', { email: 'x@y.z', password: 'short', name: 'Xy', role: 'student', consent_terms: true })).status, 400);
  const y = new Date().getFullYear();
  assert.equal((await api('POST', '/auth/register', { email: 'young@t.rw', password: 'Passw0rdX', name: 'Young One', role: 'student', grade_level: 'p3', birth_year: y - 8, consent_terms: true })).status, 400, 'minor without guardian rejected');
  const edu = ok(await api('POST', '/auth/register', { email: 'newteacher@t.rw', password: 'Passw0rdX', name: 'Nina Teacher', role: 'educator', consent_terms: true, new_school: { name: 'Test Valley School', district: 'Huye' } }), 201);
  assert.equal(edu.user.school.name, 'Test Valley School');
  const cls = ok(await api('POST', '/classrooms', { name: 'P3 Maths', grade: 'p3', subject: 'Mathematics' }, edu.token), 201);
  assert.match(cls.classroom.code, /^[A-Z2-9]{6}$/);
  const st = ok(await api('POST', '/auth/register', { email: 'young@t.rw', password: 'Passw0rdX', name: 'Young One', role: 'student', grade_level: 'p3', birth_year: y - 8, guardian_contact: 'mum@t.rw', consent_terms: true, class_code: cls.classroom.code }), 201);
  assert.equal(st.user.minor, true);
  const mine = ok(await api('GET', '/classrooms', undefined, st.token));
  assert.equal(mine.classrooms.length, 1);
  assert.equal((await api('POST', '/classrooms/join', { code: 'ZZZZZZ' }, st.token)).status, 404);
  assert.equal((await api('POST', '/classrooms', { name: 'nope' }, st.token)).status, 403, 'students cannot create classrooms');
});

test('content catalogue by grade/track, lesson completion awards XP and badges', async () => {
  const pre = ok(await api('GET', '/courses?grade=pre-nursery', undefined, T.student));
  assert.ok(pre.courses.length >= 1);
  const voc = ok(await api('GET', '/courses?track=vocational', undefined, T.student));
  assert.ok(voc.courses.some(c => c.subject === 'Electrical Installation'));
  const reg = ok(await api('GET', '/courses?track=regional', undefined, T.student));
  assert.ok(reg.courses.length >= 1);
  const lang = ok(await api('GET', '/courses?track=language', undefined, T.student));
  assert.ok(lang.courses.length >= 1);
  const c = ok(await api('GET', '/courses?q=Fractions', undefined, T.student)).courses[0];
  const detail = ok(await api('GET', '/courses/' + c.id, undefined, T.student));
  const xp0 = ok(await api('GET', '/gamification/me', undefined, T.student)).xp;
  for (const l of detail.lessons) { const r = ok(await api('POST', `/lessons/${l.id}/complete`, {}, T.student)); assert.ok(r.xp_awarded >= 10); }
  const g = ok(await api('GET', '/gamification/me', undefined, T.student));
  assert.ok(g.xp >= xp0 + 20 + 50, 'lessons + course completion XP');
  assert.ok(g.badges.find(b => b.key === 'course-done').earned);
  const again = ok(await api('POST', `/lessons/${detail.lessons[0].id}/complete`, {}, T.student));
  assert.equal(again.xp_awarded, 0, 'no XP farming by repeating');
  assert.equal((await api('GET', '/courses?status=pending', undefined, T.student)).body.courses.every(c => c.status === 'published'), true, 'students never see unpublished courses');
});

test('AR and VR lessons validate media and config', async () => {
  const course = ok(await api('POST', '/courses', { title: 'My new course', grade_level: 's2', track: 'academic' }, T.creator), 201).course;
  assert.equal((await api('POST', `/courses/${course.id}/lessons`, { title: 'Bad', type: 'ar', ar_config: { model_url: 'http://insecure.example/x.glb' } }, T.creator)).status, 400, 'http model rejected');
  assert.equal((await api('POST', `/courses/${course.id}/lessons`, { title: 'Bad2', type: 'video', media_url: 'javascript:alert(1)' }, T.creator)).status, 400);
  const l = ok(await api('POST', `/courses/${course.id}/lessons`, { title: 'VR room', type: 'vr', ar_config: { entities: [{ shape: 'evil<script>', color: 'red', position: '1 2 zzz' }] } }, T.creator), 201).lesson;
  const stored = JSON.parse(l.ar_config).entities[0];
  assert.equal(stored.shape, 'sphere'); assert.equal(stored.color, '#4cc9f0'); assert.equal(stored.position, '0 1.5 -3');
  assert.equal((await api('PUT', `/lessons/${l.id}`, { title: 'hacked' }, T.student)).status, 403);
  assert.equal((await api('POST', `/courses/${course.id}/submit`, {}, T.creator)).body.status, 'pending');
  const pend = ok(await api('GET', '/admin/courses/pending', undefined, T.moderator));
  assert.ok(pend.courses.some(c => c.id === course.id));
  ok(await api('POST', `/admin/courses/${course.id}/review`, { decision: 'approve' }, T.moderator));
  assert.equal(ok(await api('GET', '/courses/' + course.id, undefined, T.student)).course.status, 'published');
});

const findAssessment = async (title, token) => (ok(await api('GET', '/assessments', undefined, token)).assessments.find(a => a.title.includes(title)));

test('practice quiz: instant feedback and grading rules', async () => {
  const a = await findAssessment('Fractions practice', T.student) || (await (async () => { const c = ok(await api('GET', '/courses?q=Fractions', undefined, T.student)).courses[0]; await api('POST', `/courses/${c.id}/enroll`, {}, T.student); return findAssessment('Fractions practice', T.student); })());
  assert.ok(a, 'practice quiz visible after enrolling');
  const st = ok(await api('POST', `/assessments/${a.id}/start`, {}, T.student), 201);
  for (const x of st.questions) assert.equal(x.correct_answer, undefined, 'answers never sent with questions');
  const byPrompt = p => st.questions.find(x => x.prompt.includes(p));
  let r = ok(await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: byPrompt('left if 1 of 4').id, answer: 1 }, T.student));
  assert.equal(r.correct, true); assert.ok(r.explanation);
  r = ok(await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: byPrompt('biggest').id, answer: 0 }, T.student));
  assert.equal(r.correct, false); assert.equal(r.correct_answer, 2);
  r = ok(await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: byPrompt('top number').id, answer: '  Numerator ' }, T.student));
  assert.equal(r.correct, true, 'text answers are case/space insensitive');
  r = ok(await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: byPrompt('1/2 + 1/2').id, answer: '1.0' }, T.student));
  assert.equal(r.correct, true, 'numeric answers compare by value');
  assert.equal((await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: 999999, answer: 1 }, T.student)).status, 400, 'foreign question ids rejected');
  const sub = ok(await api('POST', `/attempts/${st.attempt.id}/submit`, {}, T.student));
  assert.equal(sub.result.score, 3); assert.equal(sub.result.max_score, 5);
  assert.equal(sub.result.items.filter(i => !i.answered).length, 1);
  // AI feedback tutor: explains the wrong answer, and a different student cannot read this attempt
  const fb = ok(await api('POST', `/attempts/${st.attempt.id}/feedback`, { message: 'explain question 2' }, T.student));
  assert.ok(fb.reply.length > 20);
  assert.equal((await api('GET', `/attempts/${st.attempt.id}`, undefined, T.adult)).status, 403, 'peer cannot read attempt');
  assert.equal((await api('POST', `/attempts/${st.attempt.id}/feedback`, { message: 'hi' }, T.adult)).status, 403);
});

test('AI feedback never reveals answers when the test hides them, and handles welfare messages', async () => {
  const a = await findAssessment('Science compulsory', T.student);
  const st = ok(await api('POST', `/assessments/${a.id}/start`, {}, T.student), 201);
  assert.equal((await api('POST', `/attempts/${st.attempt.id}/feedback`, { message: 'help' }, T.student)).status, 403, 'feedback locked until submit');
  for (const x of st.questions) await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: x.id, answer: x.type === 'short' ? 'x' : x.type === 'truefalse' ? false : x.type === 'multi' ? [1] : 3 }, T.student);
  ok(await api('POST', `/attempts/${st.attempt.id}/submit`, {}, T.student));
  const w = ok(await api('POST', `/attempts/${st.attempt.id}/feedback`, { message: 'I want to kill myself' }, T.student));
  assert.match(w.reply, /trusted adult|teacher|helpline/i);
  assert.ok(q.get(`SELECT 1 x FROM reports WHERE priority=3 AND reason LIKE '%Welfare%'`), 'a human-visible welfare report is created');
  const blocked = ok(await api('POST', `/attempts/${st.attempt.id}/feedback`, { message: 'you are a shit bot' }, T.student));
  assert.match(blocked.reply, /kind/i);
});

test('compulsory test cannot be submitted incomplete; teacher sees analytics', async () => {
  const a = await findAssessment('Science compulsory', T.adult);
  const st = ok(await api('POST', `/assessments/${a.id}/start`, {}, T.adult), 201);
  await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: st.questions[0].id, answer: 2 }, T.adult);
  const early = await api('POST', `/attempts/${st.attempt.id}/submit`, {}, T.adult);
  assert.equal(early.status, 400); assert.equal(early.body.code, 'compulsory_incomplete');
  const detail = ok(await api('GET', `/assessments/${a.id}`, undefined, T.adult));
  assert.equal(detail.questions, undefined, 'students never get the answer key');
  assert.equal((await api('PUT', `/assessments/${a.id}`, { title: 'x' }, T.adult)).status, 403);
  const res = ok(await api('GET', `/assessments/${a.id}/results`, undefined, T.teacher));
  assert.ok(res.attempts.length >= 1 && Array.isArray(res.question_stats));
  assert.equal((await api('GET', `/assessments/${a.id}/results`, undefined, T.student)).status, 403);
  const an = ok(await api('GET', `/classrooms/${q.get(`SELECT id FROM classrooms WHERE code='DEMO23'`).id}/analytics`, undefined, T.teacher));
  assert.equal(an.total_students, 3);
});

test('adaptive quiz serves one question at a time and adjusts to mastery', async () => {
  const solar = ok(await api('GET', '/courses?q=Solar', undefined, T.adult)).courses[0];
  ok(await api('POST', `/courses/${solar.id}/enroll`, {}, T.adult));
  const a = await findAssessment('adaptive', T.adult);
  assert.ok(a, 'adaptive quiz visible once enrolled in its course');
  const st = ok(await api('POST', `/assessments/${a.id}/start`, {}, T.adult), 201);
  assert.equal(st.questions.length, 1);
  let cur = st.questions[0], served = 1, done = false;
  while (!done && served < 20) {
    const ans = cur.type === 'mcq' ? 1 : cur.type === 'truefalse' ? true : cur.type === 'multi' ? [0] : 'jupiter';
    const r = ok(await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: cur.id, answer: ans }, T.adult));
    done = !!r.done; if (r.next) { cur = r.next; served++; }
  }
  assert.equal(served, 6, 'stops after the configured adaptive length');
  const r = ok(await api('POST', `/attempts/${st.attempt.id}/submit`, {}, T.adult));
  assert.equal(r.result.items.length, 6);
  assert.ok(ok(await api('GET', '/gamification/me', undefined, T.adult)).mastery.length >= 1);
});

test('face enrolment encrypts the template; identity match; guardian consent gate for minors', async () => {
  const base1 = descriptor(7);
  const samples = [base1, descriptor(7, 0.02), descriptor(7, 0.02)].map((d, i) => d.map((x, j) => x + (i ? Math.sin(i + j) * 0.003 : 0)));
  // kid has no guardian consent yet
  assert.equal((await api('POST', '/auth/face/enroll', { consent: true, descriptors: samples, liveness: { passed: true } }, T.kid)).body.code, 'guardian_consent_required');
  // missing liveness / too few samples rejected
  assert.equal((await api('POST', '/auth/face/enroll', { consent: true, descriptors: samples, liveness: { passed: false } }, T.student)).status, 400);
  assert.equal((await api('POST', '/auth/face/enroll', { consent: true, descriptors: samples.slice(0, 2), liveness: { passed: true } }, T.student)).status, 400);
  // frames from different people rejected
  assert.equal((await api('POST', '/auth/face/enroll', { consent: true, descriptors: [descriptor(1), descriptor(2), descriptor(3)], liveness: { passed: true } }, T.student)).status, 400);
  const e = ok(await api('POST', '/auth/face/enroll', { consent: true, descriptors: samples, liveness: { passed: true } }, T.student));
  assert.equal(e.user.face_enrolled, true);
  const raw = q.get(`SELECT face_enc FROM users WHERE email='student@edulearn.demo'`).face_enc;
  assert.match(raw, /^v1\./); assert.ok(!raw.includes('0.'), 'ciphertext, not JSON');
  assert.equal(ok(await api('POST', '/auth/face/verify', { descriptor: descriptor(7, 0.02), liveness: { passed: true } }, T.student)).match, true);
  assert.equal((await api('POST', '/auth/face/verify', { descriptor: descriptor(50), liveness: { passed: true } }, T.student)).status, 401);
  assert.equal(ok(await api('POST', '/auth/face/identity-match', { id_descriptor: descriptor(7, 0.05) }, T.student)).match, true);
  assert.equal(ok(await api('GET', '/auth/me', undefined, T.student)).user.identity_verified, true);
  // face login step-up
  ok(await api('PUT', '/auth/me', { face_login: true }, T.student));
  const step = await api('POST', '/auth/login', { email: 'student@edulearn.demo', password: 'Demo1234' });
  assert.equal(step.body.step_up, 'face');
  assert.equal((await api('GET', '/classrooms', undefined, step.body.token)).status, 403, 'half-authenticated token is useless');
  const full = ok(await api('POST', '/auth/face/verify', { descriptor: descriptor(7, 0.01), liveness: { passed: true } }, step.body.token));
  assert.ok(full.token);
  T.student = full.token;
  ok(await api('PUT', '/auth/me', { face_login: false }, T.student));
  // exports exclude biometrics
  const exp = ok(await api('GET', '/auth/export', undefined, T.student));
  assert.ok(!JSON.stringify(exp).includes('face_enc'));
});

test('proctored exam: precheck gate, event scoring, flagged results are held, teacher decides, appeal flow', async () => {
  const ex = await findAssessment('Physics Exam', T.student);
  assert.equal((await api('POST', `/assessments/${ex.id}/start`, {}, T.student)).body.code, 'precheck_required');
  assert.equal((await api('POST', `/assessments/${ex.id}/start`, {}, T.adult)).body.code, 'face_required', 'unenrolled learner is blocked');
  const pc = ok(await api('POST', '/proctor/precheck/start', { assessment_id: ex.id }, T.student), 201);
  const step = (name, data) => api('POST', `/proctor/precheck/${pc.id}/step`, { nonce: pc.nonce, step: name, data }, T.student);
  let r = (await step('face', { descriptor: descriptor(50), liveness: { passed: true }, faces: 1 })).body;
  assert.equal(r.ok, false); assert.match(r.reason, /does not match/);
  r = (await step('face', { descriptor: descriptor(7, 0.02), liveness: { passed: true }, faces: 2 })).body;
  assert.equal(r.ok, false, 'two people in frame fails');
  r = (await step('face', { descriptor: descriptor(7, 0.02), liveness: { passed: true }, faces: 1 })).body; assert.equal(r.ok, true);
  r = (await step('hands', { left: 0.05, right: 0.001, samples: 20, faceVisible: true, faces: 1 })).body;
  assert.equal(r.ok, false); assert.match(r.reason, /right arm/);
  r = (await step('hands', { left: 0.05, right: 0.06, samples: 20, faceVisible: true, faces: 1 })).body; assert.equal(r.ok, true);
  r = (await step('surroundings', { panScore: 0.005, seconds: 8, samples: 30, objects: [], maxFaces: 1, model: true })).body;
  assert.equal(r.ok, false); assert.match(r.reason, /movement/);
  r = (await step('surroundings', { panScore: 0.08, seconds: 8, samples: 30, objects: ['cell phone'], maxFaces: 1, model: true })).body;
  assert.equal(r.ok, false); assert.match(r.reason, /cell phone/);
  r = (await step('surroundings', { panScore: 0.08, seconds: 8, samples: 30, objects: ['chair'], maxFaces: 1, model: true })).body;
  assert.equal(r.ok, true); assert.equal(r.passed, true); assert.ok(r.token);
  const st = ok(await api('POST', `/assessments/${ex.id}/start`, { precheck_token: r.token }, T.student), 201);
  assert.equal((await api('POST', `/assessments/${ex.id}/start`, { precheck_token: r.token }, T.adult)).status, 403, 'token is bound to the learner');
  assert.equal(st.assessment.proctored, true);
  // continuous monitoring
  const ev = k => api('POST', '/proctor/events', { attempt_id: st.attempt.id, events: [{ kind: k, detail: {} }] }, T.student);
  let s1 = ok(await ev('window_blur')); assert.equal(s1.status, 'clear');
  s1 = ok(await ev('multiple_faces')); assert.ok(s1.risk >= 24); assert.match(s1.notice, /alone/);
  assert.equal((await api('POST', '/proctor/events', { attempt_id: st.attempt.id, events: [{ kind: 'made_up' }] }, T.student)).body.risk, s1.risk, 'unknown event kinds are ignored');
  await ev('multiple_faces'); s1 = ok(await ev('face_mismatch'));
  assert.equal(s1.status, 'flagged');
  assert.equal((await api('POST', '/proctor/events', { attempt_id: st.attempt.id, events: [] }, T.adult)).status, 409, 'cannot post events to someone else\'s attempt');
  // answer and submit
  for (const x of st.questions) await api('POST', `/attempts/${st.attempt.id}/answer`, { question_id: x.id, answer: x.type === 'short' ? '50' : x.type === 'truefalse' ? true : x.prompt.startsWith('Speed') ? 0 : 1 }, T.student);
  const sub = ok(await api('POST', `/attempts/${st.attempt.id}/submit`, {}, T.student));
  assert.equal(sub.held, true); assert.equal(sub.result, undefined, 'flagged result is held, not leaked');
  assert.equal((await api('POST', `/attempts/${st.attempt.id}/feedback`, { message: 'hint' }, T.student)).status, 403);
  // learner appeals; moderation queue shows it to teacher
  ok(await api('POST', `/proctor/attempts/${st.attempt.id}/appeal`, { message: 'My little sister walked in briefly.' }, T.student), 201);
  const queue = ok(await api('GET', '/proctor/queue', undefined, T.teacher));
  assert.ok(queue.attempts.find(a => a.id === st.attempt.id && a.appeals === 1));
  assert.equal((await api('GET', '/proctor/queue', undefined, T.student)).status, 403);
  const rev = ok(await api('GET', `/proctor/attempts/${st.attempt.id}`, undefined, T.teacher));
  assert.ok(rev.events.length >= 4 && rev.precheck.steps.face.ok);
  assert.equal((await api('GET', `/proctor/attempts/${st.attempt.id}`, undefined, T.adult)).status, 403);
  assert.equal((await api('POST', `/proctor/attempts/${st.attempt.id}/decision`, { decision: 'clear' }, T.student)).status, 403, 'learner cannot clear themselves');
  assert.equal((await api('POST', `/proctor/attempts/${st.attempt.id}/decision`, { decision: 'invalidate' }, T.teacher)).status, 400, 'invalidating requires a written reason');
  ok(await api('POST', `/proctor/attempts/${st.attempt.id}/decision`, { decision: 'clear', note: 'Sibling confirmed' }, T.teacher));
  const out = ok(await api('GET', `/attempts/${st.attempt.id}/result`, undefined, T.student));
  assert.ok(out.result && out.result.percent === 100);
  assert.equal(out.result.items[0].correct_answer, undefined, 'exam hides answer key (show_answers=0)');
  await ev('multiple_faces').catch(() => {});
  assert.equal((await api('POST', `/assessments/${ex.id}/start`, {}, T.student)).status, 403, 'single attempt enforced');
});

test('moderation: profanity, personal info for minors, threats; forum + chat history access control', async () => {
  const cl = q.get(`SELECT id FROM classrooms WHERE code='DEMO23'`).id;
  const post = (body, token = T.kid) => api('POST', '/forum/threads', { scope_type: 'classroom', scope_id: cl, title: 'Hello there', body }, token);
  assert.equal((await post('you are a b1tch')).status, 422, 'leetspeak profanity caught');
  assert.equal((await post('call me on +250 788 123 456')).status, 422, 'phone number blocked for minors');
  assert.equal((await post('add me on whatsapp')).status, 422);
  assert.equal((await post('I will kill you')).status, 422, 'threat blocked');
  const good = ok(await post('Can someone explain orbits please?'), 201);
  const long = ok(await api('GET', '/forum/threads/' + good.id, undefined, T.adult));
  assert.equal(long.thread.title, 'Hello there');
  ok(await api('POST', `/forum/threads/${good.id}/posts`, { body: 'Sure! Gravity keeps planets moving around the Sun.' }, T.adult), 201);
  const outsider = (await api('POST', '/auth/register', { email: 'out@t.rw', password: 'Passw0rdX', name: 'Out Sider', role: 'creator', consent_terms: true })).body.token;
  assert.equal((await api('GET', `/forum/threads?scope_type=classroom&scope_id=${cl}`, undefined, outsider)).status, 403, 'outsiders cannot read class boards');
  assert.equal((await api('GET', `/chat/class:${cl}/history`, undefined, outsider)).status, 403);
  assert.equal((await api('DELETE', '/forum/threads/' + good.id, undefined, T.adult)).status, 403, 'peers cannot delete others\' threads');
  ok(await api('POST', `/forum/threads/${good.id}/moderate`, { locked: true }, T.teacher));
  assert.equal((await api('POST', `/forum/threads/${good.id}/posts`, { body: 'late reply' }, T.adult)).status, 403, 'locked');
  ok(await api('POST', '/report', { target_type: 'thread', target_id: good.id, reason: 'unsafe content test' }, T.adult), 201);
  const rep = ok(await api('GET', '/admin/reports', undefined, T.moderator));
  assert.ok(rep.reports.some(r => r.target_id === good.id && r.content));
  assert.equal((await api('GET', '/admin/reports', undefined, T.student)).status, 403);
});

test('real-time chat over WebSocket: auth, rooms, moderation, delivery, deletion', async () => {
  const cl = q.get(`SELECT id FROM classrooms WHERE code='DEMO23'`).id;
  const room = 'class:' + cl;
  const url = base.replace('http', 'ws') + '/ws';
  const { WebSocket } = require('ws');
  const { attach } = require('../server/hub');
  attach(server);
  const open = token => new Promise((res, rej) => {
    const ws = new WebSocket(url); ws.log = [];
    ws.on('message', d => ws.log.push(JSON.parse(d)));
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'auth', token })); res(ws); }); ws.on('error', rej);
  });
  const wait = (ws, pred, ms = 2500) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { const f = ws.log.find(pred); if (f) { clearInterval(i); res(f); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout waiting; got ' + JSON.stringify(ws.log))); } }, 20); });
  const a = await open(T.adult), t = await open(T.teacher);
  await wait(a, m => m.type === 'ready');
  a.send(JSON.stringify({ type: 'join', room })); t.send(JSON.stringify({ type: 'join', room }));
  await wait(a, m => m.type === 'joined' && m.room === room); await wait(t, m => m.type === 'joined');
  a.send(JSON.stringify({ type: 'send', room, body: 'Hello class!' }));
  const got = await wait(t, m => m.type === 'message');
  assert.equal(got.message.body, 'Hello class!');
  a.send(JSON.stringify({ type: 'send', room, body: 'what the fuck' }));
  assert.equal((await wait(a, m => m.type === 'rejected')).room, room);
  const o = await open(ok(await api('POST', '/auth/register', { email: 'o2@t.rw', password: 'Passw0rdX', name: 'Other Person', role: 'creator', consent_terms: true }, undefined, undefined), 201).token);
  o.send(JSON.stringify({ type: 'join', room }));
  assert.match((await wait(o, m => m.type === 'error')).error, /access/);
  const bad = await open('garbage'); await wait(bad, m => m.type === 'error' && m.fatal);
  ok(await api('DELETE', `/chat/messages/${got.message.id}`, undefined, T.teacher));
  assert.equal((await wait(a, m => m.type === 'delete')).id, got.message.id);
  const hist = ok(await api('GET', `/chat/${room}/history`, undefined, T.adult));
  assert.ok(!hist.messages.some(m => m.id === got.message.id));
  [a, t, o, bad].forEach(w => w.close());
});

test('SCORM: package upload, zip-slip protection, state commit completes lesson', async () => {
  const course = ok(await api('POST', '/courses', { title: 'SCORM course', grade_level: 's1' }, T.teacher), 201).course;
  const lesson = ok(await api('POST', `/courses/${course.id}/lessons`, { title: 'Pkg', type: 'scorm' }, T.teacher), 201).lesson;
  const manifest = `<?xml version="1.0"?><manifest xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata><resources><resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource></resources></manifest>`;
  const up = async (zip, token = T.teacher) => { const fd = new FormData(); fd.append('file', new Blob([Buffer.isBuffer(zip) ? zip : zip.toBuffer()]), 'pkg.zip'); const r = await fetch(`${base}/api/lessons/${lesson.id}/scorm`, { method: 'POST', body: fd, headers: { authorization: 'Bearer ' + token } }); return { status: r.status, body: await r.json() }; };
  const evil = rawZip([['imsmanifest.xml', Buffer.from(manifest)], ['index.html', Buffer.from('<html></html>')], ['../../escape.html', Buffer.from('x')]]);
  assert.equal(new AdmZip(evil).getEntries().some(e => e.entryName.includes('..')), true, 'fixture really contains a traversal name');
  const bad = await up(evil); assert.equal(bad.status, 400, 'path traversal rejected'); assert.match(bad.body.error, /unsafe/);
  assert.ok(!require('fs').existsSync(require('path').join(process.env.DATA_DIR, 'escape.html')) && !require('fs').existsSync(require('path').join(process.env.DATA_DIR, '..', 'escape.html')), 'nothing written outside the package folder');
  const good = new AdmZip(); good.addFile('imsmanifest.xml', Buffer.from(manifest)); good.addFile('index.html', Buffer.from('<html><body>SCO</body></html>'));
  assert.equal((await up(good, T.student)).status, 403);
  const res = await up(good); assert.equal(res.status, 200); assert.equal(res.body.version, '1.2');
  const html = await fetch(`${base}/scorm/${lesson.id}/index.html`);
  assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /sandbox/);
  const body0 = await html.text(); assert.match(body0, /scorm-shim\.js/, 'shim injected'); assert.match(body0, /__EDU_SCORM/);
  ok(await api('POST', `/courses/${course.id}/submit`, {}, T.teacher)); ok(await api('POST', `/admin/courses/${course.id}/review`, { decision: 'approve' }, T.admin));
  const launch = ok(await api('GET', `/lessons/${lesson.id}/scorm-launch`, undefined, T.adult));
  const tok = new URLSearchParams(launch.url.split('#')[1]).get('token');
  assert.equal((await api('GET', '/courses', undefined, tok)).status, 401, 'scoped token cannot call the main API');
  const state = ok(await api('GET', '/scorm/state', undefined, tok)); assert.equal(state.lesson.version, '1.2');
  const c1 = ok(await api('POST', '/scorm/commit', { data: { 'cmi.core.lesson_status': 'incomplete', 'evil.key': 'x' } }, tok)); assert.equal(c1.completed, false);
  const c2 = ok(await api('POST', '/scorm/commit', { data: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '88' } }, tok)); assert.equal(c2.completed, true);
  assert.ok(JSON.parse(q.get('SELECT data FROM scorm_state WHERE lesson_id=?', lesson.id).data)['cmi.core.lesson_status'] === 'passed');
  const resumed = await (await fetch(`${base}/scorm/${lesson.id}/index.html?st=${encodeURIComponent(tok)}`)).text(); assert.match(resumed, /cmi\.core\.score\.raw/, 'saved state embedded for resume');
  const anon = await (await fetch(`${base}/scorm/${lesson.id}/index.html?st=garbage`)).text(); assert.ok(!/cmi\.core\.score\.raw/.test(anon), 'no state without a valid token');
  assert.ok(!('evil.key' in JSON.parse(q.get('SELECT data FROM scorm_state WHERE lesson_id=?', lesson.id).data)), 'only cmi.* keys stored');
});

test('leaderboard privacy, notifications, dashboards, admin guards', async () => {
  const lb = ok(await api('GET', '/leaderboard?scope=school&period=all', undefined, T.adult));
  assert.ok(lb.board.length >= 2 && lb.board[0].points >= lb.board[1].points);
  assert.ok(lb.board.some(r => !r.me && /^\w+ \w\.$/.test(r.name)), 'others shown as first name + initial');
  ok(await api('PUT', '/auth/me', { show_on_leaderboard: false }, T.adult));
  assert.ok(!ok(await api('GET', '/leaderboard?scope=school', undefined, T.student)).board.some(r => r.id === lb.me.id), 'opt-out respected');
  assert.ok(ok(await api('GET', '/notifications', undefined, T.student)).notifications.length >= 1);
  for (const [k, role] of [['student', 'student'], ['teacher', 'educator'], ['creator', 'creator'], ['admin', 'admin']]) assert.equal(ok(await api('GET', '/dashboard', undefined, T[k])).role, role);
  assert.equal((await api('GET', '/admin/users', undefined, T.student)).status, 403);
  assert.equal((await api('POST', '/admin/users/1', { role: 'student' }, T.moderator)).status, 403, 'moderators cannot change roles');
  const teacherId = ok(await api('GET', '/admin/users?q=Nina', undefined, T.admin)).users[0].id;
  ok(await api('POST', `/admin/users/${teacherId}`, { status: 'suspended' }, T.admin));
  assert.equal((await api('POST', '/auth/login', { email: 'newteacher@t.rw', password: 'Passw0rdX' })).status, 403, 'suspended account cannot sign in');
});

test('security headers, uploads are inert, unknown API routes 404, SPA fallback', async () => {
  const r = await fetch(base + '/healthz');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.ok(r.headers.get('content-security-policy'));
  assert.equal((await fetch(base + '/api/nope')).status, 404);
  const fd = new FormData(); fd.append('file', new Blob(['<script>alert(1)</script>']), 'x.html');
  assert.equal((await fetch(base + '/api/upload', { method: 'POST', body: fd, headers: { authorization: 'Bearer ' + T.creator } })).status, 400, 'html uploads refused');
  const fd2 = new FormData(); fd2.append('file', new Blob([Buffer.from('GLBDATA')]), 'm.glb');
  const up = await (await fetch(base + '/api/upload', { method: 'POST', body: fd2, headers: { authorization: 'Bearer ' + T.creator } })).json();
  assert.match(up.url, /^\/files\/[a-f0-9]+\.glb$/);
  const f = await fetch(base + up.url); assert.equal(f.status, 200); assert.match(f.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(base + '/api/upload', { method: 'POST', body: fd2, headers: { authorization: 'Bearer ' + T.student } })).status, 403);
});
