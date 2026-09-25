// Evaluates model animation tracks at a time, mirroring Rive's interpolation
// (hold / linear / cubic-bezier ease on the key that starts each segment).
import { EASINGS } from './compile.js';

function bezierEase([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-5) break;
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sy(t);
  };
}
const EASE_FNS = Object.fromEntries(Object.entries(EASINGS).filter(([, v]) => v).map(([k, v]) => [k, bezierEase(v)]));

export function sampleTrack(keys, t) {
  if (!keys.length) return undefined;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0, ease = 'easeInOut'] = keys[i], [t1, v1] = keys[i + 1];
    if (t < t1) {
      if (typeof v0 !== 'number') return v0; // colors: hold
      if (ease === 'hold') return v0;
      const f = (t - t0) / (t1 - t0 || 1);
      const k = ease === 'linear' ? f : (EASE_FNS[ease] || EASE_FNS.easeInOut)(f);
      return v0 + (v1 - v0) * k;
    }
  }
  return keys[keys.length - 1][1];
}

/** Returns id -> {prop: value} for every animated property at time t. */
export function samplePose(anim, t) {
  const out = {};
  for (const tr of anim.tracks) {
    if (tr.prop === 'color' || tr.prop === 'strokeColor') continue;
    (out[tr.target] ||= {})[tr.prop] = sampleTrack(tr.keys, t);
  }
  return out;
}
