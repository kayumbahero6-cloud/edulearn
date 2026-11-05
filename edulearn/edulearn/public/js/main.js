import { S, h, mount, clear, GET, POST, icon, store, setSession, setAuthLostHandler, applyPrefs, loading, errorBox, empty, t, toast, setTitle } from './core.js';
import { route, routes, match, parse, go, runLeaves, nextToken, isCurrent } from './router.js';
import { loginPage, registerPage, afterAuth } from './auth.js';
import './learn.js'; import './assess.js'; import './proctor.js'; import './social.js'; import './home.js'; import './studio.js'; import './admin.js';
import { wsClose } from './social.js';

route('/login', loginPage, { bare: true });
route('/register', registerPage, { bare: true });

const app = document.getElementById('app');
let view = null, shell = null;

const NAV = {
  student: [['/', 'home', 'home'], ['/courses', 'courses', 'book'], ['/assessments', 'assessments', 'check'], ['/progress', 'progress', 'trophy'], ['/community', 'community', 'chat'], ['/classes', 'classes', 'users']],
  educator: [['/', 'home', 'home'], ['/classes', 'classes', 'users'], ['/studio', 'studio', 'pencil'], ['/courses', 'courses', 'book'], ['/assessments', 'assessments', 'check'], ['/proctor', 'review', 'camera'], ['/community', 'community', 'chat']],
  creator: [['/', 'home', 'home'], ['/studio', 'studio', 'pencil'], ['/courses', 'courses', 'book'], ['/community', 'community', 'chat']],
  moderator: [['/', 'home', 'home'], ['/admin', 'admin', 'shield'], ['/proctor', 'review', 'camera'], ['/courses', 'courses', 'book'], ['/community', 'community', 'chat']],
  admin: [['/', 'home', 'home'], ['/admin', 'admin', 'shield'], ['/proctor', 'review', 'camera'], ['/courses', 'courses', 'book'], ['/studio', 'studio', 'pencil'], ['/community', 'community', 'chat']],
};

function logout() {
  runLeaves(); wsClose(); setSession(null, null); S.user = null; shell = null; view = null; applyPrefs(null); clear(app); go('/login', true);
}
setAuthLostHandler(() => { if (S.user) { toast('Please sign in again', 'err'); logout(); } });

function buildShell() {
  const items = NAV[S.user.role] || NAV.student;
  const link = ([href, key, ic]) => h('a', { href: '#' + href, dataset: { href } }, icon(ic), h('span', t(key)));
  const bell = h('a', { href: '#/notifications', dataset: { href: '/notifications' } }, icon('bell'), h('span', t('notifications')), h('span', { class: 'count hide', id: 'unread' }, '0'));
  const rail = h('aside', { class: 'rail', 'aria-label': 'Main' }, h('a', { class: 'brand', href: '#/' }, h('i'), 'EduLearn'), h('nav', { class: 'nav', 'aria-label': 'Primary' }, items.map(link), h('div', { class: 'sep' }), bell, link(['/settings', 'settings', 'gear'])),
    h('div', { class: 'rail-foot' }, h('div', { class: 'who' }, h('strong', S.user.name), h('small', S.user.school ? S.user.school.name : S.user.role)), h('button', { class: 'btn sm block', onclick: logout }, icon('out'), t('signout'))));
  const top = h('header', { class: 'topbar' }, h('a', { class: 'brand', href: '#/' }, h('i'), 'EduLearn'), h('a', { class: 'btn sm', href: '#/notifications', 'aria-label': t('notifications') }, icon('bell'), h('span', { class: 'count hide', id: 'unread2', style: { background: 'var(--sun)', color: '#111', borderRadius: '99px', padding: '0 .4rem', fontSize: '.75rem' } }, '0')), h('a', { class: 'btn sm', href: '#/settings', 'aria-label': t('settings') }, icon('gear')), h('button', { class: 'btn sm', onclick: logout, 'aria-label': t('signout') }, icon('out')));
  const tabKeys = items.slice(0, 5);
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, tabKeys.map(([href, key, ic]) => h('a', { href: '#' + href, dataset: { href } }, icon(ic), h('span', t(key)))));
  view = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  shell = h('div', { class: 'shell' }, rail, h('div', { class: 'main-wrap', style: { minWidth: 0 } }, top, view), tabbar);
  mount(app, shell);
  document.addEventListener('edu:unread', paintUnread);
}
function paintUnread() { for (const id of ['unread', 'unread2']) { const el = document.getElementById(id); if (el) { el.textContent = S.unread > 99 ? '99+' : S.unread; el.classList.toggle('hide', !S.unread); } } }
async function pollUnread() { if (!S.user) return; try { const r = await GET('/notifications'); S.unread = r.unread; paintUnread(); } catch { /* offline */ } }
setInterval(pollUnread, 60000);

function markNav(path) {
  if (!shell) return;
  const best = [...shell.querySelectorAll('[data-href]')].filter(a => { const hr = a.dataset.href; return hr === '/' ? path === '/' : path === hr || path.startsWith(hr + '/') || (hr === '/classes' && path.startsWith('/classes')) || (hr === '/studio' && path.startsWith('/studio')) || (hr === '/proctor' && path.startsWith('/proctor')) || (hr === '/assessments' && (path.startsWith('/take') || path.startsWith('/attempt') || path.startsWith('/results') || path.startsWith('/precheck'))) || (hr === '/community' && path.startsWith('/forum')) || (hr === '/courses' && path.startsWith('/lessons')); });
  shell.querySelectorAll('[data-href]').forEach(a => a.removeAttribute('aria-current'));
  best.forEach(a => a.setAttribute('aria-current', 'page'));
}

async function render() {
  const token = nextToken(); runLeaves();
  const { path, query } = parse();
  const m = match(path);
  const publicPath = path === '/login' || path === '/register';
  if (!S.user && !publicPath) return go('/login', true);
  if (S.user && publicPath) return go('/', true);
  if (!m) { if (!S.user) return go('/login', true); if (!shell) buildShell(); markNav(path); return mount(view, h('div', { class: 'page narrow' }, empty('Page not found', 'That page does not exist or has moved.', h('a', { class: 'btn primary', href: '#/' }, 'Go home')))); }
  if (m.route.opts.bare) { shell = null; view = null; setTitle(path === '/login' ? 'Sign in' : 'Create account'); mount(app, m.route.handler({ params: m.params, query })); return; }
  if (!shell || !app.contains(shell)) buildShell();
  markNav(path);
  mount(view, h('div', { class: 'page' }, loading()));
  try {
    const node = await m.route.handler({ params: m.params, query });
    if (!isCurrent(token)) return;
    mount(view, node); window.scrollTo(0, 0); view.focus({ preventScroll: true });
  } catch (e) {
    if (!isCurrent(token)) return;
    console.warn(e);
    mount(view, h('div', { class: 'page narrow' }, errorBox(e), h('div', { class: 'row mt' }, h('button', { class: 'btn', onclick: render }, 'Try again'), h('a', { class: 'btn quiet', href: '#/' }, 'Go home'))));
  }
}

window.addEventListener('hashchange', render);
let banner = null;
const net = () => { if (!navigator.onLine && !banner) { banner = h('div', { class: 'offline', role: 'alert' }, 'You are offline. Some things will not work until you reconnect.'); document.body.prepend(banner); } else if (navigator.onLine && banner) { banner.remove(); banner = null; } };
window.addEventListener('online', net); window.addEventListener('offline', net); net();

async function boot() {
  try { S.meta = await GET('/meta'); } catch (e) { mount(app, h('div', { class: 'page narrow' }, errorBox(e), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'))); return; }
  const tok = store.get('edu.token');
  if (tok) {
    S.token = tok;
    try { const r = await GET('/auth/me', { noAuthRedirect: true }); if (r.pending_face) throw new Error('pending'); S.user = r.user; applyPrefs(r.user); pollUnread(); }
    catch { setSession(null, null); S.user = null; }
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await render();
}
boot();
