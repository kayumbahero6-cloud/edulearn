import { S, h, mount, GET, POST, DEL, qs, toast, fail, icon, md, loading, empty, errorBox, setTitle, gradeLabel, trackLabel, langLabel, pickColor, debounce, KIND, $ } from './core.js';
import { route, go } from './router.js';

const LESSON_ICON = { text: 'text', video: 'video', pdf: 'file', scorm: 'scorm', ar: 'cube', vr: 'vr' };
const LESSON_NAME = { text: 'Reading', video: 'Video', pdf: 'PDF', scorm: 'Interactive (SCORM)', ar: 'Augmented reality', vr: 'Virtual reality' };
export { LESSON_ICON, LESSON_NAME };

export function courseSpine(c, { showStatus = false } = {}) {
  const color = c.cover_color || pickColor(c.id);
  return h('a', { class: 'spine', href: '#/courses/' + c.id, style: { '--c': color } },
    showStatus && c.status !== 'published' && h('span', { class: 'chip sun draft' }, c.status === 'pending' ? 'In review' : 'Draft'),
    h('div', { class: 'row', style: { gap: '.35rem' } }, h('span', { class: 'chip' }, gradeLabel(c.grade_level)), c.track !== 'academic' && h('span', { class: 'chip plain' }, trackLabel(c.track))),
    h('h3', c.title), c.summary && h('p', c.summary),
    c.enrolled && c.lesson_count ? h('div', { class: 'stack tight' }, h('div', { class: 'track thin', role: 'progressbar', 'aria-valuenow': c.percent, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Course progress' }, h('div', { class: 'fill', style: { width: c.percent + '%' } })), h('span', { class: 'small muted' }, `${c.done} of ${c.lesson_count} lessons done`)) : null,
    h('div', { class: 'foot' }, c.subject && h('span', c.subject), h('span', `${c.lesson_count} lesson${c.lesson_count === 1 ? '' : 's'}`), c.language && c.language !== 'en' && h('span', langLabel(c.language))));
}

/* ---------------- catalogue ---------------- */
route('/courses', async ({ query }) => {
  setTitle('Courses');
  const f = { grade: query.grade || '', track: query.track || '', subject: '', curriculum: '', language: '', q: '', enrolled: query.enrolled === '1' };
  const list = h('div'), stairsEl = h('div', { class: 'stairs', role: 'group', 'aria-label': 'Grade level' });
  const sel = (id, label, opts, key) => { const s = h('select', { id, onchange: e => { f[key] = e.target.value; load(); } }, h('option', { value: '' }, 'All'), opts.map(o => h('option', { value: o.value ?? o }, o.label ?? o))); return h('div', { class: 'field' }, h('label', { for: id }, label), s); };
  const search = h('input', { type: 'search', id: 'cq', placeholder: 'Search courses', oninput: debounce(e => { f.q = e.target.value; load(); }, 300) });
  const mine = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.enrolled, onchange: e => { f.enrolled = e.target.checked; load(); } }), h('span', 'Only courses I have started'));
  function drawStairs() {
    const all = [{ key: '', label: 'All grades' }, ...S.meta.grades];
    mount(stairsEl, all.map((g, i) => h('button', { type: 'button', style: { '--h': (Math.min(i, 22) * 2.2) + 'px' }, 'aria-pressed': String(f.grade === g.key), onclick: () => { f.grade = g.key; drawStairs(); load(); } }, g.label)));
  }
  async function load() {
    mount(list, loading());
    try {
      const r = await GET('/courses' + qs({ grade: f.grade, track: f.track, subject: f.subject, curriculum: f.curriculum, language: f.language, q: f.q, enrolled: f.enrolled }));
      mount(list, r.courses.length ? h('div', { class: 'spines' }, r.courses.map(c => courseSpine(c))) : empty('No courses match yet', 'Try another grade or clear a filter.', S.user.role !== 'student' ? h('a', { class: 'btn primary', href: '#/studio' }, 'Create a course') : null));
    } catch (e) { mount(list, errorBox(e)); }
  }
  drawStairs(); load();
  const m = S.meta;
  return h('div', { class: 'page wide' },
    h('div', { class: 'page-head' }, h('div', h('h1', 'Courses'), h('p', { class: 'sub' }, 'From Pre-Nursery to A-Level, plus vocational skills, languages and regional curricula.'))),
    h('div', { class: 'stack' }, stairsEl,
      h('div', { class: 'filters' }, h('div', { class: 'field' }, h('label', { for: 'cq' }, 'Search'), search),
        sel('c-track', 'Type', m.tracks.map(t => ({ value: t.key, label: t.label })), 'track'), sel('c-subj', 'Subject', m.subjects, 'subject'), sel('c-cur', 'Curriculum', m.curricula, 'curriculum'), sel('c-lang', 'Language', m.languages.map(l => ({ value: l.key, label: l.label })), 'language')),
      S.user.role === 'student' && mine, list));
});

/* ---------------- course page ---------------- */
route('/courses/:id', async ({ params }) => {
  const r = await GET('/courses/' + params.id);
  const c = r.course; setTitle(c.title);
  const enroll = async on => { try { on ? await POST(`/courses/${c.id}/enroll`) : await DEL(`/courses/${c.id}/enroll`); toast(on ? 'Added to your courses' : 'Removed from your courses', 'ok'); go('/courses/' + c.id, true); location.reload(); } catch (e) { fail(e); } };
  const firstOpen = r.lessons.find(l => !l.completed) || r.lessons[0];
  return h('div', { class: 'page' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/courses' }, 'Courses'), ' / ', gradeLabel(c.grade_level)),
    h('div', { class: 'page-head' }, h('div', h('h1', c.title), c.summary && h('p', { class: 'sub' }, c.summary)),
      h('div', { class: 'actions' }, r.lessons.length > 0 && h('a', { class: 'btn primary', href: '#/lessons/' + firstOpen.id }, r.percent ? 'Continue learning' : 'Start course'),
        S.user.role === 'student' && (r.enrolled ? h('button', { class: 'btn', onclick: () => enroll(false) }, 'Leave course') : h('button', { class: 'btn', onclick: () => enroll(true) }, 'Add to my courses')),
        r.owner && h('a', { class: 'btn', href: '#/studio/course/' + c.id }, 'Edit in Studio'))),
    c.status !== 'published' && h('div', { class: 'banner warn' }, h('p', c.status === 'pending' ? 'This course is waiting for a moderator to review it. Only you and moderators can see it.' : 'This course is a draft and is not visible to learners yet.'), c.review_notes && h('p', h('strong', 'Reviewer notes: '), c.review_notes)),
    h('div', { class: 'row', style: { margin: '0 0 1rem' } }, h('span', { class: 'chip' }, gradeLabel(c.grade_level)), h('span', { class: 'chip plain' }, trackLabel(c.track)), c.subject && h('span', { class: 'chip plain' }, c.subject), c.curriculum && h('span', { class: 'chip plain' }, c.curriculum), h('span', { class: 'chip plain' }, langLabel(c.language)), h('span', { class: 'muted small' }, 'by ' + c.creator_name)),
    c.description && c.description !== c.summary && h('div', { class: 'mt' }, md(c.description)),
    r.enrolled || r.percent ? h('div', { class: 'stack tight mt' }, h('div', { class: 'track', role: 'progressbar', 'aria-valuenow': r.percent, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Course progress' }, h('div', { class: 'fill', style: { width: r.percent + '%' } })), h('span', { class: 'small muted' }, `${r.percent}% complete`)) : null,
    h('section', { class: 'block' }, h('h2', 'Lessons'), r.lessons.length ? h('div', { class: 'list' }, r.lessons.map((l, i) => h('a', { class: 'item', href: '#/lessons/' + l.id },
      h('span', { class: 'chip ' + (l.completed ? 'leaf' : 'plain'), style: { minWidth: '2rem', justifyContent: 'center' }, 'aria-label': l.completed ? 'Completed' : 'Not completed' }, l.completed ? icon('check', 14) : i + 1),
      h('div', { class: 'grow' }, h('strong', l.title), h('span', { class: 'meta' }, `${LESSON_NAME[l.type]}, about ${l.duration_min} min`)), icon(LESSON_ICON[l.type], 20)))) : empty('No lessons yet', r.owner ? 'Add your first lesson in Studio.' : 'The creator is still building this course.')),
    r.assessments.length > 0 && h('section', { class: 'block' }, h('h2', 'Quizzes and tests'), h('div', { class: 'list' }, r.assessments.map(a => h('a', { class: 'item', href: '#/assessments/' + a.id },
      h('div', { class: 'grow' }, h('strong', a.title), h('span', { class: 'meta' }, `${KIND[a.kind]}${a.time_limit_min ? `, ${a.time_limit_min} min` : ''}${a.compulsory ? ', compulsory' : ''}`)), !!a.proctored && h('span', { class: 'chip sun' }, 'Camera-proctored'), !a.published && h('span', { class: 'chip ember' }, 'Unpublished'))))),
    c.status === 'published' && h('section', { class: 'block' }, h('h2', 'Talk about this course'), h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/community?tab=forum&scope=course:${c.id}` }, icon('list'), 'Discussion board'), h('a', { class: 'btn', href: `#/community?tab=chat&room=course:${c.id}` }, icon('chat'), 'Live chat'))));
});

/* ---------------- lesson viewer ---------------- */
function embedFor(url) {
  let u; try { u = new URL(url, location.origin); } catch { return null; }
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([\w-]{11})/.exec(u.href);
  if (yt) return h('iframe', { class: 'media', src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, title: 'Lesson video', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u.href);
  if (vm) return h('iframe', { class: 'media', src: `https://player.vimeo.com/video/${vm[1]}`, title: 'Lesson video', allow: 'fullscreen; picture-in-picture', allowfullscreen: true });
  if (/\.(mp4|webm)(\?|$)/i.test(u.pathname + u.search)) return h('video', { class: 'media', controls: true, preload: 'metadata', src: u.href }, 'Your browser cannot play this video.');
  if (/\.(mp3|ogg|wav)(\?|$)/i.test(u.pathname)) return h('audio', { class: 'media', controls: true, src: u.href });
  return h('a', { class: 'btn', href: u.href, target: '_blank', rel: 'noopener noreferrer' }, 'Open the video in a new tab');
}

async function arViewer(cfg) {
  const holder = h('div', { class: 'ar-wrap' }, loading());
  try {
    await import('/vendor/model-viewer/model-viewer.min.js');
    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', cfg.model_url); mv.setAttribute('alt', cfg.alt || '3D model'); mv.setAttribute('camera-controls', ''); mv.setAttribute('touch-action', 'pan-y');
    mv.setAttribute('shadow-intensity', '1'); if (cfg.auto_rotate) mv.setAttribute('auto-rotate', ''); if (cfg.ar) { mv.setAttribute('ar', ''); mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look'); mv.setAttribute('ar-scale', 'auto'); }
    if (cfg.scale) mv.setAttribute('scale', cfg.scale);
    mv.addEventListener('error', () => mount(holder, h('div', { class: 'banner err' }, h('p', 'The 3D model could not load. Ask your teacher to check the model link.'))));
    const note = h('p', { class: 'hint' }, 'Drag to rotate, pinch or scroll to zoom. ' + (cfg.ar ? 'On a supported phone, tap the AR button to place the model in your room.' : ''));
    mount(holder, mv, note);
  } catch { mount(holder, h('div', { class: 'banner err' }, h('p', '3D viewer could not start in this browser.'))); }
  return holder;
}

route('/lessons/:id', async ({ params }) => {
  const r = await GET('/lessons/' + params.id);
  const l = r.lesson; setTitle(l.title);
  let content;
  if (l.type === 'text') content = md(l.body);
  else if (l.type === 'video') content = h('div', { class: 'stack' }, l.media_url ? embedFor(l.media_url) : empty('No video attached'), l.body && md(l.body));
  else if (l.type === 'pdf') content = h('div', { class: 'stack' }, l.media_url ? h('div', { class: 'row' }, h('a', { class: 'btn primary', href: l.media_url, target: '_blank', rel: 'noopener noreferrer' }, icon('file'), 'Open PDF in a new tab')) : empty('No PDF attached'), l.media_url && /^\/files\//.test(l.media_url) && h('iframe', { class: 'media', style: { aspectRatio: '3/4', maxHeight: '80vh' }, src: l.media_url, title: l.title }), l.body && md(l.body));
  else if (l.type === 'ar') content = h('div', { class: 'stack' }, l.ar_config && l.ar_config.model_url ? await arViewer(l.ar_config) : empty('No 3D model yet'), l.body && md(l.body));
  else if (l.type === 'vr') {
    const cfg = encodeURIComponent(JSON.stringify(l.ar_config || { entities: [] }));
    content = h('div', { class: 'stack' }, h('iframe', { class: 'vr-frame', src: '/vr.html#' + cfg, title: 'Virtual reality scene', allow: 'xr-spatial-tracking; accelerometer; gyroscope; fullscreen', allowfullscreen: true }), h('p', { class: 'hint' }, 'Drag to look around. On a phone, tap the goggles icon for headset mode.'), l.body && md(l.body));
  } else if (l.type === 'scorm') {
    content = h('div', { class: 'panel stack' }, h('p', 'This is an interactive SCORM lesson. It opens in its own tab so your progress and score are saved automatically.'),
      l.has_scorm ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { try { const w = window.open('about:blank', '_blank'); const x = await GET(`/lessons/${l.id}/scorm-launch`); if (w) w.location = x.url; else location.href = x.url; } catch (e) { fail(e); } } }, icon('play'), 'Launch lesson'), h('button', { class: 'btn', onclick: () => location.reload() }, 'Refresh my progress')) : h('div', { class: 'banner warn' }, h('p', 'The creator has not uploaded the SCORM package yet.')), l.body && md(l.body));
  }
  const done = h('button', { class: 'btn good', type: 'button' }, r.completed ? 'Completed. Continue' : 'Mark complete and continue');
  done.onclick = async () => {
    done.disabled = true;
    try {
      const x = await POST(`/lessons/${l.id}/complete`, {});
      if (x.xp_awarded) toast(`+${x.xp_awarded} XP${x.course_complete ? ' — course complete! 🎓' : ''}`, 'ok');
      (x.badges || []).forEach(b => toast(`New badge: ${b.icon} ${b.name}`, 'ok'));
      go(r.next ? '/lessons/' + r.next : '/courses/' + r.course.id);
    } catch (e) { fail(e); done.disabled = false; }
  };
  return h('div', { class: 'page narrow' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/courses/' + r.course.id }, r.course.title), ` / Lesson ${r.index} of ${r.total}`),
    h('div', { class: 'page-head' }, h('div', h('h1', l.title), h('p', { class: 'sub' }, `${LESSON_NAME[l.type]}, about ${l.duration_min} min`))),
    content,
    h('div', { class: 'lesson-nav' }, r.prev ? h('a', { class: 'btn', href: '#/lessons/' + r.prev }, 'Previous') : null, l.type !== 'scorm' || r.completed ? done : null, r.next && r.completed ? h('a', { class: 'btn quiet', href: '#/lessons/' + r.next }, 'Skip to next') : null, h('a', { class: 'btn quiet right', href: '#/courses/' + r.course.id }, 'All lessons')));
});
