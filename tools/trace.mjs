// Vectorizes the exploded reference sheet into clean bezier paths, one per
// body part / detail layer. Output: src/character/traced.js (reference-pixel coords).
//
//   node tools/trace.mjs
//
// Only needs re-running if reference.jpeg changes; the rig in src/character/rig.js
// consumes the traced paths and places them around per-part pivots.
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import potrace from 'potrace';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const img = jpeg.decode(fs.readFileSync(path.join(ROOT, 'reference.jpeg')));
const { width: W, height: H, data } = img;

// Palette sampled from the reference.
const CLASSES = {
  white: [248, 248, 248],
  shadow: [229, 229, 229],
  body: [0x1f, 0x1e, 0x20],
  black: [5, 5, 5],
  belly: [0x53, 0x52, 0x56],
  cream: [0xf0, 0xe7, 0xdc],
  gray: [0x77, 0x73, 0x76],
  muzzle: [0xb5, 0xb5, 0xb5],
  stripe: [0x6d, 0x6d, 0x6d],
  frame: [0x35, 0x34, 0x36],
};
const classNames = Object.keys(CLASSES);
const cls = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  let best = 0, bd = Infinity;
  classNames.forEach((n, k) => {
    const c = CLASSES[n];
    const d = (data[i * 4] - c[0]) ** 2 + (data[i * 4 + 1] - c[1]) ** 2 + (data[i * 4 + 2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = k; }
  });
  cls[i] = best;
}
const C = Object.fromEntries(classNames.map((n, k) => [n, k]));

// Connected components of "ink" (anything not paper/shadow).
const ink = (p) => { const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2]; return (r + g + b) / 3 < 200 || (r > 200 && r - b > 10); };
const label = new Int32Array(W * H).fill(-1);
const comps = [];
for (let p0 = 0; p0 < W * H; p0++) {
  if (label[p0] >= 0 || !ink(p0)) continue;
  const id = comps.length, stack = [p0], c = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0 };
  label[p0] = id;
  while (stack.length) {
    const q = stack.pop(), x = q % W, y = (q / W) | 0;
    c.n++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
    for (const r of [q - 1, q + 1, q - W, q + W]) {
      if (r < 0 || r >= W * H || label[r] >= 0 || !ink(r)) continue;
      if (Math.abs((r % W) - x) > 1) continue;
      label[r] = id; stack.push(r);
    }
  }
  comps.push(c);
}
const big = comps.filter((c) => c.n > 150);
const compAt = (x, y) => label[y * W + x];

// Morphology helpers on a boolean mask.
function morph(mask, r, erode) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = erode ? 1 : 0;
    for (let dy = -r; dy <= r && (erode ? v : !v); dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const xx = x + dx, yy = y + dy;
      const m = xx >= 0 && yy >= 0 && xx < W && yy < H ? mask[yy * W + xx] : 0;
      if (erode && !m) { v = 0; break; }
      if (!erode && m) { v = 1; break; }
    }
    out[y * W + x] = v;
  }
  return out;
}
const open = (m, r = 2) => morph(morph(m, r, true), r, false);
const close = (m, r = 2) => morph(morph(m, r, false), r, true);

function maskFor(comp, pred, { clean = 0, fill = 0 } = {}) {
  let m = new Uint8Array(W * H);
  for (let y = comp.y0; y <= comp.y1; y++) for (let x = comp.x0; x <= comp.x1; x++) {
    const p = y * W + x;
    if (label[p] === comp.id && pred(p, x, y)) m[p] = 1;
  }
  if (clean) m = open(m, clean);
  if (fill) m = close(m, fill); // seal notches left where other parts overlapped
  return m;
}

function traceMask(mask) {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const v = mask[i] ? 0 : 255;
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255;
  }
  const buf = PNG.sync.write(png);
  return new Promise((res, rej) => {
    const t = new potrace.Potrace({ turdSize: 20, alphaMax: 1.0, optCurve: true, optTolerance: 0.35, threshold: 128 });
    t.loadImage(buf, (err) => {
      if (err) return rej(err);
      const tag = t.getPathTag();
      res(/ d="([^"]+)"/.exec(tag)[1].trim());
    });
  });
}

const byPoint = (x, y) => big.find((c) => c.id === compAt(x, y));
const P = {
  headCombo: byPoint(545, 220),
  earL: byPoint(340, 205), earR: byPoint(755, 205),
  glasses: byPoint(230, 259),
  muzzle: byPoint(860, 290),
  torso: byPoint(545, 420),
  armL: byPoint(270, 450), armR: byPoint(820, 450),
  legL: byPoint(420, 730), legR: byPoint(680, 730),
  tail: byPoint(960, 730),
};
for (const [k, v] of Object.entries(P)) if (!v) throw new Error('missing part ' + k);

const any = () => true;
const is = (...names) => (p) => names.some((n) => cls[p] === C[n]);
const jobs = {
  head: [P.headCombo, (p) => cls[p] !== C.cream && cls[p] !== C.white && cls[p] !== C.shadow, { clean: 1, fill: 9 }],
  hornL: [P.headCombo, (p, x) => x < 545 && cls[p] === C.cream, { clean: 1 }],
  hornR: [P.headCombo, (p, x) => x > 545 && cls[p] === C.cream, { clean: 1 }],
  earL: [P.earL, any], earLInner: [P.earL, is('gray', 'stripe', 'belly'), { clean: 2 }],
  earR: [P.earR, any], earRInner: [P.earR, is('gray', 'stripe', 'belly'), { clean: 2 }],
  glasses: [P.glasses, any],
  glassesLens: [P.glasses, is('black'), { clean: 1 }],
  glassesGlint: [P.glasses, is('stripe', 'gray'), { clean: 1 }],
  muzzle: [P.muzzle, any],
  nostrils: [P.muzzle, (p, x, y) => y < 318 && cls[p] !== C.muzzle && cls[p] !== C.shadow, { clean: 2 }],
  mouth: [P.muzzle, (p, x, y) => y >= 318 && cls[p] !== C.muzzle && cls[p] !== C.shadow, { clean: 1 }],
  torso: [P.torso, any], belly: [P.torso, is('belly', 'gray', 'stripe'), { clean: 2 }],
  armL: [P.armL, any], handL: [P.armL, is('black'), { clean: 2 }],
  armR: [P.armR, any], handR: [P.armR, is('black'), { clean: 2 }],
  legL: [P.legL, any], hoofL: [P.legL, is('black'), { clean: 2 }],
  legR: [P.legR, any], hoofR: [P.legR, is('black'), { clean: 2 }],
  tailTuft: [P.tail, (p, x, y) => x > 915, {}],
};

const out = { source: 'reference.jpeg', width: W, height: H, parts: {} };
for (const [name, [comp, pred, opts]] of Object.entries(jobs)) {
  const m = maskFor(comp, pred, opts);
  let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (m[i]) { n++; const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const d = await traceMask(m);
  out.parts[name] = { d, bbox: [x0, y0, x1 + 1, y1 + 1], area: n };
  console.log(name.padEnd(13), `${n}px`.padStart(8), [x0, y0, x1 + 1, y1 + 1].join(','));
}
fs.mkdirSync(path.join(ROOT, 'src/character'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/character/traced.js'),
  '// Generated by tools/trace.mjs from reference.jpeg. Do not edit by hand.\n' +
  `export default ${JSON.stringify(out, null, 1)};\n`);
console.log('wrote src/character/traced.js');
