import { S, h, mount, GET, POST, PUT, DEL, api, qs, toast, fail, icon, md, loading, empty, errorBox, setTitle, fmtDate, ago, gradeLabel, trackLabel, KIND, confirmBox, askText, dialog, pickColor } from './core.js';
import { route, go } from './router.js';
import { courseSpine, LESSON_NAME, LESSON_ICON } from './learn.js';

const fld = (label, input, hint, id) => { if (id && input.setAttribute) input.id = id; return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('span', { class: 'hint' }, hint)); };
const sel = (opts, value, attrs = {}) => h('select', attrs, opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
const toLocalInput = ms => { if (!ms) return ''; const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const fromLocalInput = v => (v ? new Date(v).getTime() : null);
async function upload(file) { const fd = new FormData(); fd.append('file', file); return api('POST', '/upload', fd); }
const copy = async t => { try { await navigator.clipboard.writeText(t); toast('Copied', 'ok'); } catch { toast(t); } };
const allowed = () => ['creator', 'educator', 'admin'].includes(S.user.role);

/* ======================================================================= classes ======================================================================= */
route('/classes', async () => {
  setTitle('Classes');
  const u = S.user, r = await GET('/classrooms');
  if (u.role === 'student') {
    const code = h('input', { id: 'jc', maxlength: 8, placeholder: 'e.g. K7M2QX', style: { textTransform: 'uppercase', maxWidth: '200px' }, autocomplete: 'off' });
    return h('div', { class: 'page narrow' }, h('div', { class: 'page-head' }, h('div', h('h1', 'My classes'), h('p', { class: 'sub' }, 'Join a class with the code your teacher gives you.'))),
      h('form', { class: 'row top', onsubmit: async ev => { ev.preventDefault(); try { const x = await POST('/classrooms/join', { code: code.value }); toast(`Joined ${x.classroom.name}`, 'ok'); location.reload(); } catch (e) { fail(e); } } }, h('div', { class: 'field' }, h('label', { for: 'jc' }, 'Classroom code'), code), h('button', { class: 'btn primary', style: { alignSelf: 'flex-end' }, type: 'submit' }, 'Join class')),
      h('section', { class: 'block' }, r.classrooms.length ? h('div', { class: 'list' }, r.classrooms.map(c => h('a', { class: 'item', href: '#/classes/' + c.id }, h('div', { class: 'grow' }, h('strong', c.name), h('span', { class: 'meta' }, `${c.teacher_name}${c.subject ? ', ' + c.subject : ''}, ${c.students} students`))))) : empty('You have not joined a class yet', 'Ask your teacher for a six-character code.')));
  }
  // educator / staff
  const schoolBlock = u.role === 'educator' && !u.school ? await schoolSetup() : null;
  const create = () => {
    const name = h('input', { maxlength: 100, placeholder: 'e.g. S3 Science A' }), subject = h('input', { maxlength: 80, placeholder: 'e.g. Physics' }), grade = sel([['', 'Not set'], ...S.meta.grades.map(g => [g.key, g.label])], '');
    dialog({ title: 'New class', body: h('div', { class: 'stack' }, fld('Class name', name), h('div', { class: 'fields' }, fld('Grade', grade), fld('Subject', subject))), actions: [{ label: 'Cancel' }, { label: 'Create class', kind: 'primary', close: false, onClick: async close => { const x = await POST('/classrooms', { name: name.value, grade: grade.value, subject: subject.value }); close(); toast('Class created. Share the code with your students.', 'ok'); go('/classes/' + x.classroom.id); } }] });
  };
  return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Classes'), h('p', { class: 'sub' }, u.school ? u.school.name : 'Choose your school to begin.')), u.school && u.role === 'educator' && h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New class'))),
    schoolBlock, r.classrooms.length ? h('div', { class: 'list' }, r.classrooms.map(c => h('a', { class: 'item', href: '#/classes/' + c.id }, h('div', { class: 'grow' }, h('strong', c.name), h('span', { class: 'meta' }, `${c.students} student${c.students === 1 ? '' : 's'}${c.grade ? ', ' + gradeLabel(c.grade) : ''}${c.teacher_name && u.role !== 'educator' ? ', ' + c.teacher_name : ''}`)), c.code && h('span', { class: 'chip plain' }, 'Code ' + c.code), c.archived ? h('span', { class: 'chip plain' }, 'Archived') : null))) : u.school && empty('No classes yet', 'Create a class to generate a code your students can enter.', u.role === 'educator' ? h('button', { class: 'btn primary', onclick: create }, 'Create a class') : null));
});

async function schoolSetup() {
  const box = h('div', { class: 'panel stack mt' }, h('h2', 'Set up your school'), h('p', 'Pick your school from the registered list, or create a new school profile.'));
  const search = h('input', { type: 'search', placeholder: 'Search registered schools…', 'aria-label': 'Search schools' }), results = h('div', { class: 'list' });
  const load = async () => { const r = await GET('/schools?q=' + encodeURIComponent(search.value)); mount(results, r.schools.length ? r.schools.map(s => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', s.name), h('span', { class: 'meta' }, [s.district, s.type, s.verified ? 'verified' : 'not yet verified'].filter(Boolean).join(', '))), h('button', { class: 'btn sm primary', onclick: async () => { try { await PUT('/me/school', { school_id: s.id }); toast('School selected', 'ok'); location.reload(); } catch (e) { fail(e); } } }, 'Use this school'))) : h('p', { class: 'muted' }, 'No school matches. Create it below.')); };
  search.addEventListener('input', () => { clearTimeout(search._t); search._t = setTimeout(load, 250); });
  const nm = h('input', { maxlength: 120, placeholder: 'School name' }), di = h('input', { maxlength: 80, placeholder: 'District' }), ty = sel([['school', 'School'], ['university', 'University'], ['training-centre', 'Training centre / TVET'], ['other', 'Other']], 'school');
  mount(box, h('h2', 'Set up your school'), h('p', 'Pick your school from the registered list, or create a new school profile.'), search, results, h('h3', { style: { marginTop: '1rem' } }, 'Not listed? Create a school profile'), h('div', { class: 'fields' }, fld('Name', nm), fld('District', di), fld('Type', ty)),
    h('div', h('button', { class: 'btn primary', onclick: async () => { try { await POST('/schools', { name: nm.value, district: di.value, type: ty.value }); toast('School profile created', 'ok'); location.reload(); } catch (e) { fail(e); } } }, 'Create school profile'))); load();
  return box;
}

route('/classes/:id', async ({ params, query }) => {
  const r = await GET('/classrooms/' + params.id), c = r.classroom, teacher = r.teacher; setTitle(c.name);
  const tab = ['students', 'assessments', 'analytics'].includes(query.tab) ? query.tab : 'students';
  const body = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['students', 'Students'], ['assessments', 'Assessments'], teacher && ['analytics', 'Analytics']].filter(Boolean).map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => go(`/classes/${c.id}?tab=${k}`) }, l)));
  if (tab === 'students') mount(body, r.students.length ? h('div', { class: 'list' }, r.students.map(s => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', s.name), teacher && h('span', { class: 'meta' }, `${gradeLabel(s.grade_level)}, ${s.xp} XP${s.streak ? ', ' + s.streak + ' day streak' : ''}`)),
    teacher && s.minor && h('label', { class: 'check', title: 'Confirm your school holds parent or guardian consent for face verification and proctored exams' }, h('input', { type: 'checkbox', checked: !!s.guardian_consent, onchange: async e => { try { await POST(`/classrooms/${c.id}/students/${s.id}/guardian-consent`, { confirmed: e.target.checked }); toast(e.target.checked ? 'Consent recorded' : 'Consent removed', 'ok'); } catch (x) { e.target.checked = !e.target.checked; fail(x); } } }), h('span', { class: 'small' }, 'Guardian consent on file')),
    teacher && s.face_enrolled ? h('span', { class: 'chip leaf' }, 'Face enrolled') : null, teacher && h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox(`Remove ${s.name} from this class?`, { yes: 'Remove', danger: true })) try { await DEL(`/classrooms/${c.id}/students/${s.id}`); location.reload(); } catch (e) { fail(e); } } }, 'Remove')))) : empty('No students yet', teacher ? `Share the class code ${c.code} so students can join.` : ''));
  if (tab === 'assessments') mount(body, teacher && h('div', { class: 'row', style: { marginBottom: '1rem' } }, h('button', { class: 'btn primary', onclick: () => newAssessment({ classroom_id: c.id }) }, icon('plus'), 'New assessment for this class')), r.assessments.length ? h('div', { class: 'list' }, r.assessments.map(a => h('a', { class: 'item', href: '#/assessments/' + a.id }, h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, `${KIND[a.kind]}${a.time_limit_min ? ', ' + a.time_limit_min + ' min' : ''}${a.closes_at ? ', closes ' + fmtDate(a.closes_at) : ''}`)), !!a.proctored && h('span', { class: 'chip ember' }, 'Proctored'), !!a.compulsory && h('span', { class: 'chip sun' }, 'Compulsory'), teacher && !a.published && h('span', { class: 'chip plain' }, 'Draft'), teacher && h('a', { class: 'btn sm', href: '#/results/' + a.id, onclick: e => e.stopPropagation() }, 'Results')))) : empty('No assessments yet'));
  if (tab === 'analytics' && teacher) analytics(body, c.id);
  return h('div', { class: 'page' }, h('div', { class: 'crumbs' }, h('a', { href: '#/classes' }, 'Classes')),
    h('div', { class: 'page-head' }, h('div', h('h1', c.name), h('p', { class: 'sub' }, `${r.teacher_name}${c.subject ? ', ' + c.subject : ''}${c.grade ? ', ' + gradeLabel(c.grade) : ''}`)), h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/community?tab=chat&room=class:${c.id}` }, icon('chat'), 'Class chat'), h('a', { class: 'btn', href: `#/community?tab=forum&scope=classroom:${c.id}` }, 'Discussions'))),
    teacher && h('div', { class: 'panel row', style: { marginBottom: '1.25rem' } }, h('div', h('div', { class: 'small muted' }, 'Classroom code (students enter this to join)'), h('div', { style: { font: '800 2rem var(--font-head)', letterSpacing: '.18em' }, 'aria-label': 'Code ' + c.code.split('').join(' ') }, c.code)), h('button', { class: 'btn', onclick: () => copy(c.code) }, 'Copy code'), h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Students already in the class stay. New students will need the new code.', { yes: 'Generate new code', title: 'Replace the code?' })) { await POST(`/classrooms/${c.id}/code`); location.reload(); } } }, 'New code'), h('button', { class: 'btn quiet right', onclick: async () => { await POST(`/classrooms/${c.id}/archive`, { archived: !c.archived }); go('/classes'); } }, c.archived ? 'Restore class' : 'Archive class')),
    tabs, body);
});

async function analytics(root, id) {
  mount(root, loading());
  try {
    const r = await GET(`/classrooms/${id}/analytics`);
    mount(root, h('div', { class: 'stack loose' },
      h('div', h('h2', 'Learners'), r.students.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', h('tr', ['Learner', 'Average', 'Assessments', 'Lessons done', 'XP', 'Attention'].map(x => h('th', x)))),
        h('tbody', r.students.map(s => h('tr', h('td', s.name), h('td', s.avg_percent === null ? 'No attempts' : s.avg_percent + '%'), h('td', s.attempts), h('td', s.lessons_completed), h('td', s.xp), h('td', s.at_risk.length ? s.at_risk.map(x => h('span', { class: 'chip ember', style: { marginRight: '.3rem' } }, x)) : h('span', { class: 'chip leaf' }, 'On track'))))))) : empty('No students yet')),
      h('div', h('h2', 'Topics to reteach'), r.topics.length ? r.topics.slice(0, 8).map(t => h('div', { class: 'topic' }, h('span', { class: 'name' }, t.topic), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: Math.round((t.rating - 100) / 9) + '%', background: t.rating < 450 ? 'var(--ember)' : t.rating < 700 ? 'var(--sun)' : 'var(--leaf)' } })), h('span', { class: 'small muted' }, `${t.correct}/${t.answered} correct`))) : h('p', { class: 'muted' }, 'Topic data appears after learners take quizzes.')),
      h('div', h('h2', 'Assigned work'), r.assigned.length ? h('div', { class: 'list' }, r.assigned.map(a => h('a', { class: 'item', href: '#/results/' + a.id }, h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, KIND[a.kind])), h('span', { class: 'chip plain' }, `${a.submitted} of ${r.total_students} submitted`)))) : h('p', { class: 'muted' }, 'Nothing assigned yet.'))));
  } catch (e) { mount(root, errorBox(e)); }
}

/* ======================================================================= studio home ======================================================================= */
function newAssessment(target = {}) {
  const title = h('input', { maxlength: 150, placeholder: 'e.g. Fractions quiz' }), kind = sel(Object.entries(KIND), 'practice');
  const hintEl = h('p', { class: 'hint' });
  const hints = { practice: 'Instant feedback after each question. Not graded for records.', adaptive: 'Questions adapt to each learner. Needs at least 5 questions.', test: 'Graded when submitted. Can be made compulsory with a time limit.', exam: 'Formal exam. Can be camera-proctored and hide answers.' };
  const upd = () => { hintEl.textContent = hints[kind.value]; }; kind.addEventListener('change', upd); upd();
  dialog({ title: 'New assessment', body: h('div', { class: 'stack' }, fld('Title', title), fld('Type', kind), hintEl), actions: [{ label: 'Cancel' }, { label: 'Create and add questions', kind: 'primary', close: false, onClick: async close => { const x = await POST('/assessments', { title: title.value, kind: kind.value, ...target }); close(); go('/studio/assessment/' + x.assessment.id); } }] });
}

route('/studio', async ({ query }) => {
  if (!allowed()) return empty('Studio is for educators and creators', 'Ask your administrator if you need access.');
  setTitle('Studio');
  const tab = query.tab === 'assessments' ? 'assessments' : 'courses';
  const body = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['courses', 'My courses'], ['assessments', 'My assessments']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => go('/studio?tab=' + k) }, l)));
  let action;
  if (tab === 'courses') {
    const r = await GET('/courses?mine=1');
    mount(body, r.courses.length ? h('div', { class: 'spines' }, r.courses.map(c => h('a', { class: 'spine', href: '#/studio/course/' + c.id, style: { '--c': c.cover_color || pickColor(c.id) } }, h('span', { class: 'chip ' + (c.status === 'published' ? 'leaf' : 'sun'), style: { alignSelf: 'flex-start' } }, { published: 'Published', pending: 'In review', draft: 'Draft' }[c.status]), h('h3', c.title), h('div', { class: 'foot' }, h('span', gradeLabel(c.grade_level)), h('span', `${c.lesson_count} lessons`), h('span', `${c.learners} learners`))))) : empty('Create your first course', 'Courses hold lessons (reading, video, PDF, interactive, 3D and VR) and quizzes.'));
    action = h('button', { class: 'btn primary', onclick: newCourse }, icon('plus'), 'New course');
  } else {
    const r = await GET('/assessments?mine=1');
    mount(body, r.assessments.length ? h('div', { class: 'list' }, r.assessments.map(a => h('a', { class: 'item', href: '#/studio/assessment/' + a.id }, h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, `${a.classroom_name || a.course_title || 'Standalone'}, ${a.question_count} questions`)), h('span', { class: 'chip plain' }, KIND[a.kind]), h('span', { class: 'chip ' + (a.published ? 'leaf' : 'sun') }, a.published ? 'Published' : 'Draft')))) : empty('No assessments yet', 'Create quizzes and tests with automatic grading.'));
    action = h('button', { class: 'btn primary', onclick: () => newAssessment() }, icon('plus'), 'New assessment');
  }
  return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Studio'), h('p', { class: 'sub' }, 'Build courses, lessons and assessments.')), h('div', { class: 'actions' }, action)), tabs, body);
});

function newCourse() {
  const title = h('input', { maxlength: 150, placeholder: 'e.g. Fractions Made Easy' }), grade = sel([['', 'Choose grade'], ...S.meta.grades.map(g => [g.key, g.label])], ''), track = sel(S.meta.tracks.map(t => [t.key, t.label]), 'academic');
  dialog({ title: 'New course', body: h('div', { class: 'stack' }, fld('Title', title), h('div', { class: 'fields' }, fld('Grade level', grade), fld('Type', track))), actions: [{ label: 'Cancel' }, { label: 'Create course', kind: 'primary', close: false, onClick: async close => { const x = await POST('/courses', { title: title.value, grade_level: grade.value, track: track.value }); close(); go('/studio/course/' + x.course.id); } }] });
}

/* ======================================================================= course editor ======================================================================= */
route('/studio/course/:id', async ({ params }) => {
  const r = await GET('/courses/' + params.id); const c = r.course; setTitle('Edit ' + c.title);
  if (!r.owner) return errorBox({ message: 'Only the course owner can edit this course.' });
  const f = { title: h('input', { value: c.title, maxlength: 150 }), summary: h('input', { value: c.summary || '', maxlength: 300 }), description: h('textarea', { maxlength: 5000 }, c.description || ''), grade: sel(S.meta.grades.map(g => [g.key, g.label]), c.grade_level), track: sel(S.meta.tracks.map(t => [t.key, t.label]), c.track), subject: sel([['', 'Not set'], ...S.meta.subjects], c.subject), curriculum: sel([['', 'Not set'], ...S.meta.curricula], c.curriculum), language: sel(S.meta.languages.map(l => [l.key, l.label]), c.language), color: h('input', { type: 'color', value: c.cover_color || '#0f766e', 'aria-label': 'Cover colour' }) };
  const saveBtn = h('button', { class: 'btn primary', onclick: async () => { try { await PUT('/courses/' + c.id, { title: f.title.value, summary: f.summary.value, description: f.description.value, grade_level: f.grade.value, track: f.track.value, subject: f.subject.value, curriculum: f.curriculum.value, language: f.language.value, cover_color: f.color.value }); toast('Course saved', 'ok'); } catch (e) { fail(e); } } }, 'Save details');
  const lessonsEl = h('div');
  function drawLessons() {
    mount(lessonsEl, r.lessons.length ? h('div', { class: 'list' }, r.lessons.map((l, i) => h('div', { class: 'item' }, icon(LESSON_ICON[l.type], 20), h('div', { class: 'grow' }, h('strong', l.title), h('span', { class: 'meta' }, `${LESSON_NAME[l.type]}, ${l.duration_min} min`)),
      h('button', { class: 'btn sm quiet', disabled: i === 0, 'aria-label': 'Move up', onclick: () => move(i, -1) }, icon('up', 16)), h('button', { class: 'btn sm quiet', disabled: i === r.lessons.length - 1, 'aria-label': 'Move down', onclick: () => move(i, 1) }, icon('down', 16)),
      h('button', { class: 'btn sm', onclick: () => editLesson(l.id) }, 'Edit'), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox(`Delete "${l.title}"?`, { yes: 'Delete', danger: true })) { await DEL('/lessons/' + l.id).catch(fail); location.reload(); } } }, 'Delete')))) : empty('No lessons yet', 'Add a reading, a video, an interactive SCORM package, a 3D model or a VR scene.'));
  }
  async function move(i, d) { const a = r.lessons; [a[i], a[i + d]] = [a[i + d], a[i]]; drawLessons(); try { await POST(`/courses/${c.id}/lessons/reorder`, { order: a.map(x => x.id) }); } catch (e) { fail(e); } }
  async function editLesson(id) { try { const x = id ? await GET('/lessons/' + id) : null; lessonDialog(c.id, x && x.lesson); } catch (e) { fail(e); } }
  drawLessons();
  const submit = async () => { try { const x = await POST(`/courses/${c.id}/submit`); toast(x.status === 'published' ? 'Course published' : 'Sent for review. A moderator will check it before learners see it.', 'ok'); location.reload(); } catch (e) { fail(e); } };
  return h('div', { class: 'page' }, h('div', { class: 'crumbs' }, h('a', { href: '#/studio' }, 'Studio')),
    h('div', { class: 'page-head' }, h('div', h('h1', c.title), h('span', { class: 'chip ' + (c.status === 'published' ? 'leaf' : 'sun') }, { published: 'Published', pending: 'In review', draft: 'Draft' }[c.status])), h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/courses/' + c.id }, icon('eye'), 'Preview'), c.status !== 'pending' && h('button', { class: 'btn good', onclick: submit }, c.status === 'published' ? 'Re-submit' : S.user.role === 'admin' ? 'Publish' : 'Submit for review'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('This deletes the course, its lessons and quizzes.', { yes: 'Delete course', danger: true })) { try { await DEL('/courses/' + c.id); go('/studio'); } catch (e) { fail(e); } } } }, 'Delete'))),
    c.review_notes && h('div', { class: 'banner warn' }, h('p', h('strong', 'Reviewer feedback: '), c.review_notes)),
    h('section', { class: 'block', style: { marginTop: '1rem' } }, h('h2', 'Details'), h('div', { class: 'stack' }, fld('Title', f.title), fld('Short summary', f.summary, 'Shown on the course tile.'), fld('Description (supports **bold**, lists, tables)', f.description),
      h('div', { class: 'fields' }, fld('Grade level', f.grade), fld('Type', f.track), fld('Subject', f.subject), fld('Curriculum', f.curriculum), fld('Language of the content', f.language), fld('Cover colour', f.color)), h('div', saveBtn))),
    h('section', { class: 'block' }, h('h2', 'Lessons', h('button', { class: 'btn sm primary right', style: { fontFamily: 'var(--font-body)' }, onclick: () => lessonDialog(c.id, null) }, icon('plus', 16), 'Add lesson')), lessonsEl),
    h('section', { class: 'block' }, h('h2', 'Quizzes and tests', h('button', { class: 'btn sm right', style: { fontFamily: 'var(--font-body)' }, onclick: () => newAssessment({ course_id: c.id }) }, icon('plus', 16), 'Add assessment')), r.assessments.length ? h('div', { class: 'list' }, r.assessments.map(a => h('a', { class: 'item', href: '#/studio/assessment/' + a.id }, h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, KIND[a.kind])), h('span', { class: 'chip ' + (a.published ? 'leaf' : 'sun') }, a.published ? 'Published' : 'Draft')))) : h('p', { class: 'muted' }, 'No assessments yet.')));
});

function lessonDialog(courseId, l) {
  const st = { type: l ? l.type : 'text', ar: l && l.ar_config ? JSON.parse(JSON.stringify(l.ar_config)) : null };
  const title = h('input', { value: l ? l.title : '', maxlength: 150 }), dur = h('input', { type: 'number', min: 1, max: 240, value: l ? l.duration_min : 5 });
  const type = sel(Object.entries(LESSON_NAME), st.type), body = h('textarea', { style: { minHeight: '140px' } }, l ? l.body || '' : ''), media = h('input', { type: 'url', value: l ? l.media_url || '' : '', placeholder: 'https://… or upload a file' });
  const mediaFile = h('input', { type: 'file' }), scormFile = h('input', { type: 'file', accept: '.zip' });
  const sub = h('div', { class: 'stack' }), preview = h('div', { class: 'hide panel' });
  const model = h('input', { type: 'url', placeholder: 'https://…/model.glb or upload a .glb', value: st.ar && st.ar.model_url || '' }), alt = h('input', { value: st.ar && st.ar.alt || '', placeholder: 'Describe the model for screen readers' });
  const arRot = h('input', { type: 'checkbox', checked: !st.ar || st.ar.auto_rotate !== false }), arAr = h('input', { type: 'checkbox', checked: !st.ar || st.ar.ar !== false });
  const vr = st.type === 'vr' && st.ar ? st.ar : { sky: '#0b1020', ground: '#1b2a41', entities: [] }; if (!vr.entities) vr.entities = [];
  const entsEl = h('div', { class: 'stack tight' }), sky = h('input', { type: 'color', value: vr.sky || '#0b1020' }), ground = h('input', { type: 'color', value: vr.ground || '#1b2a41' });
  const SHAPES = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'plane', 'ring'];
  function drawEnts() {
    mount(entsEl, vr.entities.map((e, i) => h('div', { class: 'panel', style: { padding: '.7rem' } }, h('div', { class: 'fields' }, fld('Shape', sel(SHAPES, e.shape, { onchange: x => { e.shape = x.target.value; } })), fld('Colour', h('input', { type: 'color', value: e.color || '#4cc9f0', oninput: x => { e.color = x.target.value; } })), fld('Label', h('input', { value: e.label || '', maxlength: 60, oninput: x => { e.label = x.target.value; } })), fld('Position (x y z)', h('input', { value: e.position || '0 1.5 -3', oninput: x => { e.position = x.target.value; } })), fld('Scale (x y z)', h('input', { value: e.scale || '1 1 1', oninput: x => { e.scale = x.target.value; } })), fld('Motion', sel([['', 'None'], ['spin', 'Spin'], ['orbit', 'Orbit']], e.animate || '', { onchange: x => { e.animate = x.target.value; } }))), h('button', { class: 'btn sm danger', type: 'button', onclick: () => { vr.entities.splice(i, 1); drawEnts(); } }, 'Remove object'))));
  }
  function drawSub() {
    const t = type.value; st.type = t;
    if (t === 'text') return mount(sub, h('p', { class: 'hint' }, 'Write the lesson below. Use ## for headings, - for bullets, **bold**, tables with |.'));
    if (t === 'video') return mount(sub, fld('Video link', media, 'Paste a YouTube or Vimeo link, a direct .mp4/.webm link, or upload a file (up to 60 MB).'), h('div', { class: 'row' }, mediaFile, h('button', { class: 'btn sm', type: 'button', onclick: () => doUpload('mp4/webm') }, 'Upload video')));
    if (t === 'pdf') return mount(sub, fld('PDF', media, 'Link to a PDF or upload one.'), h('div', { class: 'row' }, mediaFile, h('button', { class: 'btn sm', type: 'button', onclick: () => doUpload('pdf') }, 'Upload PDF')));
    if (t === 'scorm') return mount(sub, h('div', { class: 'banner' }, h('p', l && l.has_scorm ? 'A SCORM package is already attached. Upload a new .zip to replace it.' : 'Upload a SCORM 1.2 or 2004 package (.zip with imsmanifest.xml at the root). Saved first, then uploaded.')), scormFile);
    if (t === 'ar') return mount(sub, fld('3D model link (.glb)', model, 'Must be https, or upload a .glb file (up to 60 MB). Learners can rotate it and place it in their room on supported phones.'), h('div', { class: 'row' }, mediaFile, h('button', { class: 'btn sm', type: 'button', onclick: () => doUpload('glb') }, 'Upload .glb')), fld('Alt text', alt), h('label', { class: 'check' }, arRot, h('span', 'Auto-rotate')), h('label', { class: 'check' }, arAr, h('span', 'Offer the “view in your room” AR button')));
    if (t === 'vr') { drawEnts(); return mount(sub, h('div', { class: 'fields' }, fld('Sky colour', sky), fld('Ground colour', ground)), h('h4', 'Objects in the scene'), entsEl, h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { vr.entities.push({ shape: 'sphere', color: '#4cc9f0', position: `${vr.entities.length * 1.2 - 2} 1.5 -3`, scale: '0.6 0.6 0.6', label: '' }); drawEnts(); } }, icon('plus', 16), 'Add object'))); }
  }
  async function doUpload(kind) {
    const file = mediaFile.files[0]; if (!file) return toast('Choose a file first', 'err');
    try { toast('Uploading…'); const r = await upload(file); if (type.value === 'ar') model.value = location.origin + r.url; else media.value = r.url; toast('Uploaded', 'ok'); } catch (e) { fail(e); }
  }
  type.addEventListener('change', drawSub); drawSub();
  const togglePrev = h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { preview.classList.toggle('hide'); mount(preview, md(body.value)); } }, 'Preview text');
  const dlg = dialog({ title: l ? 'Edit lesson' : 'Add lesson', body: h('div', { class: 'stack' }, fld('Title', title), h('div', { class: 'fields' }, fld('Type', type), fld('Minutes', dur)), sub, fld(type.value === 'text' ? 'Lesson text' : 'Notes (optional)', body), togglePrev, preview),
    actions: [{ label: 'Cancel' }, { label: 'Save lesson', kind: 'primary', close: false, onClick: async close => {
      const t = type.value; const payload = { title: title.value, type: t, body: body.value, duration_min: Number(dur.value) || 5, media_url: (t === 'video' || t === 'pdf') ? media.value : '' };
      if (t === 'ar') payload.ar_config = { model_url: model.value, alt: alt.value, auto_rotate: arRot.checked, ar: arAr.checked };
      if (t === 'vr') payload.ar_config = { sky: sky.value, ground: ground.value, entities: vr.entities };
      const saved = l ? (await PUT('/lessons/' + l.id, payload)).lesson : (await POST(`/courses/${courseId}/lessons`, payload)).lesson;
      if (t === 'scorm' && scormFile.files[0]) { const fd = new FormData(); fd.append('file', scormFile.files[0]); toast('Uploading SCORM package…'); const r = await api('POST', `/lessons/${saved.id}/scorm`, fd); toast(`SCORM ${r.version} package ready`, 'ok'); }
      close(); toast('Lesson saved', 'ok'); location.reload();
    } }] });
}

/* ======================================================================= assessment editor ======================================================================= */
route('/studio/assessment/:id', async ({ params }) => {
  const r = await GET('/assessments/' + params.id); const a = r.assessment; setTitle('Edit ' + a.title);
  if (!r.can_manage) return errorBox({ message: 'Only the owner can edit this assessment.' });
  const instant = a.kind === 'practice' || a.kind === 'adaptive';
  const f = { title: h('input', { value: a.title, maxlength: 150 }), description: h('input', { value: a.description || '', maxlength: 1000 }), kind: sel(Object.entries(KIND), a.kind), compulsory: h('input', { type: 'checkbox', checked: !!a.compulsory }), proctored: h('input', { type: 'checkbox', checked: !!a.proctored }), time: h('input', { type: 'number', min: 1, max: 360, value: a.time_limit_min || '', placeholder: 'No limit' }), pass: h('input', { type: 'number', min: 0, max: 100, value: a.pass_mark }), shuffle: h('input', { type: 'checkbox', checked: !!a.shuffle }), attempts: h('input', { type: 'number', min: 0, max: 20, value: a.max_attempts }), show: h('input', { type: 'checkbox', checked: !!a.show_answers }), len: h('input', { type: 'number', min: 3, max: 50, value: a.adaptive_length }), opens: h('input', { type: 'datetime-local', value: toLocalInput(a.opens_at) }), closes: h('input', { type: 'datetime-local', value: toLocalInput(a.closes_at) }) };
  const check = (el, label, hint) => h('label', { class: 'check' }, el, h('span', h('strong', label), hint && h('span', { class: 'hint', style: { display: 'block' } }, hint)));
  const body = () => ({ title: f.title.value, description: f.description.value, kind: f.kind.value, compulsory: f.compulsory.checked, proctored: f.proctored.checked, time_limit_min: f.time.value || null, pass_mark: Number(f.pass.value), shuffle: f.shuffle.checked, max_attempts: Number(f.attempts.value) || 0, show_answers: f.show.checked, adaptive_length: Number(f.len.value) || 10, opens_at: fromLocalInput(f.opens.value), closes_at: fromLocalInput(f.closes.value) });
  const save = async extra => { try { await PUT('/assessments/' + a.id, { ...body(), ...extra }); toast('Saved', 'ok'); location.reload(); } catch (e) { fail(e); } };
  const qs = r.questions || [];
  const qrow = (q, i) => h('div', { class: 'item' }, h('span', { class: 'chip plain' }, i + 1), h('div', { class: 'grow' }, h('strong', q.prompt), h('span', { class: 'meta' }, `${{ mcq: 'Multiple choice', multi: 'Multiple answers', truefalse: 'True or false', short: 'Short answer' }[q.type]}, ${q.topic}, difficulty ${q.difficulty}, ${q.points} pt`)), h('button', { class: 'btn sm', onclick: () => questionDialog(a.id, q) }, 'Edit'), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Delete this question?', { yes: 'Delete', danger: true })) { await DEL('/questions/' + q.id).catch(fail); location.reload(); } } }, 'Delete'));
  return h('div', { class: 'page' }, h('div', { class: 'crumbs' }, h('a', { href: '#/studio?tab=assessments' }, 'Studio'), a.course_id && [' / ', h('a', { href: '#/studio/course/' + a.course_id }, r.course ? r.course.title : 'Course')]),
    h('div', { class: 'page-head' }, h('div', h('h1', a.title), h('span', { class: 'chip ' + (a.published ? 'leaf' : 'sun') }, a.published ? 'Published' : 'Draft')), h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/results/' + a.id }, 'Results'), h('button', { class: 'btn ' + (a.published ? '' : 'good'), onclick: () => save({ published: !a.published }) }, a.published ? 'Unpublish' : 'Publish'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete this assessment and its questions?', { yes: 'Delete', danger: true })) try { await DEL('/assessments/' + a.id); go('/studio?tab=assessments'); } catch (e) { fail(e); } } }, 'Delete'))),
    h('section', { class: 'block', style: { marginTop: '1rem' } }, h('h2', 'Settings'), h('div', { class: 'stack' }, fld('Title', f.title), fld('Description', f.description), h('div', { class: 'fields' }, fld('Type', f.kind, 'Change type, then Save settings.'), fld('Pass mark (%)', f.pass), !instant && fld('Time limit (minutes)', f.time), fld('Attempts allowed', f.attempts, '0 means unlimited.'), f.kind.value === 'adaptive' && fld('Questions per attempt', f.len)),
      !instant && h('div', { class: 'stack tight' }, check(f.compulsory, 'Compulsory', 'Learners must answer every question before they can submit.'), check(f.proctored, 'Camera-proctored', 'Face check, arms and room scan first, then continuous monitoring. Teachers review every flag.'), check(f.shuffle, 'Shuffle question order'), check(f.show, 'Show correct answers after submitting')),
      !instant && h('div', { class: 'fields' }, fld('Opens', f.opens, 'Optional'), fld('Closes', f.closes, 'Optional. Open attempts are auto-submitted at this time.')), h('div', h('button', { class: 'btn primary', onclick: () => save({}) }, 'Save settings')))),
    h('section', { class: 'block' }, h('h2', `Questions (${qs.length})`, h('button', { class: 'btn sm primary right', style: { fontFamily: 'var(--font-body)' }, onclick: () => questionDialog(a.id, null) }, icon('plus', 16), 'Add question')),
      a.kind === 'adaptive' && h('p', { class: 'muted' }, 'Tip: give each question a topic and a difficulty from 1 (easy) to 5 (hard). The quiz picks questions that match each learner.'),
      qs.length ? h('div', { class: 'list' }, qs.map(qrow)) : empty('No questions yet', 'Add multiple-choice, multi-answer, true/false or short-answer questions. They are graded automatically.')));
});

function questionDialog(aid, q) {
  const type = sel([['mcq', 'Multiple choice (one answer)'], ['multi', 'Multiple answers'], ['truefalse', 'True or false'], ['short', 'Short answer']], q ? q.type : 'mcq');
  const prompt = h('textarea', { style: { minHeight: '80px' }, maxlength: 2000 }, q ? q.prompt : ''), expl = h('textarea', { style: { minHeight: '60px' }, placeholder: 'Shown to learners after they answer. Good explanations teach.' }, q ? q.explanation || '' : '');
  const topic = h('input', { value: q ? q.topic : '', maxlength: 80, placeholder: 'e.g. fractions' }), diff = sel([1, 2, 3, 4, 5].map(n => [n, `${n}${n === 1 ? ' (easy)' : n === 5 ? ' (hard)' : ''}`]), q ? q.difficulty : 3), pts = h('input', { type: 'number', min: 0.5, max: 20, step: 0.5, value: q ? q.points : 1 });
  let opts = q && q.options ? q.options.slice() : ['', '', '', '']; let correct = q ? (q.type === 'multi' ? new Set(q.answer) : q.type === 'mcq' ? new Set([q.answer]) : new Set()) : new Set([0]);
  let tf = q && q.type === 'truefalse' ? q.answer : true; let shortAns = q && q.type === 'short' ? q.answer.join('\n') : '';
  const area = h('div', { class: 'stack tight' });
  function draw() {
    const t = type.value;
    if (t === 'mcq' || t === 'multi') {
      const m = t === 'multi';
      return mount(area, h('p', { class: 'hint' }, m ? 'Tick every correct option.' : 'Select the one correct option.'), opts.map((o, i) => h('div', { class: 'row nowrap' }, h('input', { type: m ? 'checkbox' : 'radio', name: 'correct', checked: correct.has(i), 'aria-label': `Option ${i + 1} is correct`, onchange: e => { if (m) { e.target.checked ? correct.add(i) : correct.delete(i); } else correct = new Set([i]); } }), h('input', { value: o, placeholder: `Option ${i + 1}`, 'aria-label': `Option ${i + 1}`, maxlength: 300, oninput: e => { opts[i] = e.target.value; } }), opts.length > 2 && h('button', { class: 'btn sm quiet', type: 'button', 'aria-label': 'Remove option', onclick: () => { opts.splice(i, 1); correct = new Set([...correct].filter(x => x !== i).map(x => (x > i ? x - 1 : x))); draw(); } }, icon('close', 16)))), opts.length < 8 && h('div', h('button', { class: 'btn sm', type: 'button', onclick: () => { opts.push(''); draw(); } }, icon('plus', 16), 'Add option')));
    }
    if (t === 'truefalse') return mount(area, h('fieldset', { class: 'opts', style: { border: 0, padding: 0 } }, h('legend', { class: 'lbl' }, 'Correct answer'), [['True', true], ['False', false]].map(([l, v]) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'tf', checked: tf === v, onchange: () => { tf = v; } }), l))));
    mount(area, fld('Accepted answers (one per line)', h('textarea', { style: { minHeight: '70px' }, oninput: e => { shortAns = e.target.value; } }, shortAns), 'Matching ignores capital letters, accents and extra spaces. Numbers match by value (1.0 equals 1).'));
  }
  type.addEventListener('change', () => { if (type.value === 'mcq' && correct.size > 1) correct = new Set([[...correct][0]]); draw(); }); draw();
  dialog({ title: q ? 'Edit question' : 'Add question', body: h('div', { class: 'stack' }, fld('Question type', type), fld('Question', prompt), area, fld('Explanation', expl), h('div', { class: 'fields' }, fld('Topic', topic, 'Used for adaptive quizzes and analytics.'), fld('Difficulty', diff), fld('Points', pts))),
    actions: [{ label: 'Cancel' }, { label: 'Save question', kind: 'primary', close: false, onClick: async close => {
      const t = type.value; const d = { type: t, prompt: prompt.value, explanation: expl.value, topic: topic.value, difficulty: Number(diff.value), points: Number(pts.value) };
      if (t === 'mcq') { d.options = opts; d.answer = [...correct][0]; } else if (t === 'multi') { d.options = opts; d.answer = [...correct]; } else if (t === 'truefalse') d.answer = tf; else d.answer = shortAns.split('\n').map(x => x.trim()).filter(Boolean);
      if (q) await PUT('/questions/' + q.id, d); else await POST(`/assessments/${aid}/questions`, { questions: [d] });
      close(); toast('Question saved', 'ok'); location.reload();
    } }] });
}
