// Proctoring UI. The system flags; teachers decide. Everything here is transparent to the learner (live preview, plain-language notices).
import { S, h, mount, GET, POST, toast, fail, icon, loading, empty, errorBox, setTitle, fmtDate, ago, confirmBox, askText, ApiError } from './core.js';
import { route, go, onLeave } from './router.js';
import * as F from './face.js';

const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/* ======================================================================= pre-exam check ======================================================================= */
route('/precheck/:id', async ({ params }) => {
  const aid = Number(params.id);
  const a = (await GET('/assessments/' + aid)).assessment; setTitle('Pre-exam check');
  const video = h('video', { autoplay: true, playsinline: true, muted: true, 'aria-label': 'Camera preview' });
  const overlay = h('canvas', { 'aria-hidden': 'true' });
  const status = h('p', { role: 'status', 'aria-live': 'polite', class: 'center' }, 'Loading the camera and checks…');
  const steps = [
    { key: 'face', title: 'Confirm it is you', text: 'Look at the camera. When asked, slowly turn your head to one side and then the other.' },
    { key: 'hands', title: 'Show your arms', text: 'Keep your face in view. Raise and wave your left arm, then your right arm, in front of the camera.' },
    { key: 'surroundings', title: 'Show your surroundings', text: 'Slowly show your desk, then turn the camera (or laptop) left and right to show the room. Nobody else should be there.' },
  ];
  const state = Object.fromEntries(steps.map(s => [s.key, { st: 'todo', reason: '' }])); let cur = 0, session = null, stream = null, busy = false, token = null, objModel = null, objState = 'idle';
  const list = h('ul', { class: 'checklist' });
  function drawList() {
    mount(list, steps.map((s, i) => { const x = state[s.key]; return h('li', { class: x.st === 'ok' ? 'ok' : x.st === 'bad' ? 'bad' : i === cur ? 'cur' : '' }, h('span', { class: 'ico' }, x.st === 'ok' ? icon('check', 16) : x.st === 'bad' ? '!' : i + 1),
      h('div', { class: 'grow' }, h('strong', s.title), h('div', { class: 'small muted' }, s.text), x.reason && h('div', { class: 'small', style: { color: 'var(--ember)', fontWeight: 700 }, role: 'alert' }, x.reason),
        i === cur && x.st !== 'ok' && h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('button', { class: 'btn primary sm', disabled: busy || !stream, onclick: () => run(s.key) }, x.st === 'bad' ? 'Try again' : 'Run this check')))); }));
  }
  const say = t => { status.textContent = t; };
  async function post(step, data, snap) { return POST(`/proctor/precheck/${session.id}/step`, { nonce: session.nonce, step, data, snapshot: snap }); }
  async function run(key) {
    busy = true; state[key] = { st: 'run', reason: '' }; drawList();
    try {
      let r;
      if (key === 'face') {
        const live = await F.liveness(video, say);
        if (!live.passed) { state.face = { st: 'bad', reason: 'We could not confirm a live person. Face the light and follow the head-turn prompt.' }; return; }
        const d = await F.sampleDescriptors(video, 1, say); if (!d.length) { state.face = { st: 'bad', reason: 'We could not get a clear face. Move closer and face the light.' }; return; }
        const n = await F.countFaces(video);
        r = await post('face', { descriptor: d[0], liveness: live, faces: n }, F.snapshot(video));
      } else if (key === 'hands') {
        const mm = F.motionMeter(video), L = [], R = []; let faceFrames = 0, total = 0, maxFaces = 0; say('Wave your left arm, then your right arm…');
        const t0 = Date.now(); let lastFace = 0;
        while (Date.now() - t0 < 9500) {
          const m = mm.sample(); L.push(m.left); R.push(m.right); total++;
          if (Date.now() - lastFace > 900) { lastFace = Date.now(); const n = await F.countFaces(video); maxFaces = Math.max(maxFaces, n); if (n >= 1) faceFrames++; }
          await F.sleep(120);
        }
        // The preview is mirrored, so the arm on the left of the picture is the learner's left arm = the right side of the raw frame.
        r = await post('hands', { left: pct(R, .9), right: pct(L, .9), samples: total, faceVisible: faceFrames >= 6, faces: maxFaces }, F.snapshot(video));
      } else {
        say('Loading object detection…'); if (objState === 'idle') { objState = 'loading'; objModel = await F.loadObjectModel(); objState = 'done'; }
        const mm = F.motionMeter(video), all = []; const maxCount = {}; let maxFaces = 0, total = 0; say('Slowly show your desk and the room…');
        const t0 = Date.now(); let lastDet = 0;
        while (Date.now() - t0 < 9500) {
          all.push(mm.sample().all); total++;
          if (Date.now() - lastDet > 1100) { lastDet = Date.now(); maxFaces = Math.max(maxFaces, await F.countFaces(video)); if (objModel) { const dets = await objModel.detect(video, 8, 0.5); const c = {}; dets.forEach(d => { c[d.class] = (c[d.class] || 0) + 1; }); for (const [k, v] of Object.entries(c)) maxCount[k] = Math.max(maxCount[k] || 0, v); } }
          await F.sleep(110);
        }
        const objects = Object.entries(maxCount).flatMap(([k, v]) => Array(v).fill(k));
        r = await post('surroundings', { panScore: all.reduce((s, x) => s + x, 0) / Math.max(1, all.length), seconds: (Date.now() - t0) / 1000, samples: total, objects, maxFaces, model: !!objModel }, F.snapshot(video));
      }
      const x = r;
      state[key] = x.ok ? { st: 'ok', reason: '' } : { st: 'bad', reason: x.reason };
      if (x.ok && cur < steps.length - 1) cur++;
      if (x.passed) { token = x.token; say(x.degraded ? 'All checks passed. Note: object detection was not available on this device, so your teacher will see that your room scan was limited.' : 'All checks passed.'); }
      else say(x.ok ? 'Check passed. Continue with the next one.' : x.reason);
    } catch (e) { state[key] = { st: 'bad', reason: e.message }; if (e instanceof ApiError && e.status === 410) { say('This check expired. Reloading…'); setTimeout(() => location.reload(), 900); } }
    finally { busy = false; drawList(); drawGo(); }
  }
  const begin = h('button', { class: 'btn good', disabled: true, onclick: async () => {
    begin.disabled = true;
    try { const x = await POST(`/assessments/${aid}/start`, { precheck_token: token }); F.stopCamera(stream); go('/take/' + x.attempt.id); } catch (e) { fail(e); begin.disabled = false; }
  } }, 'Start the exam');
  function drawGo() { begin.disabled = !token; }
  try {
    session = await POST('/proctor/precheck/start', { assessment_id: aid });
    await F.loadModels(); stream = await F.startCamera(video); onLeave(() => F.stopCamera(stream)); say('Camera ready. Run the checks in order.'); drawList();
  } catch (e) { say(e.message); drawList(); }
  drawList();
  return h('div', { class: 'page' }, h('div', { class: 'crumbs' }, h('a', { href: '#/assessments/' + aid }, a.title)),
    h('div', { class: 'page-head' }, h('div', h('h1', 'Pre-exam check'), h('p', { class: 'sub' }, 'Three quick checks before the camera-proctored exam. This takes about two minutes.'))),
    h('div', { class: 'exam' }, h('div', { class: 'stack' }, list, h('div', { class: 'row' }, begin, h('a', { class: 'btn quiet', href: '#/assessments/' + aid }, 'Cancel'))),
      h('div', { class: 'side' }, h('div', { class: 'cam' }, video, overlay, h('span', { class: 'live' }, 'Camera on')), status, h('p', { class: 'hint' }, 'Pictures from these checks are kept encrypted for your teacher to review and deleted automatically after the retention period.'))));
});

/* ======================================================================= continuous monitor ======================================================================= */
export async function startMonitor({ attemptId, holder, degraded, onWarn, onFatal }) {
  const video = h('video', { autoplay: true, playsinline: true, muted: true, 'aria-label': 'Your camera, monitored during the exam' }), canvas = h('canvas', { 'aria-hidden': 'true' });
  const note = h('p', { class: 'small', role: 'status' }, 'Monitoring is on. Stay in view and on this page.');
  const fsBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}) }, 'Enter full screen');
  mount(holder, h('div', { class: 'stack tight' }, h('div', { class: 'cam' }, video, canvas, h('span', { class: 'live' }, 'Proctoring')), note, !document.fullscreenElement && fsBtn, degraded && h('p', { class: 'hint' }, 'Object detection is unavailable on this device. Face and focus monitoring still run.')));
  await F.loadModels(); const objModel = await Promise.race([F.loadObjectModel(), F.sleep(8000).then(() => null)]);
  const stream = await F.startCamera(video);
  const queue = []; let stopped = false, wasFs = !!document.fullscreenElement, lastEmit = {}, noFace = 0, multi = 0, away = 0, tick = 0, lastDescAt = 0, lastObjAt = 0, inflight = false;
  const mm = F.motionMeter(video); let hot = 0;
  const SNAP = new Set(['multiple_faces', 'face_mismatch', 'object_detected', 'phone_detected', 'camera_stopped']);
  function emit(kind, detail = {}, minGap = 8000) {
    const now = Date.now(); if (stopped || (lastEmit[kind] && now - lastEmit[kind] < minGap)) return; lastEmit[kind] = now;
    queue.push({ kind, detail, snapshot: SNAP.has(kind) && video.videoWidth ? F.snapshot(video, 320, 0.55) : undefined });
    flush();
  }
  async function flush(extra = {}) {
    if (inflight && !extra.force) return; inflight = true;
    const events = queue.splice(0, 12);
    try {
      const r = await POST('/proctor/events', { attempt_id: attemptId, events, ...extra.body });
      if (r.notice && events.length) onWarn && onWarn(r.notice);
    } catch (e) { queue.unshift(...events); if (e.code === 'inactive') { stopped = true; } } finally { inflight = false; }
  }
  const beat = setInterval(() => flush({ body: {} }), 6000);
  stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { emit('camera_stopped', {}, 1000); onFatal && onFatal('Your camera stopped. Turn it back on right away or your teacher will be alerted.'); }));
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); }; const cleanups = [];
  on(document, 'visibilitychange', () => { if (document.hidden) emit('tab_hidden', {}, 3000); });
  on(window, 'blur', () => { if (!document.hidden) emit('window_blur', {}, 5000); });
  on(document, 'fullscreenchange', () => { const fs = !!document.fullscreenElement; if (wasFs && !fs) { emit('fullscreen_exit', {}, 3000); fsBtn.classList.remove('hide'); } wasFs = fs; });
  for (const ev of ['copy', 'cut', 'paste']) on(document, ev, e => { e.preventDefault(); emit('copy_paste', { ev }, 2000); });
  on(document, 'contextmenu', e => e.preventDefault());

  async function loop() {
    if (stopped) return;
    try {
      tick++;
      const r = await F.describeOne(video); const f = window.faceapi;
      drawBoxes(r);
      if (r.count === 0) { if (++noFace >= 3) { emit('face_missing', {}, 10000); noFace = 0; } } else noFace = 0;
      if (r.count > 1) { if (++multi >= 2) { emit('multiple_faces', { count: r.count }, 8000); multi = 0; } } else multi = 0;
      if (r.count === 1 && (r.yaw < 0.28 || r.yaw > 0.72)) { if (++away >= 4) { emit('looking_away', {}, 15000); away = 0; } } else away = 0;
      const m = mm.sample(); hot = m.all > 0.4 ? hot + 1 : 0; if (hot >= 5) { emit('excessive_motion', {}, 20000); hot = 0; }
      if (r.count === 1 && Date.now() - lastDescAt > 20000) { lastDescAt = Date.now(); flush({ force: true, body: { descriptor: r.descriptor } }); }
      if (objModel && Date.now() - lastObjAt > 4000) {
        lastObjAt = Date.now(); const dets = await objModel.detect(video, 8, 0.55); const names = dets.map(d => d.class);
        if (names.includes('cell phone')) emit('phone_detected', { cls: 'cell phone' }, 12000);
        else { const bad = names.find(n => ['book', 'laptop', 'tv', 'remote'].includes(n)); if (bad) emit('object_detected', { cls: bad }, 12000); }
        if (names.filter(n => n === 'person').length > 1) emit('multiple_faces', { source: 'object-model' }, 8000);
      }
    } catch (e) { /* a skipped frame is fine */ }
    if (!stopped) setTimeout(loop, 1300);
  }
  function drawBoxes(r) { canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480; const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); if (r.box) { g.strokeStyle = r.count > 1 ? '#d9482b' : '#2f8f4e'; g.lineWidth = 3; g.strokeRect(r.box.x, r.box.y, r.box.width, r.box.height); } }
  setTimeout(loop, 800);
  return { async stop() { if (stopped) return; stopped = true; clearInterval(beat); cleanups.forEach(f => f()); F.stopCamera(stream); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } };
}

/* ======================================================================= teacher review ======================================================================= */
const LABEL = { face_missing: 'Face not visible', multiple_faces: 'More than one person', face_mismatch: 'Face did not match', object_detected: 'Unauthorised object', phone_detected: 'Phone seen', tab_hidden: 'Left the exam tab', window_blur: 'Window lost focus', fullscreen_exit: 'Left full screen', copy_paste: 'Copy or paste attempt', excessive_motion: 'Lots of movement', monitoring_lost: 'Monitoring signal lost', camera_stopped: 'Camera stopped', looking_away: 'Looking away', devtools: 'Developer tools' };
const statusChip = s => h('span', { class: 'chip ' + (s === 'flagged' ? 'ember' : s === 'review' ? 'sun' : s === 'cleared' ? 'leaf' : s === 'voided' ? 'ember' : 'plain') }, { clear: 'No issues', review: 'Needs a look', flagged: 'Flagged', cleared: 'Cleared by teacher', voided: 'Invalidated', none: 'Not proctored' }[s] || s);

route('/proctor', async ({ query }) => {
  setTitle('Proctor review');
  const r = await GET('/proctor/queue');
  return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', h('h1', 'Proctor review'), h('p', { class: 'sub' }, 'Automatic flags and appeals that need a person. Nothing is invalidated until you decide.'))),
    r.attempts.length ? h('div', { class: 'list' }, r.attempts.map(x => h('a', { class: 'item', href: '#/proctor/' + x.id }, h('div', { class: 'grow' }, h('strong', x.student), h('span', { class: 'meta' }, `${x.title}, ${x.submitted_at ? 'submitted ' + ago(x.submitted_at) : 'in progress'}`)), x.appeals > 0 && h('span', { class: 'chip sun' }, `${x.appeals} appeal${x.appeals > 1 ? 's' : ''}`), h('span', { class: 'chip plain' }, `Risk ${x.risk}`), statusChip(x.proctor_status)))) : empty('Nothing to review', 'When an exam attempt is flagged or a learner appeals, it shows up here.'));
});

route('/proctor/:id', async ({ params }) => {
  const r = await GET('/proctor/attempts/' + params.id); setTitle('Review attempt');
  const snaps = h('div', { class: 'snaps' }, loading());
  (async () => {
    if (!r.snapshots || !r.snapshots.length) return mount(snaps, h('p', { class: 'muted' }, 'No pictures were saved for this attempt.'));
    mount(snaps); for (const s of r.snapshots) { const fig = h('figure', h('div', { class: 'skeleton', style: { height: '90px' } }), h('figcaption', `${LABEL[s.label] || s.label}, ${fmtDate(s.created_at)}`)); snaps.append(fig); GET('/proctor/snapshots/' + s.id).then(x => fig.firstChild.replaceWith(h('img', { src: x.data_url, alt: LABEL[s.label] || s.label }))).catch(() => { fig.firstChild.replaceWith(h('div', { class: 'small muted' }, 'Picture unavailable')); }); }
  })();
  const decide = async d => {
    const note = await askText(d === 'clear' ? 'Release this result' : 'Invalidate this attempt', { label: d === 'clear' ? 'Optional note for the learner' : 'Why is it being invalidated? The learner will see this.', yes: d === 'clear' ? 'Release result' : 'Invalidate attempt', required: d === 'clear' ? 0 : 5, multiline: true });
    if (note === null) return; try { await POST(`/proctor/attempts/${params.id}/decision`, { decision: d, note }); toast('Decision saved and the learner was notified', 'ok'); go('/proctor'); } catch (e) { fail(e); }
  };
  const steps = r.precheck && r.precheck.steps || {};
  const risk = Math.min(100, r.attempt.risk);
  return h('div', { class: 'page' }, h('div', { class: 'crumbs' }, h('a', { href: '#/proctor' }, 'Proctor review')),
    h('div', { class: 'page-head' }, h('div', h('h1', r.student ? r.student.name : 'Attempt'), h('p', { class: 'sub' }, r.assessment.title)), h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/attempt/' + params.id }, 'See answers'), r.attempt.proctor_status !== 'voided' && h('button', { class: 'btn good', onclick: () => decide('clear') }, 'Release result'), r.attempt.proctor_status !== 'voided' && h('button', { class: 'btn danger', onclick: () => decide('invalidate') }, 'Invalidate attempt'))),
    h('div', { class: 'row' }, statusChip(r.attempt.proctor_status), h('span', { class: 'muted' }, `Risk score ${r.attempt.risk} of 100`)), h('div', { class: 'risk mt', 'aria-hidden': 'true' }, h('i', { style: { left: `calc(${risk}% - 2px)` } })),
    h('div', { class: 'banner mt' }, h('p', 'Flags come from automatic detection, which can be wrong: glasses, poor light, a sibling walking by, or a weak connection can all trigger them. Please look at the evidence before deciding.')),
    r.attempt.proctor_note && h('div', { class: 'banner ok mt' }, h('p', h('strong', 'Decision note: '), r.attempt.proctor_note)),
    r.appeals.length > 0 && h('section', { class: 'block' }, h('h2', 'Learner appeals'), r.appeals.map(a => h('div', { class: 'banner warn', style: { marginBottom: '.5rem' } }, h('p', h('strong', fmtDate(a.created_at) + ': '), a.message), a.resolution && h('p', { class: 'small' }, 'Resolved: ' + a.resolution)))),
    h('section', { class: 'block' }, h('h2', 'Summary'), Object.keys(r.summary).length ? h('div', { class: 'row' }, Object.entries(r.summary).map(([k, v]) => h('span', { class: 'chip ' + (['multiple_faces', 'face_mismatch', 'phone_detected', 'camera_stopped'].includes(k) ? 'ember' : 'sun') }, `${LABEL[k] || k}: ${v}`))) : h('p', { class: 'muted' }, 'No events were recorded.')),
    r.precheck && h('section', { class: 'block' }, h('h2', 'Pre-exam check'), h('div', { class: 'row' }, ['face', 'hands', 'surroundings'].map(k => h('span', { class: 'chip ' + (steps[k] && steps[k].ok ? 'leaf' : 'ember') }, { face: 'Identity', hands: 'Arms shown', surroundings: 'Room scan' }[k] + (steps[k] && steps[k].ok ? ' passed' : ' not passed')))), r.precheck.degraded && h('p', { class: 'small muted mt' }, 'Object detection was unavailable on the learner’s device, so the room scan only checked for movement and faces.')),
    h('section', { class: 'block' }, h('h2', 'Pictures'), snaps),
    h('section', { class: 'block' }, h('h2', 'Timeline'), r.events.length ? h('div', { class: 'list' }, r.events.map(e => h('div', { class: 'item' }, h('span', { class: 'small muted', style: { width: '8rem' } }, new Date(e.created_at).toLocaleTimeString()), h('div', { class: 'grow' }, h('strong', LABEL[e.kind] || e.kind), Object.keys(e.detail || {}).length > 0 && h('span', { class: 'meta' }, Object.entries(e.detail).map(([k, v]) => `${k}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`).join(', '))), h('span', { class: 'chip plain' }, `+${e.severity}`)))) : h('p', { class: 'muted' }, 'Nothing to show.')));
});
