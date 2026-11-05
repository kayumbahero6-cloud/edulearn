// Minimal hash router. Pages register themselves with route(); anything that needs cleanup (camera, sockets, timers) calls onLeave().
export const routes = [];
const leaves = [];
let current = 0;
export const route = (pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[a-z]+/gi, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, handler, opts });
};
export const onLeave = fn => { leaves.push(fn); };
export function runLeaves() { while (leaves.length) { try { leaves.pop()(); } catch (e) { console.warn(e); } } }
export const go = (hash, replace = false) => { const h = hash.startsWith('#') ? hash : '#' + hash; if (replace) location.replace(h); else location.hash = h; };
export function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}
export function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
export const nextToken = () => ++current;
export const isCurrent = t => t === current;
