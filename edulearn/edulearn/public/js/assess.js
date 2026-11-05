import { S, h, mount, GET, POST, PUT, DEL, toast, fail, icon, md, loading, empty, errorBox, setTitle, fmtDate, ago, clock, KIND, confirmBox, askText } from './core.js';
import { route, go, onLeave } from './router.js';

const isStaff = () => ['educator', 'creator', 'admin', 'moderator'].includes(S.user.role);
const kindChip = a => h('span', { class: 'chip ' + (a.kind === 'exam' ? 'ember' : a.kind === 'test' ? 'sun' : '') }, KIND[a.kind]);

/* ---------------- list ---------------- */
route('/assessments', async () => {
  setTitle('Assessments');
  const [avail, mine] = await Promise.all([GET('/assessments'), isStaff() ? GET('/assessments?mine=1') : Promise.resolve({ assessments: [] })]);
  const row = a => h('a', { class: 'item', href: '#/assessments/' + a.id },
    h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, [a.classroom_name || a.course_title, `${a.question_count} questions`, a.time_limit_min && `${a.time_limit_min} min`, a.closes_at && `closes ${fmtDate(a.closes_at)}`].filter(Boolean).join(', '))),
    kindChip(a), !!a.compulsory && h('span', { class: 'chip sun' }, 'Compulsory'), !!a.proctored && h('span', { class: 'chip ember' }, 'Proctored'), !a.published && h('span', { class: 'chip plain' }, 'Draft'),
    a.best_percent !== null && a.best_percent !== undefined && h('span', { class: 'chip leaf' }, `Best ${a.best_percent}%`), a.open_attempt && h('span', { class: 'chip sun' }, 'In progress'));
  return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Assessments'), h('p', { class: 'sub' }, 'Practice quizzes, adaptive quizzes, tests and exams from your classes and courses.')), isStaff() && h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/studio?tab=assessments' }, icon('plus'), 'Create assessment'))),
    h('section', { class: 'block', style: { marginTop: 0 } }, h('h2', isStaff() ? 'Assigned to me' : 'Available to you'), avail.assessments.length ? h('div', { class: 'list' }, avail.assessments.map(row)) : empty('Nothing here yet', S.user.role === 'student' ? 'Join a class with a code from your teacher, or add a course to see its quizzes.' : 'Assessments assigned to you as a learner appear here.', S.user.role === 'student' ? h('a', { class: 'btn primary', href: '#/classes' }, 'Join a class') : null)),
    isStaff() && h('section', { class: 'block' }, h('h2', 'Created by me'), mine.assessments.length ? h('div', { class: 'list' }, mine.assessments.map(row)) : empty('You have not created an assessment', 'Build quizzes and tests with automatic grading.', h('a', { class: 'btn primary', href: '#/studio?tab=assessments' }, 'Create one'))));
});

/* ---------------- detail ---------------- */
route('/assessments/:id', async ({ params }) => {
  const r = await GET('/assessments/' + params.id), a = r.assessment; setTitle(a.title);
  const open = r.my_attempts.find(x => x.status === 'in_progress');
  const used = r.my_attempts.filter(x => x.status !== 'in_progress').length;
  const left = a.max_attempts ? Math.max(0, a.max_attempts - used) : null;
  const now = Date.now(), notOpen = a.opens_at && now < a.opens_at, closed = a.closes_at && now > a.closes_at;
  const pr = r.proctor_ready;
  const start = async () => {
    try {
      if (!!a.proctored && !open) return go('/precheck/' + a.id);
      const x = await POST(`/assessments/${a.id}/start`, {});
      go('/take/' + x.attempt.id);
    } catch (e) { if (e.code === 'face_required' || e.code === 'guardian_consent_required') toast(e.message, 'err'); else fail(e); }
  };
  const blocked = (!!a.proctored && pr && (!pr.face_enrolled || !pr.consent || !pr.guardian_ok));
  return h('div', { class: 'page narrow' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/assessments' }, 'Assessments'), r.course && [' / ', h('a', { href: '#/courses/' + r.course.id }, r.course.title)]),
    h('div', { class: 'page-head' }, h('div', h('h1', a.title), a.description && h('p', { class: 'sub' }, a.description)), r.can_manage && h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/studio/assessment/' + a.id }, 'Edit questions'), h('a', { class: 'btn', href: '#/results/' + a.id }, 'View results'))),
    h('div', { class: 'row' }, kindChip(a), !!a.compulsory && h('span', { class: 'chip sun' }, 'Compulsory: answer every question'), !!a.proctored && h('span', { class: 'chip ember' }, 'Camera-proctored'), a.time_limit_min && h('span', { class: 'chip plain' }, `${a.time_limit_min} minutes`), h('span', { class: 'chip plain' }, `${r.question_count} questions`), h('span', { class: 'chip plain' }, `Pass mark ${a.pass_mark}%`), left !== null && h('span', { class: 'chip plain' }, `${left} attempt${left === 1 ? '' : 's'} left`)),
    !a.published && h('div', { class: 'banner warn mt' }, h('p', 'This assessment is a draft. Learners cannot see it until you publish it.')),
    a.kind === 'adaptive' && h('div', { class: 'banner mt' }, h('p', 'Questions adapt to you: get one right and the next is a little harder, miss one and it eases off. You get instant feedback after every answer.')),
    !!a.proctored && h('div', { class: 'banner warn mt stack tight' }, h('p', h('strong', 'Before you start')), h('ul', { style: { margin: 0, paddingLeft: '1.2rem' } }, h('li', 'A quick camera check confirms it is you, shows your arms, and scans your desk and room.'), h('li', 'Stay alone and in view of the camera. Stay on this tab and in full screen.'), h('li', 'The system only flags unusual events. Your teacher reviews every flag before anything counts against you, and you can appeal.')),
      pr && !pr.face_enrolled && h('p', h('a', { href: '#/settings' }, 'Enroll your face in Settings first.')), pr && !!pr.face_enrolled && !pr.guardian_ok && h('p', 'Your teacher needs to confirm your parent or guardian’s consent before you can sit proctored exams.')),
    notOpen && h('div', { class: 'banner err mt' }, h('p', `Opens ${fmtDate(a.opens_at)}.`)), closed && h('div', { class: 'banner err mt' }, h('p', 'This assessment is closed.')),
    h('div', { class: 'row mt' }, a.published || r.can_manage ? h('button', { class: 'btn primary', disabled: !!(notOpen || closed || blocked || (left === 0 && !open)), onclick: start }, open ? 'Continue attempt' : a.proctored ? 'Start pre-exam check' : used ? 'Try again' : 'Start') : null),
    r.my_attempts.length > 0 && h('section', { class: 'block' }, h('h2', 'Your attempts'), h('div', { class: 'list' }, r.my_attempts.map(x => h('a', { class: 'item', href: x.status === 'in_progress' ? '#/take/' + x.id : '#/attempt/' + x.id }, h('div', { class: 'grow' }, h('strong', x.status === 'in_progress' ? 'In progress' : x.status === 'voided' ? 'Invalidated' : x.proctor_status === 'flagged' ? 'Held for review' : `${x.max_score ? Math.round(100 * x.score / x.max_score) : 0}%`), h('span', { class: 'meta' }, x.submitted_at ? fmtDate(x.submitted_at) : 'Not submitted')), x.passed === 1 && h('span', { class: 'chip leaf' }, 'Passed'))))));
});

/* ---------------- runner ---------------- */
function inputFor(q, onChange, initial, locked) {
  const name = 'q' + q.id; let value = initial === undefined ? null : initial;
  if (q.type === 'short') { const i = h('input', { type: 'text', 'aria-label': 'Your answer', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: value ?? '', disabled: locked, placeholder: 'Type your answer', oninput: e => { value = e.target.value; onChange(value); } }); return { el: h('div', { class: 'field' }, i), get: () => value, mark() {} }; }
  if (q.type === 'multi') {
    const sel = new Set(Array.isArray(value) ? value : []);
    const opts = q.options.map((o, i) => h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: sel.has(i), disabled: locked, onchange: e => { e.target.checked ? sel.add(i) : sel.delete(i); value = [...sel].sort(); onChange(value); } }), h('span', o)));
    return { el: h('fieldset', { class: 'opts' }, h('legend', { class: 'sr' }, 'Choose all that apply'), h('p', { class: 'hint', style: { margin: '0 0 .3rem' } }, 'Choose all that apply.'), opts), get: () => value, mark(correct, given) { const want = new Set(correct); opts.forEach((o, i) => { if (want.has(i)) o.classList.add('correct'); else if (sel.has(i)) o.classList.add('wrong'); }); } };
  }
  const options = q.type === 'truefalse' ? ['True', 'False'] : q.options;
  const norm = v => (q.type === 'truefalse' ? (v === true ? 0 : v === false ? 1 : null) : v);
  const cur = norm(value);
  const opts = options.map((o, i) => h('label', { class: 'opt' }, h('input', { type: 'radio', name, checked: cur === i, disabled: locked, onchange: () => { value = q.type === 'truefalse' ? i === 0 : i; onChange(value); } }), h('span', o)));
  return { el: h('fieldset', { class: 'opts' }, h('legend', { class: 'sr' }, 'Choose one answer'), opts), get: () => value, mark(correct) { const ci = q.type === 'truefalse' ? (correct ? 0 : 1) : correct; opts.forEach((o, i) => { const checked = o.querySelector('input').checked; if (i === ci) o.classList.add('correct'); else if (checked) o.classList.add('wrong'); }); } };
}
const hasAnswer = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

route('/take/:id', async ({ params }) => {
  let P = await GET('/attempts/' + params.id);
  if (P.expired) { toast('Time was up. Your answers were submitted.', 'ok'); go('/attempt/' + params.id, true); return h('div'); }
  const a = P.assessment, att = P.attempt; setTitle(a.title);
  if (att.status !== 'in_progress') { go('/attempt/' + att.id, true); return h('div'); }
  const instant = a.kind === 'practice' || a.kind === 'adaptive', adaptive = a.kind === 'adaptive';
  const answers = new Map(P.questions.map(q => [q.id, q.answer])); const qs = P.questions.slice(); let idx = 0, submitting = false;
  const skew = P.server_time - Date.now(); const deadline = att.deadline ? att.deadline - skew : null;
  const stage = h('div'), nav = h('div', { class: 'qnav', role: 'group', 'aria-label': 'Questions' }), saved = h('span', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
  const timer = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Time left' }, deadline ? clock(deadline - Date.now()) : '');
  const pending = new Map(); let flushing = false;
  async function flush() {
    if (flushing) return; flushing = true;
    try { for (const [qid, v] of [...pending]) { await POST(`/attempts/${att.id}/answer`, { question_id: qid, answer: v }); if (pending.get(qid) === v) pending.delete(qid); } saved.textContent = pending.size ? 'Saving…' : 'All answers saved'; }
    catch (e) { if (e.code === 'time_up') return finish(true); saved.textContent = 'Not saved yet. Retrying…'; } finally { flushing = false; }
  }
  const retry = setInterval(() => { if (pending.size) flush(); }, 4000); onLeave(() => clearInterval(retry));
  const hb = setInterval(() => POST(`/attempts/${att.id}/heartbeat`).catch(() => {}), 25000); onLeave(() => clearInterval(hb));
  let monitor = null, warnEl = null;

  function drawNav() { mount(nav, qs.map((q, i) => h('button', { type: 'button', class: (hasAnswer(answers.get(q.id)) ? 'done ' : '') + (i === idx ? 'cur' : ''), 'aria-label': `Question ${i + 1}${hasAnswer(answers.get(q.id)) ? ', answered' : ''}`, 'aria-current': i === idx ? 'true' : null, onclick: () => { idx = i; draw(); } }, i + 1))); }
  function draw() {
    const q = qs[idx]; const given = answers.get(q.id); const fbk = q.feedback;
    const locked = instant && (fbk || q._fb);
    const box = h('div'); const fb = h('div', { 'aria-live': 'polite' });
    const inp = inputFor(q, v => { answers.set(q.id, v); if (!instant) { pending.set(q.id, v); saved.textContent = 'Saving…'; flush(); } drawNav(); if (instant) check.disabled = !hasAnswer(v); }, given, !!locked);
    const check = h('button', { class: 'btn primary', type: 'button', disabled: !hasAnswer(given) || !!locked, onclick: async () => {
      check.disabled = true;
      try {
        const x = await POST(`/attempts/${att.id}/answer`, { question_id: q.id, answer: answers.get(q.id) });
        q._fb = x; showFb(x);
        if (adaptive && x.next) { qs.push({ ...x.next, answer: null, feedback: null }); } if (adaptive && x.done) q._last = true;
        drawNav(); drawActions();
      } catch (e) { fail(e); check.disabled = false; }
    } }, 'Check answer');
    function showFb(x) { inp.mark && inp.mark(x.correct_answer); mount(fb, h('div', { class: 'feedback ' + (x.correct ? 'ok' : 'no') }, h('strong', x.correct ? 'Correct. ' : x.earned > 0 ? 'Partly right. ' : 'Not quite. '), x.explanation || (x.correct ? '' : 'Check the highlighted answer.'))); }
    if (locked) showFb(fbk || q._fb);
    mount(box, h('div', { class: 'q' }, h('div', { class: 'qmeta' }, `Question ${idx + 1}${adaptive ? '' : ' of ' + qs.length}`, q.topic && q.topic !== 'general' ? `, ${q.topic}` : '', q.points !== 1 ? `, ${q.points} points` : ''), h('h3', q.prompt), inp.el, instant && h('div', { class: 'row mt' }, check), fb));
    mount(stage, box); drawNav(); drawActions();
  }
  const actions = h('div', { class: 'row mt' });
  function drawActions() {
    const q = qs[idx], isLast = idx === qs.length - 1;
    const answeredAll = adaptive ? (q._last && (q.feedback || q._fb)) : null;
    mount(actions, !adaptive && idx > 0 && h('button', { class: 'btn', type: 'button', onclick: () => { idx--; draw(); } }, 'Previous'),
      adaptive ? (q.feedback || q._fb ? (answeredAll ? h('button', { class: 'btn good', type: 'button', onclick: () => finish(false) }, 'Finish and see results') : h('button', { class: 'btn primary', type: 'button', onclick: () => { idx++; draw(); } }, 'Next question')) : null)
        : !isLast ? h('button', { class: 'btn primary', type: 'button', onclick: () => { idx++; draw(); } }, 'Next') : null,
      !adaptive && (isLast || instant) && h('button', { class: 'btn good', type: 'button', onclick: () => finish(false) }, instant ? 'Finish and see results' : 'Submit answers'), saved);
  }
  async function finish(auto) {
    if (submitting) return;
    if (!auto) {
      await flush();
      const missing = qs.filter(q => !hasAnswer(answers.get(q.id))).length;
      if (!instant || missing) {
        const msg = missing ? `${missing} question${missing === 1 ? ' is' : 's are'} unanswered. ${a.compulsory ? 'This test is compulsory: you must answer every question.' : 'Unanswered questions score zero.'}` : 'Submit your answers now? You cannot change them afterwards.';
        if (!!a.compulsory && missing) { toast(msg, 'err'); const first = qs.findIndex(q => !hasAnswer(answers.get(q.id))); idx = first; draw(); return; }
        if (!(await confirmBox(msg, { yes: 'Submit', title: 'Submit your attempt?' }))) return;
      }
    }
    submitting = true;
    try {
      if (monitor) await monitor.stop();
      await flush();
      const x = await POST(`/attempts/${att.id}/submit`, {});
      (x.badges || []).forEach(b => toast(`New badge: ${b.icon} ${b.name}`, 'ok'));
      go('/attempt/' + att.id, true);
    } catch (e) { submitting = false; if (e.code === 'compulsory_incomplete') { toast(e.message, 'err'); return; } fail(e); }
  }
  const tick = setInterval(() => { if (!deadline) return; const left = deadline - Date.now(); timer.textContent = clock(left); timer.classList.toggle('low', left < 60000); if (left <= -2000 && !submitting) { clearInterval(tick); toast('Time is up. Submitting your answers.', 'err'); finish(true); } }, 500); onLeave(() => clearInterval(tick));

  const side = h('div', { class: 'side' });
  mount(side, deadline && h('div', h('div', { class: 'small muted' }, 'Time left'), timer), !adaptive && h('div', h('div', { class: 'small muted', style: { marginBottom: '.3rem' } }, 'Questions'), nav), adaptive && h('div', { class: 'small muted' }, `Question ${Math.min(idx + 1, a.adaptive_length)} of up to ${a.adaptive_length}`));
  draw();
  const wrap = h('div', { class: 'page' + (a.proctored ? '' : ' narrow') }, h('div', { class: 'page-head' }, h('div', h('h1', a.title), h('p', { class: 'sub' }, KIND[a.kind] + (a.compulsory ? ', compulsory' : '')))),
    h('div', { class: a.proctored ? 'exam' : '' }, h('div', stage, actions), a.proctored ? side : h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '1rem 0 0' } }, deadline && timer, !adaptive && nav)));
  if (a.proctored) {
    const camHolder = h('div'); side.prepend(camHolder);
    const { startMonitor } = await import('/js/proctor.js');
    startMonitor({ attemptId: att.id, holder: camHolder, degraded: att.precheck_degraded, onFatal: m => toast(m, 'err'), onWarn: m => {
      if (warnEl) warnEl.remove(); warnEl = h('div', { class: 'warnbar', role: 'alert' }, m); document.body.append(warnEl); setTimeout(() => warnEl && warnEl.remove(), 6000);
    } }).then(m => { monitor = m; onLeave(() => m.stop()); }).catch(e => { fail(e); });
  }
  window.addEventListener('beforeunload', guard); onLeave(() => window.removeEventListener('beforeunload', guard));
  return wrap;
});
function guard(e) { e.preventDefault(); e.returnValue = ''; }

/* ---------------- results ---------------- */
route('/attempt/:id', async ({ params }) => {
  const r = await GET(`/attempts/${params.id}/result`);
  const a = r.assessment; setTitle(a.title + ' results');
  const head = h('div', { class: 'page-head' }, h('div', h('h1', a.title), h('p', { class: 'sub' }, `${KIND[a.kind]}${r.attempt.submitted_at ? ', submitted ' + fmtDate(r.attempt.submitted_at) : ''}`)),
    h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/assessments/' + a.id }, 'Back to assessment')));
  if (r.pending_review || r.voided) return h('div', { class: 'page narrow' }, head, h('div', { class: 'banner ' + (r.voided ? 'err' : 'warn') }, h('p', r.message)),
    r.pending_review && h('div', { class: 'panel stack mt' }, h('h3', 'Something look wrong?'), h('p', 'If someone walked in, your internet dropped, or the camera misread you, tell your teacher here. They will see your note with the review.'),
      h('button', { class: 'btn', onclick: async () => { const m = await askText('Tell your teacher what happened', { placeholder: 'For example: my little brother came into the room for a moment…', yes: 'Send appeal', required: 5 }); if (m) try { await POST(`/proctor/attempts/${params.id}/appeal`, { message: m }); toast('Appeal sent to your teacher', 'ok'); } catch (e) { fail(e); } } }, 'Add a note for my teacher')));
  const res = r.result;
  const items = h('div');
  res.items.forEach((it, i) => {
    const ans = v => v === null || v === undefined ? 'No answer' : it.type === 'multi' ? (v || []).map(x => it.options[x]).join('; ') : it.type === 'mcq' ? it.options[v] : it.type === 'truefalse' ? (v ? 'True' : 'False') : String(v);
    items.append(h('div', { class: 'q' }, h('div', { class: 'qmeta' }, `Question ${i + 1}, ${it.topic}, ${it.earned}/${it.points}`), h('h3', it.prompt),
      h('p', h('span', { class: 'chip ' + (it.correct ? 'leaf' : it.answered ? 'ember' : 'plain') }, it.correct ? 'Correct' : it.answered ? (it.earned > 0 ? 'Partly right' : 'Incorrect') : 'Not answered'), ' Your answer: ', h('strong', ans(it.your_answer))),
      it.correct_answer !== undefined && !it.correct && h('p', 'Correct answer: ', h('strong', ans(it.correct_answer))), it.explanation && h('p', { class: 'muted' }, it.explanation)));
  });
  return h('div', { class: 'page narrow' }, head,
    h('div', { class: 'scorebox' }, h('div', h('div', { class: 'pct ' + (res.passed ? 'pass' : 'fail') }, Math.round(res.percent) + '%'), h('div', { class: 'small muted' }, `${res.score} of ${res.max_score} points`)),
      h('div', h('strong', res.passed ? 'Passed' : 'Not passed yet'), h('p', { class: 'muted', style: { margin: 0 } }, `Pass mark is ${a.pass_mark}%.`, res.passed ? ' Well done!' : ' Review the explanations and try again.'))),
    r.attempt.proctor_status && r.attempt.proctor_status !== 'none' && r.attempt.risk !== undefined && h('p', { class: 'small muted' }, `Proctoring status: ${r.attempt.proctor_status}, risk score ${r.attempt.risk}.`),
    !res.reveal && a.kind !== 'practice' && h('div', { class: 'banner mt' }, h('p', 'Your teacher has chosen not to show correct answers for this assessment.')),
    Object.keys(res.topics).length > 1 && h('section', { class: 'block' }, h('h2', 'By topic'), Object.entries(res.topics).map(([t, v]) => h('div', { class: 'topic' }, h('span', { class: 'name' }, t), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: Math.round(100 * v.correct / v.total) + '%', background: v.correct / v.total < .5 ? 'var(--ember)' : v.correct / v.total < .8 ? 'var(--sun)' : 'var(--leaf)' } })), h('span', { class: 'small muted' }, `${v.correct}/${v.total}`)))),
    r.attempt.risk === undefined && h('section', { class: 'block' }, h('h2', 'Study Buddy'), studyBuddy(params.id, res)),
    h('section', { class: 'block' }, h('h2', 'Review your answers'), items));
});

function studyBuddy(attemptId, res) {
  const log = h('div', { class: 'msgs', style: { maxHeight: '340px' }, role: 'log', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', 'aria-label': 'Ask Study Buddy', placeholder: 'Ask about a question, or for a hint…', maxlength: 500 });
  const say = (who, text) => { log.append(h('div', { class: 'msg' + (who === 'me' ? ' me' : '') }, h('div', { class: 'who' }, who === 'me' ? 'You' : 'Study Buddy'), h('div', { class: 'bubble' }, text))); log.scrollTop = log.scrollHeight; };
  const send = async text => {
    text = (text || input.value).trim(); if (!text) return; input.value = ''; say('me', text); btn.disabled = true;
    const typing = h('div', { class: 'small muted' }, 'Study Buddy is thinking…'); log.append(typing);
    try { const x = await POST(`/attempts/${attemptId}/feedback`, { message: text }); typing.remove(); say('bot', x.reply); } catch (e) { typing.remove(); say('bot', e.message); } finally { btn.disabled = false; input.focus(); }
  };
  const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('send'), h('span', { class: 'sr' }, 'Send'));
  GET(`/attempts/${attemptId}/feedback`).then(x => { if (x.messages.length) x.messages.forEach(m => say(m.role === 'user' ? 'me' : 'bot', m.content)); else { const wrong = res.items.findIndex(i => i.answered && !i.correct); say('bot', `Hi ${S.user.name.split(' ')[0]}! I can explain any question, give a hint, or suggest what to study next.${wrong >= 0 ? ` Want to start with question ${wrong + 1}?` : ''}`); } }).catch(() => {});
  const chips = ['Explain my mistakes', 'Give me a hint', 'What should I study next?'].map(t => h('button', { class: 'btn sm', type: 'button', onclick: () => send(t === 'Explain my mistakes' ? `explain question ${Math.max(1, res.items.findIndex(i => i.answered && !i.correct) + 1)}` : t) }, t));
  return h('div', { class: 'convo', style: { minHeight: '0' } }, log, h('div', { class: 'row', style: { padding: '0 .7rem' } }, chips), h('form', { class: 'composer', onsubmit: ev => { ev.preventDefault(); send(); } }, input, btn));
}

/* ---------------- teacher: results for one assessment ---------------- */
route('/results/:id', async ({ params }) => {
  const r = await GET(`/assessments/${params.id}/results`); setTitle(r.assessment.title + ' results');
  return h('div', { class: 'page wide' }, h('div', { class: 'crumbs' }, h('a', { href: '#/assessments/' + params.id }, r.assessment.title)),
    h('div', { class: 'page-head' }, h('div', h('h1', 'Results'), h('p', { class: 'sub' }, `${r.attempts.length} attempt${r.attempts.length === 1 ? '' : 's'}${r.average_percent !== null ? `, average ${r.average_percent}%, pass rate ${r.pass_rate}%` : ''}`))),
    h('section', { class: 'block', style: { marginTop: 0 } }, h('h2', 'Learners'), r.attempts.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', h('tr', ['Learner', 'Score', 'Result', 'Submitted', r.assessment.proctored ? 'Proctoring' : null, ''].filter(x => x !== null).map(x => h('th', x)))),
      h('tbody', r.attempts.map(x => h('tr', h('td', x.name), h('td', x.percent === null ? '' : x.percent + '%'), h('td', x.status === 'voided' ? h('span', { class: 'chip ember' }, 'Invalidated') : x.passed ? h('span', { class: 'chip leaf' }, 'Passed') : h('span', { class: 'chip plain' }, 'Not passed')), h('td', x.submitted_at ? ago(x.submitted_at) : ''),
        !!r.assessment.proctored && h('td', h('span', { class: 'chip ' + (x.proctor_status === 'flagged' ? 'ember' : x.proctor_status === 'review' ? 'sun' : 'leaf') }, `${x.proctor_status}, risk ${x.risk}`)), h('td', h('a', { class: 'btn sm', href: r.assessment.proctored ? '#/proctor/' + x.id : '#/attempt/' + x.id }, r.assessment.proctored ? 'Review' : 'Open'))))))) : empty('No submissions yet')),
    r.not_submitted.length > 0 && h('section', { class: 'block' }, h('h2', 'Not submitted yet'), h('p', r.not_submitted.map(s => s.name).join(', '))),
    h('section', { class: 'block' }, h('h2', 'Question difficulty'), h('p', { class: 'muted' }, 'Low percentages show where the class needs reteaching.'), h('div', { class: 'list' }, r.question_stats.map((q, i) => h('div', { class: 'item' }, h('span', { class: 'chip plain' }, i + 1), h('div', { class: 'grow' }, h('strong', q.prompt), h('span', { class: 'meta' }, `${q.topic}, ${q.answered} answered`)), h('div', { style: { width: '120px' } }, h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: (q.percent_correct || 0) + '%', background: (q.percent_correct ?? 100) < 50 ? 'var(--ember)' : 'var(--leaf)' } }))), h('span', { class: 'small', style: { width: '3rem', textAlign: 'right' } }, q.percent_correct === null ? '' : q.percent_correct + '%'))))));
});
