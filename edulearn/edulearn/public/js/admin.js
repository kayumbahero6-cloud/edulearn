import { S, h, mount, GET, POST, toast, fail, loading, empty, errorBox, setTitle, fmtDate, ago, gradeLabel, trackLabel, confirmBox, askText, debounce } from './core.js';
import { route, go } from './router.js';

route('/admin', async ({ query }) => {
  if (!['admin', 'moderator'].includes(S.user.role)) return errorBox({ message: 'This area is for administrators and moderators.' });
  setTitle('Admin');
  const tab = ['overview', 'courses', 'reports', 'users', 'appeals', 'audit'].includes(query.tab) ? query.tab : 'overview';
  const body = h('div');
  const tabsDef = [['overview', 'Overview'], ['courses', 'Course review'], ['reports', 'Reports'], ['appeals', 'Appeals'], ['users', 'Users'], S.user.role === 'admin' && ['audit', 'Audit log']].filter(Boolean);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tabsDef.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => go('/admin?tab=' + k) }, l)));
  ({ overview, courses, reports, users, appeals, audit }[tab])(body);
  return h('div', { class: 'page wide' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Admin'), h('p', { class: 'sub' }, S.user.role === 'admin' ? 'Platform administration.' : 'Moderation tools.'))), tabs, body);
});

async function overview(root) {
  mount(root, loading());
  try {
    const o = await GET('/admin/overview'); const fig = (n, l) => h('div', { class: 'fig' }, h('b', n), h('span', l));
    mount(root, h('div', { class: 'stack loose' }, h('div', { class: 'figures' }, fig(o.users.total, 'users'), fig(o.users.students, 'students'), fig(o.users.educators, 'educators'), fig(o.users.creators, 'creators'), fig(o.users.active_24h, 'active today'), fig(o.users.face_enrolled, 'face enrolled')),
      h('div', { class: 'figures' }, fig(o.schools, 'schools'), fig(o.classrooms, 'classes'), fig(o.courses.published, 'published courses'), fig(o.attempts.total, 'submitted attempts')),
      h('div', { class: 'row' }, o.courses.pending > 0 && h('a', { class: 'banner warn', style: { textDecoration: 'none', color: 'inherit' }, href: '#/admin?tab=courses' }, `${o.courses.pending} course${o.courses.pending > 1 ? 's' : ''} waiting for review`), o.reports_open > 0 && h('a', { class: 'banner err', style: { textDecoration: 'none', color: 'inherit' }, href: '#/admin?tab=reports' }, `${o.reports_open} open report${o.reports_open > 1 ? 's' : ''}`), o.attempts.flagged > 0 && h('a', { class: 'banner warn', style: { textDecoration: 'none', color: 'inherit' }, href: '#/proctor' }, `${o.attempts.flagged} flagged exam attempt${o.attempts.flagged > 1 ? 's' : ''}`), o.appeals_open > 0 && h('a', { class: 'banner', style: { textDecoration: 'none', color: 'inherit' }, href: '#/admin?tab=appeals' }, `${o.appeals_open} open appeal${o.appeals_open > 1 ? 's' : ''}`))));
  } catch (e) { mount(root, errorBox(e)); }
}

async function courses(root) {
  mount(root, loading());
  try {
    const r = await GET('/admin/courses/pending');
    const act = (c, decision) => async () => { let note = ''; if (decision === 'reject') { note = await askText('What should the creator fix?', { yes: 'Send feedback', required: 3 }); if (!note) return; } try { await POST(`/admin/courses/${c.id}/review`, { decision, note }); toast(decision === 'approve' ? 'Course published' : 'Feedback sent', 'ok'); courses(root); } catch (e) { fail(e); } };
    mount(root, r.courses.length ? h('div', { class: 'list' }, r.courses.map(c => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', c.title), h('span', { class: 'meta' }, `${c.creator_name}, ${gradeLabel(c.grade_level)}, ${trackLabel(c.track)}, ${c.lessons} lessons, updated ${ago(c.updated_at)}`)), h('a', { class: 'btn sm', href: '#/courses/' + c.id }, 'Preview'), h('button', { class: 'btn sm good', onclick: act(c, 'approve') }, 'Approve'), h('button', { class: 'btn sm danger', onclick: act(c, 'reject') }, 'Request changes')))) : empty('No courses waiting', 'Submitted courses appear here for review.'));
  } catch (e) { mount(root, errorBox(e)); }
}

async function reports(root) {
  mount(root, loading());
  try {
    const r = await GET('/admin/reports');
    const act = (rep, action) => async () => { try { await POST(`/admin/reports/${rep.id}/resolve`, { action }); toast('Report resolved', 'ok'); reports(root); } catch (e) { fail(e); } };
    mount(root, r.reports.length ? h('div', { class: 'stack' }, r.reports.map(x => h('div', { class: 'panel stack tight' }, h('div', { class: 'row' }, h('span', { class: 'chip ' + (x.priority >= 3 ? 'ember' : x.priority === 2 ? 'sun' : 'plain') }, x.priority >= 3 ? 'Urgent: welfare' : x.priority === 2 ? 'Safety' : 'Report'), h('span', { class: 'muted small' }, `${x.target_type} #${x.target_id}, ${ago(x.created_at)}${x.reporter ? ', reported by ' + x.reporter : ', raised automatically'}`)),
      x.content && h('blockquote', { style: { margin: 0, padding: '.5rem 1rem', borderLeft: '4px solid var(--line)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, x.content), x.author && h('p', { class: 'small muted' }, 'Written by ' + x.author), h('p', x.reason),
      x.priority >= 3 && h('div', { class: 'banner err' }, h('p', 'A learner may be at risk. Please contact their teacher or a safeguarding lead promptly and follow your school’s child-protection procedure.')),
      h('div', { class: 'row' }, ['thread', 'post', 'chat'].includes(x.target_type) && x.content && h('button', { class: 'btn sm danger', onclick: act(x, 'remove') }, 'Remove content'), x.author_id && h('button', { class: 'btn sm', onclick: act(x, 'mute') }, 'Mute author for 24 h'), h('button', { class: 'btn sm', onclick: act(x, 'dismiss') }, 'Dismiss'))))) : empty('No open reports', 'Nothing needs moderating right now.'));
  } catch (e) { mount(root, errorBox(e)); }
}

async function appeals(root) {
  mount(root, loading());
  try { const r = await GET('/admin/appeals'); mount(root, r.appeals.length ? h('div', { class: 'list' }, r.appeals.map(a => h('a', { class: 'item', href: '#/proctor/' + a.attempt_id }, h('div', { class: 'grow' }, h('strong', `${a.student}, ${a.title}`), h('span', { class: 'meta' }, a.message), h('span', { class: 'meta' }, ago(a.created_at))), h('span', { class: 'btn sm' }, 'Review')))) : empty('No open appeals')); } catch (e) { mount(root, errorBox(e)); }
}

async function users(root) {
  const q = h('input', { type: 'search', placeholder: 'Search name or email', 'aria-label': 'Search users' }), role = h('select', { 'aria-label': 'Role' }, [['', 'All roles'], ...['student', 'educator', 'creator', 'moderator', 'admin'].map(x => [x, x])].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div'); const load = async () => {
    mount(out, loading());
    try {
      const r = await GET('/admin/users?q=' + encodeURIComponent(q.value) + (role.value ? '&role=' + role.value : ''));
      const isAdmin = S.user.role === 'admin';
      mount(out, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', h('tr', ['Name', 'Email', 'Role', 'School', 'Joined', 'Status', ''].map(x => h('th', x)))), h('tbody', r.users.map(u => h('tr', h('td', u.name, u.face_enrolled ? h('span', { class: 'chip leaf', style: { marginLeft: '.4rem' } }, 'Face') : null), h('td', u.email), h('td', isAdmin && u.id !== S.user.id ? h('select', { 'aria-label': 'Role for ' + u.name, onchange: async e => { try { await POST('/admin/users/' + u.id, { role: e.target.value }); toast('Role updated', 'ok'); } catch (x) { fail(x); load(); } } }, ['student', 'educator', 'creator', 'moderator', 'admin'].map(x => h('option', { value: x, selected: x === u.role }, x))) : u.role), h('td', u.school || ''), h('td', ago(u.created_at)),
        h('td', h('span', { class: 'chip ' + (u.status === 'active' ? 'leaf' : 'ember') }, u.status), u.muted_until > Date.now() && h('span', { class: 'chip sun', style: { marginLeft: '.3rem' } }, 'Muted')), h('td', isAdmin && u.id !== S.user.id && u.status !== 'deleted' ? h('div', { class: 'row' }, h('button', { class: 'btn sm ' + (u.status === 'active' ? 'danger' : ''), onclick: async () => { if (u.status === 'active' && !(await confirmBox(`Suspend ${u.name}? They will be signed out and unable to sign in.`, { yes: 'Suspend', danger: true }))) return; try { await POST('/admin/users/' + u.id, { status: u.status === 'active' ? 'suspended' : 'active' }); load(); } catch (e) { fail(e); } } }, u.status === 'active' ? 'Suspend' : 'Reactivate'), u.muted_until > Date.now() && h('button', { class: 'btn sm', onclick: async () => { await POST('/admin/users/' + u.id, { unmute: true }).catch(fail); load(); } }, 'Unmute')) : null)))))));
    } catch (e) { mount(out, errorBox(e)); }
  };
  q.addEventListener('input', debounce(load, 300)); role.addEventListener('change', load);
  mount(root, h('div', { class: 'row', style: { marginBottom: '1rem' } }, h('div', { style: { flex: '1 1 260px' } }, q), h('div', { style: { width: '170px' } }, role)), out); load();
}

async function audit(root) {
  if (S.user.role !== 'admin') return mount(root, errorBox({ message: 'Admins only' }));
  mount(root, loading());
  try { const r = await GET('/admin/audit'); mount(root, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', h('tr', ['When', 'Who', 'Action', 'Detail', 'IP'].map(x => h('th', x)))), h('tbody', r.log.map(l => h('tr', h('td', fmtDate(l.created_at)), h('td', l.name || ''), h('td', l.action), h('td', { class: 'small', style: { overflowWrap: 'anywhere' } }, l.detail), h('td', l.ip || ''))))))); } catch (e) { mount(root, errorBox(e)); }
}
