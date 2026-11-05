// Camera + on-device face tooling. Face photos never leave the browser for matching: only 128-number templates are sent.
import { S } from './core.js';

let modelsP = null, cocoP = null;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });

export function loadModels() {
  if (!modelsP) modelsP = (async () => {
    if (!window.faceapi) await loadScript('/vendor/face-api/face-api.js');
    const f = window.faceapi, base = '/vendor/face-api/model';
    await Promise.all([f.nets.tinyFaceDetector.loadFromUri(base), f.nets.faceLandmark68TinyNet.loadFromUri(base), f.nets.faceRecognitionNet.loadFromUri(base)]);
    return f;
  })().catch(e => { modelsP = null; throw new Error('Face models could not load. Check your connection and try again.'); });
  return modelsP;
}

// Optional object detector (phones, books, extra people). Needs the COCO-SSD weights; if they cannot load we run in "degraded" mode and say so.
export function loadObjectModel() {
  if (!cocoP) cocoP = (async () => {
    const f = await loadModels();
    if (!window.tf) window.tf = f.tf;
    if (!window.cocoSsd) await loadScript('/vendor/coco/coco-ssd.min.js');
    const custom = S.meta && S.meta.features && S.meta.features.coco_model_url;
    const model = await Promise.race([
      window.cocoSsd.load(custom ? { modelUrl: custom } : { base: 'lite_mobilenet_v2' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000)),
    ]);
    return model;
  })().catch(() => null);
  return cocoP;
}

export async function startCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use a camera. Try the latest Chrome, Edge, Firefox or Safari over HTTPS.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }); }
  catch (e) {
    throw new Error(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.' : e.name === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera could not be started: ' + e.message);
  }
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  return stream;
}
export const stopCamera = stream => { if (stream) stream.getTracks().forEach(t => t.stop()); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const opts = () => new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
export async function countFaces(video) { return (await window.faceapi.detectAllFaces(video, opts())).length; }
export async function describeOne(video) {
  const f = window.faceapi;
  const all = await f.detectAllFaces(video, opts()).withFaceLandmarks(true).withFaceDescriptors();
  if (!all.length) return { count: 0 };
  all.sort((a, b) => b.detection.box.area - a.detection.box.area);
  const d = all[0];
  return { count: all.length, descriptor: Array.from(d.descriptor), box: d.detection.box, yaw: yawOf(d.landmarks), score: d.detection.score };
}
function yawOf(lm) { const p = lm.positions; const l = p[0].x, r = p[16].x, n = p[30].x; return r === l ? 0.5 : (n - l) / (r - l); }

// Turn-your-head liveness: a printed photo or a screen replay cannot follow a prompt to turn left AND right.
export async function liveness(video, say, { timeoutMs = 14000 } = {}) {
  const f = window.faceapi; const t0 = Date.now(); let min = 1, max = 0, seen = 0, centred = 0;
  say('Look at the camera, then slowly turn your head to one side and then the other.');
  while (Date.now() - t0 < timeoutMs) {
    const d = await f.detectSingleFace(video, opts()).withFaceLandmarks(true);
    if (d) { const y = yawOf(d.landmarks); seen++; min = Math.min(min, y); max = Math.max(max, y); if (y > .42 && y < .58) centred++;
      if (min < .36 && max > .64) { say('Great. Now look straight at the camera.'); await sleep(500); return { passed: true, range: +(max - min).toFixed(2), frames: seen }; } }
    await sleep(110);
  }
  return { passed: false, range: +(max - min).toFixed(2), frames: seen, centred };
}

// Take several clear descriptors while the person holds still.
export async function sampleDescriptors(video, n, say) {
  const out = []; const t0 = Date.now();
  while (out.length < n && Date.now() - t0 < 15000) {
    const r = await describeOne(video);
    if (r.count === 1 && r.score > 0.6 && r.yaw > .38 && r.yaw < .62) { out.push(r.descriptor); say(`Hold still (${out.length}/${n})`); await sleep(350); }
    else { say(r.count > 1 ? 'Only one person should be in view.' : r.count === 0 ? 'We cannot see your face. Move closer and face the light.' : 'Look straight at the camera.'); await sleep(200); }
  }
  return out;
}

export function snapshot(video, maxW = 360, quality = 0.6) {
  const c = document.createElement('canvas'); const r = video.videoHeight / (video.videoWidth || 1);
  c.width = maxW; c.height = Math.round(maxW * (r || .75));
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Frame-difference motion meter used for the "show your arms" and "pan your room" checks.
export function motionMeter(video) {
  const W = 96, H = 72, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  let prev = null;
  return {
    sample() {
      x.drawImage(video, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data;
      const g = new Uint8Array(W * H); for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
      let left = 0, right = 0, all = 0, ln = 0, rn = 0;
      if (prev) for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
        const v = Math.abs(g[yy * W + xx] - prev[yy * W + xx]) > 22 ? 1 : 0; all += v;
        if (xx < W * 0.34) { left += v; ln++; } else if (xx > W * 0.66) { right += v; rn++; }
      }
      const out = prev ? { left: left / ln, right: right / rn, all: all / (W * H) } : { left: 0, right: 0, all: 0 };
      prev = g; return out;
    },
  };
}

export function drawBoxes(canvas, video, boxes, color = '#f4b400') {
  canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
  const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); g.lineWidth = 3; g.strokeStyle = color;
  for (const b of boxes) g.strokeRect(b.x, b.y, b.width, b.height);
}
