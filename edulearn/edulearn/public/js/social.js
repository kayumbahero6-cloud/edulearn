import { S, h, mount, GET, POST, DEL, qs, toast, fail, icon, loading, empty, errorBox, setTitle, ago, fmtDate, confirmBox, askText, dialog, $ } from './core.js';
import { route, go, onLeave } from './router.js';

/* ---------------- WebSocket client with auto-reconnect ---------------- */
const ws = { sock: null, handlers: new Set(), joined: new Set(), tries: 0, closed: false, ready: false };
function wsConnect() {
  if (ws.sock && ws.sock.readyState <= 1) return;
  ws.closed = false;
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); ws.sock = s;
  s.onopen = () => { ws.tries = 0; s.send(JSON.stringify({ type: 'auth', token: S.token })); };
  s.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'ready') { ws.ready = true; for (const r of ws.joined) s.send(JSON.stringify({ type: 'join', room: r })); } ws.handlers.forEach(fn => fn(m)); };
  s.onclose = () => { ws.ready = false; ws.handlers.forEach(fn => fn({ type: 'offline' })); if (!ws.closed) setTimeout(wsConnect, Math.min(15000, 800 * 2 ** ws.tries++)); };
  s.onerror = () => {};
}
const wsSend = o => { if (ws.sock && ws.sock.readyState === 1 && ws.ready) { ws.sock.send(JSON.stringify(o)); return true; } return false; };
export function wsClose() { ws.closed = true; ws.joined.clear(); ws.handlers.clear(); if (ws.sock) ws.sock.close(); ws.sock = null; ws.ready = false; }

/* ---------------- community shell with tabs ---------------- */
route('/community', async ({ query }) => {
  setTitle('Community');
  const tab = ['chat', 'forum', 'leaderboard'].includes(query.tab) ? query.tab : 'chat';
  const body = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['chat', 'Live chat'], ['forum', 'Discussions'], ['leaderboard', 'Leaderboard']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => go('/community?tab=' + k) }, l)));
  if (tab === 'chat') chatTab(body, query); else if (tab === 'forum') forumTab(body, query); else boardTab(body);
  return h('div', { class: 'page wide' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Community'), h('p', { class: 'sub' }, 'Ask questions, help classmates and see how you are doing. Everything here is moderated for safety.'))), tabs, body);
});

/* ---------------- chat ---------------- */
async function chatTab(root, query) {
  mount(root, loading());
  let rooms; try { rooms = (await GET('/chat/rooms')).rooms; } catch (e) { return mount(root, errorBox(e)); }
  if (!rooms.length) return mount(root, empty('No chat rooms yet', S.user.role === 'student' ? 'Join a class with a code, or add a course, to chat with classmates.' : 'Rooms appear for your classes and courses.', S.user.role === 'student' ? h('a', { class: 'btn primary', href: '#/classes' }, 'Join a class') : null));
  let room = rooms.find(r => r.room === query.room) ? query.room : rooms[0].room, info = { can_moderate: false }; let seen = new Set();
  const list = h('div', { class: 'rooms', role: 'listbox', 'aria-label': 'Chat rooms' }), msgs = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' }), typing = h('div', { class: 'typing', 'aria-live': 'polite' }), presence = h('span', { class: 'small muted' });
  const title = h('strong'), status = h('span', { class: 'chip plain' }, 'Connecting…');
  const input = h('input', { type: 'text', maxlength: 1000, 'aria-label': 'Message', placeholder: 'Write a message', autocomplete: 'off' });
  let typingTimer, lastTyping = 0, typingNames = new Map();
  const bubble = m => {
    const mine = m.user_id === S.user.id;
    const el = h('div', { class: 'msg' + (mine ? ' me' : ''), dataset: { id: m.id } }, h('div', { class: 'who' }, mine ? 'You' : m.name, m.role !== 'student' && !mine ? ` (${m.role})` : '', ' ', h('span', ago(m.created_at))), h('div', { class: 'bubble' }, m.body),
      h('div', { class: 'tools' }, (mine || info.can_moderate) && h('button', { class: 'btn sm quiet', type: 'button', onclick: async () => { if (await confirmBox('Delete this message for everyone?', { yes: 'Delete', danger: true })) DEL('/chat/messages/' + m.id).catch(fail); } }, 'Delete'),
        !mine && h('button', { class: 'btn sm quiet', type: 'button', onclick: async () => { const r = await askText('Report this message', { label: 'What is wrong with it?', yes: 'Report', required: 3 }); if (r) POST('/report', { target_type: 'chat', target_id: m.id, reason: r }).then(() => toast('Thanks. A moderator will take a look.', 'ok')).catch(fail); } }, 'Report')));
    return el;
  };
  const add = m => { if (seen.has(m.id)) return; seen.add(m.id); const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120; msgs.append(bubble(m)); if (near || m.user_id === S.user.id) msgs.scrollTop = msgs.scrollHeight; };
  async function open(r) {
    if (ws.joined.has(room) && room !== r) { wsSend({ type: 'leave', room }); ws.joined.delete(room); }
    room = r; seen = new Set(); mount(msgs, loading()); typingNames.clear(); typing.textContent = '';
    drawRooms();
    try { const x = await GET(`/chat/${encodeURIComponent(room)}/history`); info = x.room; title.textContent = x.room.name; mount(msgs); if (!x.messages.length) msgs.append(h('p', { class: 'muted center' }, 'No messages yet. Say hello!')); else x.messages.forEach(add); msgs.scrollTop = msgs.scrollHeight; }
    catch (e) { mount(msgs, errorBox(e)); }
    ws.joined.add(room); wsSend({ type: 'join', room });
  }
  function drawRooms() { mount(list, rooms.map(r => h('button', { type: 'button', role: 'option', 'aria-current': String(r.room === room), 'aria-selected': String(r.room === room), onclick: () => open(r.room) }, r.name))); }
  const handler = m => {
    if (m.type === 'ready' || m.type === 'joined') { status.textContent = 'Live'; status.className = 'chip leaf'; }
    if (m.type === 'offline') { status.textContent = 'Reconnecting…'; status.className = 'chip sun'; }
    if (m.type === 'message' && m.room === room) { const msg = msgs.querySelector('p.muted'); if (msg) msg.remove(); add(m.message); typingNames.delete(m.message.name); renderTyping(); }
    if (m.type === 'delete' && m.room === room) { const el = msgs.querySelector(`[data-id="${m.id}"]`); if (el) el.remove(); }
    if (m.type === 'presence' && m.room === room) presence.textContent = `${m.users.length} online`;
    if (m.type === 'typing' && m.room === room) { typingNames.set(m.user, Date.now()); renderTyping(); setTimeout(renderTyping, 3200); }
    if (m.type === 'rejected' && m.room === room) toast(m.reason, 'err');
    if (m.type === 'care') dialog({ title: 'You are not alone', body: h('p', m.text), actions: [{ label: 'OK', kind: 'primary' }] });
    if (m.type === 'error' && m.error && !m.fatal) toast(m.error, 'err');
  };
  function renderTyping() { const now = Date.now(); const n = [...typingNames].filter(([, t]) => now - t < 3000).map(([k]) => k); typing.textContent = n.length ? `${n.slice(0, 2).join(' and ')} ${n.length > 1 ? 'are' : 'is'} typing…` : ''; }
  ws.handlers.add(handler); onLeave(() => { ws.handlers.delete(handler); for (const r of ws.joined) wsSend({ type: 'leave', room: r }); ws.joined.clear(); });
  wsConnect(); if (ws.ready) { status.textContent = 'Live'; status.className = 'chip leaf'; }
  const form = h('form', { class: 'composer', onsubmit: ev => { ev.preventDefault(); const t = input.value.trim(); if (!t) return; if (wsSend({ type: 'send', room, body: t })) input.value = ''; else toast('Not connected yet. Reconnecting…', 'err'); } }, input, h('button', { class: 'btn primary', type: 'submit' }, icon('send'), h('span', { class: 'sr' }, 'Send')));
  input.addEventListener('input', () => { if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); wsSend({ type: 'typing', room }); } });
  mount(root, h('div', { class: 'chat' }, list, h('div', { class: 'convo' }, h('header', title, presence, h('span', { class: 'right' }, status)), msgs, typing, form)));
  drawRooms(); open(room);
}

/* ---------------- forum ---------------- */
async function forumTab(root, query) {
  mount(root, loading());
  let scopes; try { scopes = (await GET('/forum/scopes')).scopes; } catch (e) { return mount(root, errorBox(e)); }
  if (!scopes.length) return mount(root, empty('No boards available', 'Boards appear for your classes, school and courses.'));
  const key = s => `${s.scope_type}:${s.scope_id}`;
  let cur = scopes.find(s => key(s) === query.scope) || scopes[0];
  const out = h('div'), sel = h('select', { id: 'fs', 'aria-label': 'Discussion board', onchange: e => { cur = scopes.find(s => key(s) === e.target.value); load(); } }, scopes.map(s => h('option', { value: key(s), selected: key(s) === key(cur) }, s.name)));
  async function load() {
    mount(out, loading());
    try {
      const r = await GET('/forum/threads' + qs({ scope_type: cur.scope_type, scope_id: cur.scope_id }));
      mount(out, r.threads.length ? h('div', { class: 'list' }, r.threads.map(t => h('a', { class: 'item', href: '#/forum/' + t.id }, h('div', { class: 'grow' }, h('strong', t.pinned ? ['📌 ', t.title] : t.title, !!t.locked && h('span', { class: 'chip plain', style: { marginLeft: '.5rem' } }, 'Locked')), h('span', { class: 'meta' }, `${t.author}${t.author_role !== 'student' ? ' (' + t.author_role + ')' : ''}, ${ago(t.last_post_at)}`)), h('span', { class: 'chip plain' }, `${t.replies} repl${t.replies === 1 ? 'y' : 'ies'}`)))) : empty('No discussions yet', 'Start one: ask a question or share a tip.'));
    } catch (e) { mount(out, errorBox(e)); }
  }
  const newThread = () => {
    const title = h('input', { maxlength: 150, 'aria-label': 'Title' }), body = h('textarea', { maxlength: 4000, 'aria-label': 'Message' });
    dialog({ title: 'Start a discussion', body: h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', 'Title'), title), h('div', { class: 'field' }, h('label', 'Message'), body), h('p', { class: 'hint' }, 'Be kind and stay on topic. Do not share phone numbers, emails or links. Messages are checked automatically and by moderators.')),
      actions: [{ label: 'Cancel' }, { label: 'Post', kind: 'primary', close: false, onClick: async close => { const r = await POST('/forum/threads', { scope_type: cur.scope_type, scope_id: cur.scope_id, title: title.value, body: body.value }); close(); go('/forum/' + r.id); } }] });
  };
  mount(root, h('div', { class: 'row', style: { marginBottom: '1rem' } }, h('div', { class: 'field grow', style: { maxWidth: '420px' } }, h('label', { for: 'fs' }, 'Board'), sel), h('button', { class: 'btn primary right', onclick: newThread }, icon('plus'), 'New discussion')), out); load();
}

route('/forum/:id', async ({ params }) => {
  const r = await GET('/forum/threads/' + params.id); const t = r.thread; setTitle(t.title);
  const mod = r.can_moderate, postsEl = h('div');
  const reportIt = (type, id) => async () => { const why = await askText('Report this', { label: 'What is wrong with it?', yes: 'Report' }); if (why) POST('/report', { target_type: type, target_id: id, reason: why }).then(() => toast('Thanks. A moderator will take a look.', 'ok')).catch(fail); };
  const byLine = (u, role, when) => h('div', { class: 'by' }, h('strong', u), role !== 'student' && h('span', { class: 'chip plain' }, role), h('span', ago(when)));
  const del = (kind, id) => async () => { if (await confirmBox('Delete this ' + kind + '?', { yes: 'Delete', danger: true })) try { await DEL(`/forum/${kind === 'discussion' ? 'threads' : 'posts'}/${id}`); kind === 'discussion' ? go('/community?tab=forum') : location.reload(); } catch (e) { fail(e); } };
  r.posts.forEach(p => postsEl.append(h('div', { class: 'post' }, byLine(p.author, p.author_role, p.created_at), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0, overflowWrap: 'anywhere' } }, p.body), h('div', { class: 'row', style: { marginTop: '.4rem' } }, p.author_id !== S.user.id && h('button', { class: 'btn sm quiet', onclick: reportIt('post', p.id) }, icon('flag', 14), 'Report'), (mod || p.author_id === S.user.id) && h('button', { class: 'btn sm quiet', onclick: del('reply', p.id) }, 'Delete')))));
  const body = h('textarea', { maxlength: 4000, 'aria-label': 'Your reply', placeholder: 'Write a reply…' });
  const reply = h('form', { class: 'stack mt', onsubmit: async ev => { ev.preventDefault(); if (!body.value.trim()) return; try { await POST(`/forum/threads/${t.id}/posts`, { body: body.value }); location.reload(); } catch (e) { fail(e); } } }, h('div', { class: 'field' }, h('label', 'Reply'), body), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Post reply'), h('span', { class: 'hint' }, 'No phone numbers, emails or links, please.')));
  return h('div', { class: 'page narrow' }, h('div', { class: 'crumbs' }, h('a', { href: '#/community?tab=forum' }, 'Discussions')),
    h('div', { class: 'page-head' }, h('div', h('h1', t.title), !!t.locked && h('span', { class: 'chip plain' }, 'Locked')), mod && h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: async () => { await POST(`/forum/threads/${t.id}/moderate`, { pinned: !t.pinned }); location.reload(); } }, t.pinned ? 'Unpin' : 'Pin'), h('button', { class: 'btn sm', onclick: async () => { await POST(`/forum/threads/${t.id}/moderate`, { locked: !t.locked }); location.reload(); } }, t.locked ? 'Unlock' : 'Lock'))),
    h('div', { class: 'post', style: { borderTop: '1px solid var(--line)' } }, byLine(t.author, t.author_role, t.created_at), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0, overflowWrap: 'anywhere' } }, t.body), h('div', { class: 'row', style: { marginTop: '.4rem' } }, t.author_id !== S.user.id && h('button', { class: 'btn sm quiet', onclick: reportIt('thread', t.id) }, icon('flag', 14), 'Report'), (mod || t.author_id === S.user.id) && h('button', { class: 'btn sm quiet', onclick: del('discussion', t.id) }, 'Delete'))),
    h('h2', { style: { marginTop: '1.5rem' } }, `${r.posts.length} repl${r.posts.length === 1 ? 'y' : 'ies'}`), postsEl, t.locked ? h('div', { class: 'banner mt' }, h('p', 'This discussion is locked.')) : reply);
});

/* ---------------- leaderboard ---------------- */
async function boardTab(root) {
  const f = { scope: S.user.school_id ? 'school' : 'global', period: 'all', classroom_id: '' };
  const out = h('div'); let classes = [];
  if (S.user.role === 'student' || S.user.role === 'educator') { try { classes = (await GET('/classrooms')).classrooms; } catch { /* optional */ } }
  const sel = (id, label, opts, key, onch) => h('div', { class: 'field', style: { minWidth: '160px' } }, h('label', { for: id }, label), h('select', { id, onchange: e => { f[key] = e.target.value; onch ? onch() : load(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l))));
  const ctrl = h('div', { class: 'filters', style: { marginBottom: '1rem' } });
  function drawCtrl() {
    mount(ctrl, sel('lb-scope', 'Compare with', [['school', 'My school'], ...(classes.length ? [['class', 'My class']] : []), ['global', 'Everyone']], 'scope', () => { if (f.scope === 'class' && !f.classroom_id) f.classroom_id = classes[0].id; drawCtrl(); load(); }),
      f.scope === 'class' && sel('lb-class', 'Class', classes.map(c => [String(c.id), c.name]), 'classroom_id'), sel('lb-per', 'Period', [['all', 'All time'], ['week', 'This week']], 'period'));
  }
  async function load() {
    mount(out, loading());
    try {
      const r = await GET('/leaderboard' + qs({ scope: f.scope, period: f.period, classroom_id: f.scope === 'class' ? (f.classroom_id || classes[0] && classes[0].id) : '' }));
      mount(out, r.board.length ? h('table', { class: 'board' }, h('thead', h('tr', h('th', 'Rank'), h('th', 'Learner'), h('th', { class: 'num' }, 'Level'), h('th', { class: 'num' }, 'Streak'), h('th', { class: 'num' }, 'Badges'), h('th', { class: 'num' }, r.period === 'week' ? 'XP this week' : 'XP'))),
        h('tbody', r.board.map(x => h('tr', { class: x.me ? 'me' : '' }, h('td', { class: 'rank' }, x.rank), h('td', x.name, x.me && h('span', { class: 'chip sun', style: { marginLeft: '.5rem' } }, 'You')), h('td', { class: 'num' }, x.level), h('td', { class: 'num' }, x.streak ? `${x.streak} d` : ''), h('td', { class: 'num' }, x.badges), h('td', { class: 'num' }, x.points.toLocaleString()))))) : empty('No one on the board yet', 'Complete a lesson or quiz to earn XP and appear here.'),
        r.me && !r.board.some(b => b.me) && S.user.role === 'student' && h('p', { class: 'muted mt' }, r.me.hidden ? 'You are hidden from the leaderboard. You can change this in Settings.' : 'Keep going to join the top 50.'), h('p', { class: 'hint mt' }, 'Others appear as first name and initial. You can hide yourself in Settings.'));
    } catch (e) { mount(out, errorBox(e)); }
  }
  drawCtrl(); mount(root, ctrl, out); load();
}
