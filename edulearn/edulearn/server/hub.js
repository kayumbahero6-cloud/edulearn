'use strict';
// Real-time chat hub (WebSocket). One process holds rooms in memory; for multi-instance deployments set REDIS_URL
// and swap `fanout` for a pub/sub adapter (see docs/ARCHITECTURE.md). Persistence is in SQLite/Postgres so nothing is lost.
const { WebSocketServer } = require('ws');
const { q } = require('./db');
const C = require('./crypto');
const A = require('./access');
const M = require('./moderation');
const G = require('./gamification');
const { ageOf } = require('./auth');
const { notify } = require('./util');

const rooms = new Map();       // room -> Set<ws>
let wss;

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function fanout(room, obj) { const set = rooms.get(room); if (set) for (const ws of set) send(ws, obj); }
function broadcastDelete(room, id) { fanout(room, { type: 'delete', room, id }); }

function attach(server) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', ws => {
    ws.alive = true; ws.user = null; ws.joined = new Set(); ws.bucket = { n: 0, t: Date.now() };
    ws.on('pong', () => { ws.alive = true; });
    const authTimer = setTimeout(() => { if (!ws.user) ws.close(4001, 'auth timeout'); }, 8000);

    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      try { handle(ws, m); } catch (e) { send(ws, { type: 'error', error: 'Something went wrong' }); console.warn('[ws]', e.message); }
    });
    ws.on('close', () => { clearTimeout(authTimer); for (const r of ws.joined) leave(ws, r); });
  });

  setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch { /* ignore */ } }
  }, 30000).unref();
}

function leave(ws, room) {
  const set = rooms.get(room);
  if (set) { set.delete(ws); if (!set.size) rooms.delete(room); else presence(room); }
  ws.joined.delete(room);
}
function presence(room) {
  const set = rooms.get(room); if (!set) return;
  const users = [...new Map([...set].map(w => [w.user.id, { id: w.user.id, name: w.user.name }])).values()];
  fanout(room, { type: 'presence', room, users });
}

function handle(ws, m) {
  if (m.type === 'auth') {
    const p = C.verify(m.token);
    if (!p || p.typ !== 'session' || p.pend) return send(ws, { type: 'error', error: 'auth', fatal: true }), ws.close(4003, 'auth');
    const u = q.get('SELECT * FROM users WHERE id=?', p.uid);
    if (!u || u.status !== 'active') return ws.close(4003, 'auth');
    ws.user = u; ws.uid = u.id;
    return send(ws, { type: 'ready', rooms: A.roomsFor(u) });
  }
  if (!ws.user) return;
  // Re-read the user so suspensions and mutes apply to open sockets.
  const u = q.get('SELECT * FROM users WHERE id=?', ws.uid);
  if (!u || u.status !== 'active') return ws.close(4003, 'suspended');
  ws.user = u;

  if (m.type === 'join') {
    const ra = A.roomAccess(u, m.room);
    if (!ra) return send(ws, { type: 'error', room: m.room, error: 'You do not have access to that room' });
    if (!rooms.has(m.room)) rooms.set(m.room, new Set());
    rooms.get(m.room).add(ws); ws.joined.add(m.room);
    send(ws, { type: 'joined', room: m.room, name: ra.name, can_moderate: ra.moderate });
    return presence(m.room);
  }
  if (m.type === 'leave') return leave(ws, m.room);
  if (m.type === 'typing' && ws.joined.has(m.room)) {
    for (const o of rooms.get(m.room) || []) if (o !== ws) send(o, { type: 'typing', room: m.room, user: u.name });
    return;
  }
  if (m.type === 'send') {
    const room = m.room;
    if (!ws.joined.has(room) || !A.roomAccess(u, room)) return send(ws, { type: 'error', room, error: 'Join the room first' });
    const now = Date.now();
    if (now - ws.bucket.t > 10000) ws.bucket = { n: 0, t: now };
    if (++ws.bucket.n > 6) return send(ws, { type: 'rejected', room, reason: 'You are sending messages too fast. Wait a moment.' });
    if (u.muted_until > now) return send(ws, { type: 'rejected', room, reason: 'You are temporarily muted by a moderator.' });
    const r = M.check(String(m.body || ''), { minor: (ageOf(u) !== null && ageOf(u) < 18) });
    if (r.blocked) return send(ws, { type: 'rejected', room, reason: r.reasons.join('. ') || 'Message not allowed' });
    const body = r.text.slice(0, 1000);
    const id = q.run('INSERT INTO chat_messages(room,user_id,body,created_at) VALUES(?,?,?,?)', room, u.id, body, now).id;
    if (r.welfare) {
      q.run('INSERT INTO reports(reporter_id,target_type,target_id,reason,priority,created_at) VALUES(?,?,?,?,3,?)', null, 'chat', id, 'Possible welfare concern in chat', now);
      for (const s of q.all(`SELECT id FROM users WHERE role IN ('admin','moderator') AND status='active' LIMIT 20`)) notify(s.id, 'Urgent: welfare concern', 'A chat message needs a quick human look', '#/admin');
      send(ws, { type: 'care', room, text: r.welfareNote });
    }
    fanout(room, { type: 'message', room, message: { id, user_id: u.id, name: u.name, role: u.role, body, created_at: now } });
    G.touch(u.id);
    if (id % 5 === 0) G.checkBadges(u.id);
  }
}

module.exports = { attach, broadcastDelete, stats: () => ({ rooms: rooms.size, clients: wss ? wss.clients.size : 0 }) };
