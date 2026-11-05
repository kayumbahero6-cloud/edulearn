import { S, h, mount, GET, POST, api, toast, fail, setSession, debounce, store, $ } from './core.js';
import { go } from './router.js';
import * as F from './face.js';

/* ---------- shared face capture UI (used for sign-in, enrolment, ID match) ---------- */
export function faceCapture({ title, purpose = 'verify', samples = 1, doLiveness = true, onDone, onCancel }) {
  const video = h('video', { autoplay: true, playsinline: true, muted: true, 'aria-label': 'Camera preview' });
  const msg = h('p', { class: 'center', role: 'status', 'aria-live': 'polite' }, 'Starting the camera…');
  const start = h('button', { class: 'btn primary', type: 'button' }, 'Start');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => { cleanup(); onCancel && onCancel(); } }, 'Cancel');
  let stream; const cleanup = () => F.stopCamera(stream);
  const say = t => { msg.textContent = t; };
  const root = h('div', { class: 'stack' }, title && h('h2', title), h('div', { class: 'cam' }, video), msg, h('div', { class: 'row' }, start, cancel),
    h('p', { class: 'hint' }, 'Your photo stays on this device. Only a numeric face template is sent, encrypted at rest.'));
  (async () => {
    try { say('Loading face models (first time only)…'); await F.loadModels(); stream = await F.startCamera(video); say('Ready. Make sure your face is well lit, then press Start.'); }
    catch (e) { say(e.message); start.disabled = true; }
  })();
  start.onclick = async () => {
    start.disabled = true;
    try {
      let live = { passed: true };
      if (doLiveness) { live = await F.liveness(video, say); if (!live.passed) { say('We could not confirm a live person. Face the light, remove glasses or a hat if you can, and try again.'); start.disabled = false; return; } }
      const d = await F.sampleDescriptors(video, samples, say);
      if (d.length < samples) { say('We could not get a clear capture. Try again in better light.'); start.disabled = false; return; }
      say('Checking…'); await onDone({ descriptors: d, descriptor: d[0], liveness: live }); cleanup();
    } catch (e) { say(e.message); fail(e); start.disabled = false; }
  };
  return { el: root, cleanup };
}

/* ---------- login ---------- */
export function loginPage() {
  const email = h('input', { type: 'email', id: 'em', autocomplete: 'username', required: true, autofocus: true });
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'banner err hide', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
  const panel = h('div');
  const form = h('form', { class: 'stack', onsubmit: async ev => {
    ev.preventDefault(); err.classList.add('hide'); btn.disabled = true;
    try {
      const r = await POST('/auth/login', { email: email.value, password: pw.value }, { noAuthRedirect: true });
      if (r.step_up === 'face') return faceStep(r.token, r.user);
      await finish(r.token, r.user);
    } catch (e) { err.textContent = e.message; err.classList.remove('hide'); } finally { btn.disabled = false; }
  } },
  h('div', { class: 'field' }, h('label', { for: 'em' }, 'Email'), email), h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Password'), pw), err, btn);
  function faceStep(token, user) {
    const cap = faceCapture({ title: `Welcome back, ${user.name.split(' ')[0]}`, doLiveness: true, samples: 1,
      onDone: async ({ descriptor, liveness }) => { const r = await POST('/auth/face/verify', { descriptor, liveness, purpose: 'login' }, { token }); await finish(r.token, r.user); },
      onCancel: () => mount(panel, form) });
    mount(panel, h('div', { class: 'banner' }, h('p', 'Your account uses face verification. Look at the camera to finish signing in.')), cap.el);
  }
  async function finish(token, user) { setSession(token, user); await afterAuth(); go('/', true); }
  mount(panel, form);
  return authLayout('Sign in', 'Pick up where you left off.', panel, h('p', { class: 'center' }, 'New here? ', h('a', { href: '#/register' }, 'Create an account')), demoHint(email, pw));
}
function demoHint(email, pw) {
  return h('details', { class: 'small muted' }, h('summary', 'Demo accounts'),
    h('p', 'Password for all: ', h('code', 'Demo1234')),
    h('div', { class: 'row' }, ['student', 'adult', 'kid', 'teacher', 'creator', 'moderator', 'admin'].map(n => h('button', { class: 'btn sm', type: 'button', onclick: () => { email.value = n + '@edulearn.demo'; pw.value = 'Demo1234'; } }, n))));
}

function authLayout(title, lead, ...kids) {
  return h('div', { class: 'auth' },
    h('div', { class: 'hero' }, h('div', { class: 'say' }, h('h1', 'EduLearn'), h('p', 'Lessons from pre-nursery to A-Level, quizzes that adapt to you, and tutors that explain. Built for learners, teachers and creators across Rwanda and East Africa.'))),
    h('main', { class: 'form', id: 'main' }, h('div', { class: 'stack' }, h('div', h('h2', { style: { fontSize: '1.8rem' } }, title), h('p', { class: 'muted' }, lead)), ...kids)));
}

/* ---------- register ---------- */
export function registerPage() {
  const st = { role: 'student', newSchool: false };
  const body = h('div');
  const roles = [['student', 'Student', 'Learn, take quizzes, join a class'], ['educator', 'Educator', 'Run classes, set tests, review results'], ['creator', 'Creator', 'Publish your own courses']];
  const f = {};
  const inp = (id, label, attrs = {}, hint) => { f[id] = h(attrs.tag || 'input', { id: 'r-' + id, ...attrs }); return h('div', { class: 'field' }, h('label', { for: 'r-' + id }, label), f[id], hint && h('span', { class: 'hint' }, hint)); };
  const err = h('div', { class: 'banner err hide', role: 'alert' });
  let schools = []; const schoolSel = h('select', { id: 'r-school', 'aria-label': 'School' }, h('option', { value: '' }, 'Choose from the list'));
  const schoolSearch = h('input', { type: 'search', placeholder: 'Search schools…', 'aria-label': 'Search schools' });
  const loadSchools = async () => { schools = (await GET('/schools?q=' + encodeURIComponent(schoolSearch.value))).schools; const cur = schoolSel.value; mount(schoolSel, h('option', { value: '' }, schools.length ? 'Choose from the list' : 'No match'), schools.map(s => h('option', { value: s.id }, `${s.name}${s.district ? ', ' + s.district : ''}${s.verified ? ' ✓' : ''}`))); schoolSel.value = cur; };
  schoolSearch.addEventListener('input', debounce(loadSchools, 250)); loadSchools().catch(() => {});
  const nsName = h('input', { id: 'r-nsn', placeholder: 'School name' }), nsDist = h('input', { id: 'r-nsd', placeholder: 'District' });
  const nsType = h('select', { id: 'r-nst' }, [['school', 'School'], ['university', 'University'], ['training-centre', 'Training centre / TVET'], ['other', 'Other']].map(([v, l]) => h('option', { value: v }, l)));

  function render() {
    const student = st.role === 'student', edu = st.role === 'educator';
    const guardian = inp('guardian', 'Parent or guardian email / phone', { required: false }, 'Required for learners under 18. Used only for consent and safety.');
    const guardianWrap = h('div', { class: 'hide', id: 'gwrap' }, guardian);
    const by = inp('birth', 'Birth year', { type: 'number', min: 1950, max: new Date().getFullYear(), inputmode: 'numeric', required: true });
    by.querySelector('input').addEventListener('input', () => { const y = Number(f.birth.value); guardianWrap.classList.toggle('hide', !(y && new Date().getFullYear() - y < 18)); });
    const gradeSel = h('select', { id: 'r-grade', required: true }, h('option', { value: '' }, 'Choose your grade'), S.meta.grades.map(g => h('option', { value: g.key }, g.label)));
    f.grade = gradeSel;
    const newToggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { st.newSchool = e.target.checked; render(); }, checked: st.newSchool }), h('span', 'My school is not on the list. Create a new school profile.'));
    const schoolBlock = h('div', { class: 'stack tight' }, h('div', { class: 'field' }, h('label', { for: 'r-school' }, edu ? 'Your school' : 'Your school (optional)'), schoolSearch, schoolSel), edu && newToggle,
      edu && st.newSchool && h('div', { class: 'fields' }, h('div', { class: 'field' }, h('label', { for: 'r-nsn' }, 'New school name'), nsName), h('div', { class: 'field' }, h('label', { for: 'r-nsd' }, 'District'), nsDist), h('div', { class: 'field' }, h('label', { for: 'r-nst' }, 'Type'), nsType)));
    const langSel = h('select', { id: 'r-lang' }, S.meta.languages.map(l => h('option', { value: l.key }, l.label))); f.lang = langSel;
    const bio = h('input', { type: 'checkbox', id: 'r-bio' }); const terms = h('input', { type: 'checkbox', id: 'r-terms', required: true }); f.bio = bio; f.terms = terms;
    mount(body, h('div', { class: 'stack' },
      h('fieldset', { class: 'stack tight', style: { border: 0, padding: 0, margin: 0 } }, h('legend', { class: 'lbl', style: { fontWeight: 700, marginBottom: '.4rem' } }, 'I am a'),
        h('div', { class: 'roles' }, roles.map(([v, l, d]) => h('label', h('input', { type: 'radio', name: 'role', value: v, checked: st.role === v, onchange: () => { st.role = v; render(); } }), l, h('small', d))))),
      h('div', { class: 'fields' }, inp('name', 'Full name', { autocomplete: 'name', required: true }), inp('email', 'Email', { type: 'email', autocomplete: 'email', required: true })),
      h('div', { class: 'fields' }, inp('password', 'Password', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true }, 'At least 8 characters with a letter and a number.'), h('div', { class: 'field' }, h('label', { for: 'r-lang' }, 'Language'), langSel)),
      student && h('div', { class: 'fields' }, h('div', { class: 'field' }, h('label', { for: 'r-grade' }, 'Grade level'), gradeSel), by),
      student && guardianWrap,
      student && inp('code', 'Class code from your teacher (optional)', { placeholder: 'e.g. K7M2QX', maxlength: 8, style: 'text-transform:uppercase' }),
      (student || edu) && schoolBlock,
      h('label', { class: 'check' }, bio, h('span', 'I agree to optional face verification for sign-in and exams. Face data is stored as an encrypted numeric template, never as a photo, and I can delete it any time. Learners under 18 also need a parent or guardian to confirm consent through their school.')),
      h('label', { class: 'check' }, terms, h('span', 'I accept the terms of use and privacy notice.')),
      err, h('button', { class: 'btn primary block', type: 'submit' }, 'Create account')));
  }
  const form = h('form', { onsubmit: async ev => {
    ev.preventDefault(); err.classList.add('hide');
    const b = { role: st.role, name: f.name.value, email: f.email.value, password: f.password.value, lang: f.lang.value, consent_terms: f.terms.checked, consent_biometric: f.bio.checked };
    if (st.role === 'student') Object.assign(b, { grade_level: f.grade.value, birth_year: Number(f.birth.value), guardian_contact: f.guardian && f.guardian.value, class_code: f.code.value, school_id: schoolSel.value || undefined });
    if (st.role === 'educator') { if (st.newSchool) b.new_school = { name: nsName.value, district: nsDist.value, type: nsType.value }; else b.school_id = schoolSel.value || undefined; }
    try { const r = await POST('/auth/register', b, { noAuthRedirect: true }); setSession(r.token, r.user); await afterAuth(); toast('Welcome to EduLearn!', 'ok'); go('/', true); }
    catch (e) { err.textContent = e.message; err.classList.remove('hide'); err.scrollIntoView({ block: 'center' }); }
  } }, body);
  render();
  return authLayout('Create your account', 'It takes about a minute.', form, h('p', { class: 'center' }, 'Already registered? ', h('a', { href: '#/login' }, 'Sign in')));
}

export async function afterAuth() {
  const r = await GET('/auth/me'); S.user = r.user; S.pendingFace = !!r.pending_face;
}
