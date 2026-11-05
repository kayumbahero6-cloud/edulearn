// Core helpers shared by every page: DOM builder (XSS-safe), API client, session, dialogs, toasts, markdown, i18n.
export const S = { user: null, token: null, meta: null, unread: 0, pendingFace: false };

/* ---------------- storage (never throws) ---------------- */
const mem = {};
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
};

/* ---------------- DOM builder: text always goes through textContent, so user content cannot inject markup ---------------- */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'for') el.htmlFor = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function mount(el, ...kids) { clear(el); return append(el, kids); }

/* ---------------- icons (constant markup only) ---------------- */
const P = {
  home: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z', book: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11', check: 'M4 12l5 5L20 6', trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM4 5h4v3a3 3 0 0 1-4-3zM20 5h-4v3a3 3 0 0 0 4-3zM12 13v4M8 21h8M10 17h4',
  chat: 'M4 5h16v11H9l-5 4z', users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0zM16 11a2.5 2.5 0 1 0 0-5M17 14a5 5 0 0 1 4 6', pencil: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', plus: 'M12 5v14M5 12h14', out: 'M10 4H4v16h6M15 8l4 4-4 4M19 12H9', play: 'M7 4l13 8-13 8z', cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5',
  vr: 'M3 8h18v8h-5l-2-3h-4l-2 3H3zM7 12h.01M17 12h.01', file: 'M6 3h9l4 4v14H6zM14 3v5h5', scorm: 'M4 5h16v14H4zM4 9h16M8 13h4', video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3', text: 'M5 6h14M5 11h14M5 16h9', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6', flag: 'M5 21V4M5 4h12l-2 4 2 4H5', send: 'M3 12 21 4l-6 17-3-7z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  star: 'M12 3l2.8 6 6.2.7-4.6 4.2 1.3 6.2L12 17l-5.7 3.1 1.3-6.2L3 9.7 9.2 9z', fire: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z', close: 'M6 6l12 12M18 6 6 18',
};
export function icon(name, size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.file); s.append(p);
  return s;
}

/* ---------------- API client ---------------- */
export class ApiError extends Error { constructor(msg, status, code, data) { super(msg); this.status = status; this.code = code; this.data = data; } }
let onAuthLost = () => {};
export const setAuthLostHandler = fn => { onAuthLost = fn; };
export async function api(method, path, body, opts = {}) {
  const headers = {};
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: payload, signal: opts.signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError('You appear to be offline. Check your connection and try again.', 0, 'offline'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && S.token && !opts.noAuthRedirect) onAuthLost();
    throw new ApiError((data && data.error) || 'Something went wrong', res.status, data && data.code, data);
  }
  return data;
}
export const GET = (p, o) => api('GET', p, undefined, o);
export const POST = (p, b, o) => api('POST', p, b ?? {}, o);
export const PUT = (p, b) => api('PUT', p, b ?? {});
export const DEL = (p, b) => api('DELETE', p, b);
export const qs = obj => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== null && v !== undefined && v !== false) u.set(k, v === true ? '1' : v); const s = u.toString(); return s ? '?' + s : ''; };

/* ---------------- session ---------------- */
export function setSession(token, user) {
  S.token = token; if (user) S.user = user;
  if (token) store.set('edu.token', token); else store.del('edu.token');
  if (user) applyPrefs(user);
}
export function applyPrefs(user) {
  const st = (user && user.settings) || {}, r = document.documentElement;
  r.style.fontSize = (Math.min(1.5, Math.max(0.85, Number(st.font_scale) || 1)) * 100) + '%';
  const set = (a, v) => (v ? r.setAttribute(a, v) : r.removeAttribute(a));
  set('data-contrast', st.high_contrast ? 'high' : ''); set('data-dyslexia', st.dyslexia_font ? '1' : ''); set('data-motion', st.reduce_motion ? 'reduce' : '');
  set('data-theme', st.theme === 'dark' || st.theme === 'light' ? st.theme : '');
  r.lang = (user && user.lang) || 'en';
}

/* ---------------- formatting ---------------- */
export const fmtDate = ms => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const fmtDay = ms => (ms ? new Date(ms).toLocaleDateString([], { dateStyle: 'medium' }) : '');
export function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return fmtDay(ms);
}
export const gradeLabel = k => ((S.meta && S.meta.grades.find(g => g.key === k)) || {}).label || k || '';
export const trackLabel = k => ((S.meta && S.meta.tracks.find(g => g.key === k)) || {}).label || k || '';
export const langLabel = k => ((S.meta && S.meta.languages.find(g => g.key === k)) || {}).label || k || '';
export const KIND = { practice: 'Practice quiz', adaptive: 'Adaptive quiz', test: 'Test', exam: 'Exam' };
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
export const pickColor = id => ['#1d3466', '#0f766e', '#7c3aed', '#c2410c', '#be185d', '#047857', '#2563eb', '#a16207'][Math.abs(id) % 8];

/* ---------------- toasts + dialogs ---------------- */
let toastHost;
export function toast(msg, kind = '') {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const el = h('div', { class: 'toast ' + kind }, msg); toastHost.append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 4200);
}
export const fail = e => { console.warn(e); toast(e && e.message ? e.message : 'Something went wrong', 'err'); };

export function dialog({ title, body, actions = [], onClose }) {
  const dlg = h('dialog', { class: 'modal', 'aria-label': title || 'Dialog' });
  const close = v => { dlg.close(); dlg.remove(); if (onClose) onClose(v); return v; };
  const bar = h('div', { class: 'actions' }, actions.map(a => h('button', {
    class: 'btn ' + (a.kind || ''), type: 'button',
    onclick: async ev => {
      if (a.onClick) { const b = ev.currentTarget; b.disabled = true; try { const r = await a.onClick(close); if (r === false) { b.disabled = false; return; } } catch (e) { b.disabled = false; fail(e); return; } }
      if (a.close !== false) close(a.value);
    },
  }, a.label)));
  mount(dlg, h('div', { class: 'body' }, title && h('h2', title), body, bar));
  dlg.addEventListener('cancel', () => { dlg.remove(); if (onClose) onClose(undefined); });
  document.body.append(dlg); dlg.showModal();
  const first = dlg.querySelector('input,select,textarea'); if (first) first.focus();
  return { el: dlg, close };
}
export const confirmBox = (message, { yes = 'Confirm', danger = false, title = 'Are you sure?' } = {}) => new Promise(res => {
  let done = false; const fin = v => { if (!done) { done = true; res(v); } };
  dialog({ title, body: h('p', message), onClose: () => fin(false), actions: [{ label: 'Cancel', value: false }, { label: yes, kind: danger ? 'danger solid' : 'primary', onClick: c => { fin(true); } }] });
});
export const askText = (title, { label = '', placeholder = '', multiline = true, yes = 'Send', required = 3 } = {}) => new Promise(res => {
  const input = multiline ? h('textarea', { placeholder, 'aria-label': label || title }) : h('input', { placeholder, 'aria-label': label || title });
  let done = false;
  dialog({ title, body: h('div', { class: 'field' }, label && h('label', label), input), onClose: () => { if (!done) res(null); },
    actions: [{ label: 'Cancel', value: null }, { label: yes, kind: 'primary', close: false, onClick: close => { if (input.value.trim().length < required) { toast(`Please write at least ${required} characters`, 'err'); return false; } done = true; res(input.value.trim()); close(); } }] });
});

/* ---------------- tiny safe markdown → DOM ---------------- */
function inline(parent, text) {
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) parent.append(h('strong', t.slice(2, -2)));
    else if (t.startsWith('`')) parent.append(h('code', t.slice(1, -1)));
    else if (t.startsWith('*')) parent.append(h('em', t.slice(1, -1)));
    else { const mm = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(t); parent.append(h('a', { href: mm[2], target: '_blank', rel: 'noopener noreferrer' }, mm[1])); }
    last = m.index + t.length;
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}
export function md(src) {
  const root = h('div', { class: 'md' });
  const L = String(src || '').replace(/\r/g, '').split('\n'); let i = 0;
  const blockStart = l => /^(#{1,4}\s|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+|```|\|.*\|\s*$)/.test(l);
  while (i < L.length) {
    const line = L[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^```/.test(line)) { const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; root.append(h('pre', h('code', buf.join('\n')))); continue; }
    let m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) { root.append(inline(h('h' + Math.max(2, Math.min(4, m[1].length + 1))), m[2])); i++; continue; }
    if (/^>\s?/.test(line)) { const bq = h('blockquote'); const buf = []; while (i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, '')); bq.append(inline(h('p'), buf.join(' '))); root.append(bq); continue; }
    if (/^\s*[-*]\s+/.test(line)) { const ul = h('ul'); while (i < L.length && /^\s*[-*]\s+/.test(L[i])) ul.append(inline(h('li'), L[i++].replace(/^\s*[-*]\s+/, ''))); root.append(ul); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const ol = h('ol'); while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) ol.append(inline(h('li'), L[i++].replace(/^\s*\d+[.)]\s+/, ''))); root.append(ol); continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(L[i + 1] || '')) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line); i += 2; const rows = [];
      while (i < L.length && /^\|.*\|\s*$/.test(L[i])) rows.push(cells(L[i++]));
      root.append(h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', head.map(c => inline(h('th'), c)))), h('tbody', rows.map(r => h('tr', r.map(c => inline(h('td'), c))))))));
      continue;
    }
    const buf = [line]; i++;
    while (i < L.length && !/^\s*$/.test(L[i]) && !blockStart(L[i])) buf.push(L[i++]);
    root.append(inline(h('p'), buf.join(' ')));
  }
  return root;
}

/* ---------------- i18n: interface chrome in 4 languages; course content has its own language field ---------------- */
const DICT = {
  en: { home: 'Home', courses: 'Courses', assessments: 'Assessments', progress: 'Progress', community: 'Community', classes: 'My classes', studio: 'Studio', review: 'Proctor review', admin: 'Admin', settings: 'Settings', signout: 'Sign out', notifications: 'Notifications', leaderboard: 'Leaderboard', chat: 'Chat', forum: 'Discussions', profile: 'Profile' },
  fr: { home: 'Accueil', courses: 'Cours', assessments: 'Évaluations', progress: 'Progrès', community: 'Communauté', classes: 'Mes classes', studio: 'Atelier', review: 'Revue de surveillance', admin: 'Admin', settings: 'Paramètres', signout: 'Se déconnecter', notifications: 'Notifications', leaderboard: 'Classement', chat: 'Messagerie', forum: 'Discussions', profile: 'Profil' },
  rw: { home: 'Ahabanza', courses: 'Amasomo', assessments: 'Isuzuma', progress: 'Aho ugeze', community: 'Umuryango', classes: 'Amasomo yanjye', studio: 'Aho dutegurira', review: 'Isuzuma ry’ikoranabuhanga', admin: 'Ubuyobozi', settings: 'Igenamiterere', signout: 'Sohoka', notifications: 'Ibimenyetso', leaderboard: 'Urutonde', chat: 'Ibiganiro', forum: 'Ibiganiro rusange', profile: 'Umwirondoro' },
  sw: { home: 'Mwanzo', courses: 'Kozi', assessments: 'Tathmini', progress: 'Maendeleo', community: 'Jamii', classes: 'Madarasa yangu', studio: 'Studio', review: 'Ukaguzi wa mitihani', admin: 'Msimamizi', settings: 'Mipangilio', signout: 'Toka', notifications: 'Arifa', leaderboard: 'Orodha ya alama', chat: 'Mazungumzo', forum: 'Majadiliano', profile: 'Wasifu' },
};
export const t = k => ((DICT[(S.user && S.user.lang) || 'en'] || DICT.en)[k]) || DICT.en[k] || k;

export const loading = () => h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' });
export function empty(title, text, action) { return h('div', { class: 'empty' }, h('h3', title), text && h('p', text), action); }
export const errorBox = e => h('div', { class: 'banner err', role: 'alert' }, h('p', e && e.message ? e.message : 'Could not load this page.'));
export const setTitle = s => { document.title = s ? `${s} · EduLearn` : 'EduLearn'; };
