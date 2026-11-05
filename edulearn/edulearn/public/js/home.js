import { S, h, mount, GET, POST, PUT, DEL, toast, fail, icon, loading, empty, errorBox, setTitle, fmtDate, ago, gradeLabel, KIND, confirmBox, dialog, applyPrefs, setSession, api } from './core.js';
import { route, go } from './router.js';
import { faceCapture, afterAuth } from './auth.js';
import * as F from './face.js';
import { courseSpine } from './learn.js';

const lvlBar = (xp, floor, next) => { const p = Math.max(0, Math.min(100, Math.round(100 * (xp - floor) / Math.max(1, next - floor)))); return h('div', { class: 'stack tight', style: { minWidth: '220px', flex: '1 1 260px' } }, h('div', { class: 'track xp', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Progress to next level' }, h('div', { class: 'fill', style: { width: p + '%' } })), h('span', { class: 'small muted' }, `${(next - xp).toLocaleString()} XP to level ${Math.floor(Math.sqrt(next / 40)) + 1}`)); };
const levelMark = lv => h('div', { class: 'level-ring', role: 'img', 'aria-label': 'Level ' + lv }, h('b', lv));

/* ---------------- dashboard ---------------- */
route('/', async () => {
  setTitle('Home');
  const d = await GET('/dashboard'), u = S.user, first = u.name.split(' ')[0];
  const greet = h('div', { class: 'page-head' }, h('div', h('h1', `Hello, ${first}`), h('p', { class: 'sub' }, { student: 'Ready to learn something today?', educator: 'Here is how your classes are doing.', creator: 'Here is how your courses are doing.', admin: 'Platform overview.', moderator: 'Platform overview.' }[u.role])));
  if (u.role === 'student') {
    const g = await GET('/gamification/me');
    return h('div', { class: 'page' }, greet,
      u.minor && !u.guardian_consent && u.face_enrolled === false ? null : null,
      h('div', { class: 'row', style: { gap: '1.5rem', alignItems: 'center' } }, levelMark(g.level), lvlBar(g.xp, g.level_floor, g.next_level_xp), h('div', { class: 'figures' }, h('div', { class: 'fig' }, h('b', g.xp.toLocaleString()), h('span', 'XP')), h('div', { class: 'fig' }, h('b', g.streak), h('span', g.streak === 1 ? 'day streak' : 'day streak')))),
      d.classrooms === 0 && h('div', { class: 'banner mt' }, h('p', h('strong', 'Join your class. '), 'Ask your teacher for a classroom code to see assigned tests and chat with classmates.'), h('a', { class: 'btn primary', href: '#/classes' }, 'Enter a code')),
      d.due.length > 0 && h('section', { class: 'block' }, h('h2', 'Due soon'), h('div', { class: 'list' }, d.due.map(a => h('a', { class: 'item', href: '#/assessments/' + a.id }, h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, `${a.classroom}${a.closes_at ? ', closes ' + fmtDate(a.closes_at) : ''}`)), h('span', { class: 'chip ' + (a.kind === 'exam' ? 'ember' : 'sun') }, KIND[a.kind]), !!a.proctored && h('span', { class: 'chip ember' }, 'Proctored'))))),
      h('section', { class: 'block' }, h('h2', 'Keep going', h('a', { class: 'more', href: '#/courses' }, 'Browse all courses')), d.continue.length ? h('div', { class: 'spines' }, d.continue.map(c => h('a', { class: 'spine', href: c.next_lesson ? '#/lessons/' + c.next_lesson : '#/courses/' + c.id, style: { '--c': c.cover_color } }, h('span', { class: 'chip' }, gradeLabel(c.grade_level)), h('h3', c.title), h('div', { class: 'track thin' }, h('div', { class: 'fill', style: { width: Math.round(100 * c.done / c.total) + '%' } })), h('span', { class: 'small muted' }, `${c.done} of ${c.total} lessons`)))) : empty('Start your first course', 'Pick a grade and subject you like.', h('a', { class: 'btn primary', href: '#/courses' }, 'Find a course'))),
      d.focus_topic && h('div', { class: 'banner warn mt' }, h('p', h('strong', 'Suggested focus: '), `${d.focus_topic}. It is your weakest topic so far. Try an adaptive quiz to practise it.`), h('a', { class: 'btn', href: '#/assessments' }, 'See quizzes')),
      d.recent.length > 0 && h('section', { class: 'block' }, h('h2', 'Recent results', h('a', { class: 'more', href: '#/progress' }, 'All progress')), h('div', { class: 'list' }, d.recent.map(r => h('a', { class: 'item', href: '#/attempt/' + r.id }, h('div', { class: 'grow' }, h('strong', r.title), h('span', { class: 'meta' }, `${KIND[r.kind]}, ${ago(r.submitted_at)}`)), r.percent === null ? h('span', { class: 'chip sun' }, 'Held for review') : h('span', { class: 'chip ' + (r.passed ? 'leaf' : 'plain') }, r.percent + '%'))))));
  }
  if (u.role === 'educator') return h('div', { class: 'page' }, greet,
    !u.school && h('div', { class: 'banner warn' }, h('p', 'Choose or create your school profile to start making classrooms.'), h('a', { class: 'btn primary', href: '#/classes' }, 'Set up school')),
    h('div', { class: 'figures' }, h('div', { class: 'fig' }, h('b', d.students), h('span', 'students')), h('div', { class: 'fig' }, h('b', d.classrooms.length), h('span', 'active classes')), h('div', { class: 'fig' }, h('b', d.my_courses), h('span', 'courses')), h('div', { class: 'fig' }, h('b', d.my_assessments), h('span', 'assessments'))),
    d.to_review > 0 && h('div', { class: 'banner warn mt' }, h('p', h('strong', `${d.to_review} exam attempt${d.to_review > 1 ? 's' : ''} `), 'flagged by proctoring need your review.'), h('a', { class: 'btn primary', href: '#/proctor' }, 'Review now')),
    h('section', { class: 'block' }, h('h2', 'Your classes', h('a', { class: 'more', href: '#/classes' }, 'Manage')), d.classrooms.length ? h('div', { class: 'list' }, d.classrooms.map(c => h('a', { class: 'item', href: '#/classes/' + c.id }, h('div', { class: 'grow' }, h('strong', c.name), h('span', { class: 'meta' }, `${c.students} student${c.students === 1 ? '' : 's'}`)), h('span', { class: 'chip plain', 'aria-label': 'Class code' }, 'Code ' + c.code)))) : empty('No classes yet', 'Create a class to get a code your students can enter.', h('a', { class: 'btn primary', href: '#/classes' }, 'Create a class'))),
    h('div', { class: 'row mt2' }, h('a', { class: 'btn', href: '#/studio' }, icon('pencil'), 'Open Studio'), h('a', { class: 'btn', href: '#/community' }, icon('chat'), 'Community')));
  if (u.role === 'creator') return h('div', { class: 'page' }, greet, h('div', { class: 'figures' }, h('div', { class: 'fig' }, h('b', d.total_learners), h('span', 'learners')), h('div', { class: 'fig' }, h('b', d.my_courses.length), h('span', 'courses'))),
    h('section', { class: 'block' }, h('h2', 'Your courses', h('a', { class: 'more', href: '#/studio' }, 'Open Studio')), d.my_courses.length ? h('div', { class: 'list' }, d.my_courses.map(c => h('a', { class: 'item', href: '#/studio/course/' + c.id }, h('div', { class: 'grow' }, h('strong', c.title), h('span', { class: 'meta' }, `${c.lessons} lessons, ${c.learners} learners${c.review_notes ? '. Reviewer: ' + c.review_notes : ''}`)), h('span', { class: 'chip ' + (c.status === 'published' ? 'leaf' : 'sun') }, { published: 'Published', pending: 'In review', draft: 'Draft' }[c.status])))) : empty('Publish your first course', 'Add lessons, quizzes and 3D models. A moderator reviews it before learners see it.', h('a', { class: 'btn primary', href: '#/studio' }, 'Create a course'))));
  return h('div', { class: 'page' }, greet, h('div', { class: 'figures' }, h('div', { class: 'fig' }, h('b', d.users), h('span', 'users')), h('div', { class: 'fig' }, h('b', d.pending_courses), h('span', 'courses to review')), h('div', { class: 'fig' }, h('b', d.open_reports), h('span', 'open reports'))),
    h('div', { class: 'row mt2' }, h('a', { class: 'btn primary', href: '#/admin' }, icon('shield'), 'Open admin'), h('a', { class: 'btn', href: '#/proctor' }, 'Proctor review')));
});

/* ---------------- progress ---------------- */
route('/progress', async () => {
  setTitle('Progress');
  const [g, att] = await Promise.all([GET('/gamification/me'), GET('/attempts')]);
  const max = Math.max(1, ...g.week.map(x => x.xp));
  return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Your progress'), h('p', { class: 'sub' }, 'XP, badges and what to practise next.'))),
    h('div', { class: 'row', style: { gap: '1.5rem' } }, levelMark(g.level), lvlBar(g.xp, g.level_floor, g.next_level_xp), h('div', { class: 'figures' }, h('div', { class: 'fig' }, h('b', g.xp.toLocaleString()), h('span', 'XP')), h('div', { class: 'fig' }, h('b', g.streak), h('span', 'day streak')), h('div', { class: 'fig' }, h('b', g.best_streak), h('span', 'best streak')))),
    g.week.length > 0 && h('section', { class: 'block' }, h('h2', 'XP this week'), h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '.5rem', height: '110px' }, role: 'img', 'aria-label': 'XP per day this week' }, g.week.map(d => h('div', { style: { textAlign: 'center', flex: '0 0 44px' } }, h('div', { style: { height: Math.max(6, Math.round(80 * d.xp / max)) + 'px', background: 'var(--sun)', borderRadius: '4px 4px 0 0' }, title: d.xp + ' XP' }), h('div', { class: 'small muted' }, d.d.slice(5)))))),
    h('section', { class: 'block' }, h('h2', 'Topic mastery'), g.mastery.length ? h('div', g.mastery.map(m => h('div', { class: 'topic' }, h('span', { class: 'name' }, m.topic), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: Math.round((m.rating - 100) / 9) + '%', background: m.level === 'Strong' ? 'var(--leaf)' : m.level === 'Developing' ? 'var(--sun)' : 'var(--ember)' } })), h('span', { class: 'small muted', style: { width: '9rem' } }, `${m.level}, ${m.correct}/${m.answered}`)))) : empty('No topic data yet', 'Take a quiz and your strengths and weak spots appear here.', h('a', { class: 'btn primary', href: '#/assessments' }, 'Find a quiz'))),
    h('section', { class: 'block' }, h('h2', 'Badges'), h('div', { class: 'badges' }, g.badges.map(b => h('div', { class: 'badge' + (b.earned ? '' : ' locked'), title: b.desc }, h('span', { class: 'ic', 'aria-hidden': 'true' }, b.icon), h('strong', b.name), h('small', b.desc), !!b.earned && h('small', 'Earned ' + ago(b.earned_at)))))),
    att.attempts.length > 0 && h('section', { class: 'block' }, h('h2', 'History'), h('div', { class: 'list' }, att.attempts.slice(0, 20).map(a => h('a', { class: 'item', href: a.status === 'in_progress' ? '#/take/' + a.id : '#/attempt/' + a.id }, h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, `${KIND[a.kind]}, ${fmtDate(a.started_at)}`)), a.status === 'in_progress' ? h('span', { class: 'chip sun' }, 'In progress') : a.status === 'voided' ? h('span', { class: 'chip ember' }, 'Invalidated') : a.percent === null ? h('span', { class: 'chip sun' }, 'Held') : h('span', { class: 'chip ' + (a.passed ? 'leaf' : 'plain') }, a.percent + '%'))))));
});

/* ---------------- notifications ---------------- */
route('/notifications', async () => {
  setTitle('Notifications');
  const r = await GET('/notifications');
  if (r.unread) { POST('/notifications/read', {}).then(() => { S.unread = 0; document.dispatchEvent(new Event('edu:unread')); }).catch(() => {}); }
  return h('div', { class: 'page narrow' }, h('div', { class: 'page-head' }, h('h1', 'Notifications')),
    r.notifications.length ? h('div', { class: 'list' }, r.notifications.map(n => h(n.link ? 'a' : 'div', { class: 'item', href: n.link || null }, h('div', { class: 'grow' }, h('strong', n.title), n.body && h('span', { class: 'meta' }, n.body), h('span', { class: 'meta' }, ago(n.created_at))), !n.is_read && h('span', { class: 'chip sun' }, 'New')))) : empty('You are all caught up', 'New results, class updates and replies show up here.'));
});

/* ---------------- settings ---------------- */
route('/settings', async () => {
  setTitle('Settings');
  await afterAuth(); const u = S.user, st = u.settings || {};
  const save = async patch => { try { const r = await PUT('/auth/me', patch); S.user = r.user; applyPrefs(r.user); toast('Saved', 'ok'); return r.user; } catch (e) { fail(e); } };
  const name = h('input', { id: 's-name', value: u.name, maxlength: 80 });
  const lang = h('select', { id: 's-lang' }, S.meta.languages.map(l => h('option', { value: l.key, selected: l.key === u.lang }, l.label)));
  const scale = h('input', { type: 'range', id: 's-scale', min: 0.9, max: 1.4, step: 0.05, value: st.font_scale || 1, 'aria-label': 'Text size', oninput: e => { document.documentElement.style.fontSize = e.target.value * 100 + '%'; }, onchange: e => save({ settings: { font_scale: Number(e.target.value) } }) });
  const toggle = (label, key, hint) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!st[key], onchange: e => save({ settings: { [key]: e.target.checked } }) }), h('span', h('strong', label), hint && h('span', { class: 'hint', style: { display: 'block' } }, hint)));
  const theme = h('select', { id: 's-theme', onchange: e => save({ settings: { theme: e.target.value } }) }, [['', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: (st.theme || '') === v }, l)));
  const faceBox = h('div', { class: 'stack' }); const idBox = h('div', { class: 'stack' });

  function drawFace() {
    const needsGuardian = u.minor && !u.guardian_consent;
    mount(faceBox, h('p', 'Face verification protects your account and is required for proctored exams. We keep an encrypted numeric template, never a photo, and you can delete it any time.'),
      u.face_enrolled ? h('div', { class: 'stack tight' }, h('div', { class: 'banner ok' }, h('p', h('strong', 'Face enrolled. '), u.identity_verified ? 'Your identity is also verified against your ID card.' : 'You can also match it against your school ID.')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: u.face_login, onchange: async e => { const r = await save({ face_login: e.target.checked }); if (!r) e.target.checked = !e.target.checked; } }), h('span', h('strong', 'Require face verification when I sign in'))),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: enroll }, 'Re-enroll'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('This deletes your face template. You will not be able to sit proctored exams until you enroll again.', { yes: 'Delete face data', danger: true })) try { const r = await DEL('/auth/face'); S.user = r.user; toast('Face data deleted', 'ok'); go('/settings', true); location.reload(); } catch (e) { fail(e); } } }, 'Delete face data')))
        : needsGuardian ? h('div', { class: 'banner warn' }, h('p', 'Because you are under 18, your teacher must first confirm that a parent or guardian agreed. Ask your teacher to confirm this in your class list.'))
        : h('button', { class: 'btn primary', onclick: enroll }, icon('camera'), 'Enroll my face'));
    mount(idBox, !u.face_enrolled ? h('p', { class: 'muted' }, 'Enroll your face first to match it with an ID card.') : u.identity_verified ? h('div', { class: 'banner ok' }, h('p', 'ID match complete.')) : h('div', { class: 'stack tight' }, h('p', 'Take or upload a clear photo of your school or national ID, showing your face. The photo is read on this device; only a numeric template of the face is compared, and the picture is not uploaded.'),
      h('input', { type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': 'Photo of ID card', onchange: idMatch }), h('p', { class: 'small', id: 'id-msg', role: 'status' })));
  }
  async function enroll() {
    const proceed = async () => {
      const cap = faceCapture({ title: 'Enroll your face', samples: 5, doLiveness: true,
        onDone: async ({ descriptors, liveness }) => { const r = await POST('/auth/face/enroll', { consent: true, descriptors, liveness }); S.user = r.user; dlg.close(); toast('Face enrolled', 'ok'); go('/settings', true); location.reload(); },
        onCancel: () => dlg.close() });
      const dlg = dialog({ body: cap.el, onClose: () => cap.cleanup() });
    };
    if (u.consent_biometric) return proceed();
    dialog({ title: 'Consent for face verification', body: h('div', { class: 'stack' }, h('p', 'We will use your camera to confirm who you are when you sign in and when you sit proctored exams.'), h('ul', h('li', 'We store an encrypted numeric template, not a photo.'), h('li', 'You can delete it any time in Settings.'), h('li', 'Teachers see exam pictures only when something is flagged.'))), actions: [{ label: 'Not now' }, { label: 'I agree', kind: 'primary', onClick: () => { proceed(); } }] });
  }
  async function idMatch(ev) {
    const file = ev.target.files[0]; if (!file) return; const msg = document.getElementById('id-msg'); const say = t => { msg.textContent = t; };
    try {
      say('Loading…'); const f = await F.loadModels(); const url = URL.createObjectURL(file); const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That image could not be opened.')); img.src = url; });
      say('Reading the face on your ID…'); const det = await f.detectSingleFace(img, new f.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 })).withFaceLandmarks(true).withFaceDescriptor(); URL.revokeObjectURL(url);
      if (!det) return say('No face was found on the ID photo. Use a sharp, well-lit picture of the whole card.');
      const r = await POST('/auth/face/identity-match', { id_descriptor: Array.from(det.descriptor) });
      if (r.match) { S.user = r.user; toast('Identity verified', 'ok'); location.reload(); } else say('The face on the ID did not match your enrolled face. Try a clearer photo, or ask your teacher to verify you in person.');
    } catch (e) { say(e.message); }
  }
  drawFace();

  const pwForm = h('form', { class: 'stack', onsubmit: async ev => { ev.preventDefault(); try { await POST('/auth/password', { current: ev.target.cur.value, next: ev.target.nw.value }); toast('Password changed', 'ok'); ev.target.reset(); } catch (e) { fail(e); } } },
    h('div', { class: 'fields' }, h('div', { class: 'field' }, h('label', { for: 'p1' }, 'Current password'), h('input', { id: 'p1', name: 'cur', type: 'password', autocomplete: 'current-password', required: true })), h('div', { class: 'field' }, h('label', { for: 'p2' }, 'New password'), h('input', { id: 'p2', name: 'nw', type: 'password', autocomplete: 'new-password', minlength: 8, required: true }))), h('div', h('button', { class: 'btn', type: 'submit' }, 'Change password')));

  return h('div', { class: 'page narrow' }, h('div', { class: 'page-head' }, h('h1', 'Settings')),
    h('section', { class: 'block', style: { marginTop: 0 } }, h('h2', 'Profile'), h('div', { class: 'stack' }, h('div', { class: 'fields' }, h('div', { class: 'field' }, h('label', { for: 's-name' }, 'Name'), name), h('div', { class: 'field' }, h('label', { for: 's-lang' }, 'Language'), lang)), h('p', { class: 'muted small' }, `${u.email}, ${u.role}${u.school ? ', ' + u.school.name : ''}${u.grade_level ? ', ' + gradeLabel(u.grade_level) : ''}`), h('div', h('button', { class: 'btn primary', onclick: async () => { const r = await save({ name: name.value, lang: lang.value }); if (r) location.reload(); } }, 'Save profile')))),
    h('section', { class: 'block' }, h('h2', 'Accessibility and display'), h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 's-scale' }, 'Text size'), scale), h('div', { class: 'field', style: { maxWidth: '260px' } }, h('label', { for: 's-theme' }, 'Theme'), theme), toggle('High contrast', 'high_contrast', 'Stronger borders and text colours.'), toggle('Dyslexia-friendly font', 'dyslexia_font', 'Uses OpenDyslexic with extra spacing.'), toggle('Reduce motion', 'reduce_motion', 'Turns off animations.'))),
    u.role === 'student' && h('section', { class: 'block' }, h('h2', 'Privacy'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: u.show_on_leaderboard, onchange: e => save({ show_on_leaderboard: e.target.checked }) }), h('span', h('strong', 'Show me on leaderboards'), h('span', { class: 'hint', style: { display: 'block' } }, 'Others only see your first name and initial.')))),
    h('section', { class: 'block' }, h('h2', 'Face verification'), faceBox), u.role === 'student' && h('section', { class: 'block' }, h('h2', 'ID match'), idBox),
    h('section', { class: 'block' }, h('h2', 'Password'), pwForm),
    h('section', { class: 'block' }, h('h2', 'Your data'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { try { const r = await GET('/auth/export'); const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })), download: 'my-edulearn-data.json' }); document.body.append(a); a.click(); a.remove(); } catch (e) { fail(e); } } }, 'Download my data'),
      u.role !== 'admin' && h('button', { class: 'btn danger', onclick: () => { const pw = h('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'current-password' }); dialog({ title: 'Delete your account', body: h('div', { class: 'stack' }, h('p', 'This removes your profile, face data and class membership. It cannot be undone.'), h('div', { class: 'field' }, h('label', 'Enter your password to confirm'), pw)), actions: [{ label: 'Cancel' }, { label: 'Delete my account', kind: 'danger solid', onClick: async () => { await api('DELETE', '/auth/me', { password: pw.value }); setSession(null, null); S.user = null; location.hash = '#/login'; location.reload(); } }] }); } }, 'Delete my account'))));
});
