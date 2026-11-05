'use strict';
// Face descriptor helpers. Descriptors are 128-d vectors produced in the browser by face-api.js (FaceRecognitionNet).
// The server never receives or stores photos for matching, only these numeric templates (stored AES-256-GCM encrypted).
const C = require('./crypto');

const valid = d => Array.isArray(d) && d.length === 128 && d.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10)
  && Math.sqrt(d.reduce((s, x) => s + x * x, 0)) > 0.3; // reject all-zero / degenerate vectors

function distance(a, b) { let s = 0; for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
function average(list) {
  const out = new Array(128).fill(0);
  for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i] / list.length;
  return out;
}
const seal = d => C.encrypt(JSON.stringify(d));
const open = enc => JSON.parse(C.decryptText(enc));

module.exports = { valid, distance, average, seal, open };
