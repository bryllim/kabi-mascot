// Kabi's skeleton + artwork.
//
// Everything is authored in "assembled space": reference-sheet pixels after
// each exploded part has been slid into place (PART_OFFSETS). The builder turns
// world-space joints into parent-local transforms, which is what Rive stores.
//
// Skeleton (● = Rive bone, ○ = group node):
//   ○root ─ ○body ─┬─ ○tail ─ ●tail1 … ●tail8 ─ ○tailTip
//                  ├─ ○legL ─ ●thighL ●thighBL ● shinL ●shinBL ● footL   (same for R)
//                  └─ ○chest ─ ●spine1 ● spine2 ● spine3 ─┬─ ●neck1 ● neck2 ─ ○head ─┬─ ○earL ─ ●earL1 ● earL2
//                                                         │                          └─ horns, ○face ...
//                                                         ├─ ●clavicleL ─ ○armL ─ ●upperArmL (●bicepL) ●upperArmBL ● forearmL ●forearmBL ● wristL ─ ○handL ─ ○dumbbellL
//                                                         └─ ○armR ─ ...
// Limbs, torso and tail are single vector paths skinned to their bone chains,
// so they bend smoothly instead of hinging like cut-out pieces.
import traced from './traced.js';
import { LOGO } from './logo.js';
import { parsePath, transformContours, contoursToSvg } from '../riv/path.js';
import { compose, mul, invert, angleOf, apply } from '../riv/math.js';

export const PALETTE = {
  body: '#1f1e20',
  belly: '#535256',
  horn: '#f0e7dc',
  hoof: '#050505',
  innerEar: '#777376',
  muzzle: '#b5b5b5',
  nostril: '#757476',
  mouthShadow: '#777277',
  frame: '#353436',
  lens: '#050505',
  glint: '#6d6d6d',
  eyeWhite: '#ffffff',
  pupil: '#141316',
  brow: '#a9a7ab',
  mouth: '#2a282c',
  tongue: '#e8788a',
  sweat: '#6cc4ff',
  zzz: '#8d97bd',
  sparkle: '#ffc93c',
  accent: '#ff5a2e',
  metal: '#3b3b40',
  dbHandle: '#9a9aa0',
  dbPlate: '#2e2e33',
  dbRim: '#5c5c63',
  rope: '#9c9ca4',
  shadow: '#00000024',
  shirt: '#000000',
  shirtShade: '#2a2a2e',
  logo: '#9a9aa0',
  outline: '#5c5b62',
};

// Silhouette outline (for dark backgrounds): each listed part gets a stroked copy
// drawn behind every fill, so only the outer edge of the character shows a rim.
// Toggled by the `outline` input (the Outline layer fades the stroke color).
export const OUTLINE_PARTS = [
  'tailLine', 'tailTuft', 'pelvis', 'kneeCapL', 'legLShape', 'hoofL', 'kneeCapR', 'legRShape', 'hoofR', 'torso',
  'earLShape', 'earRShape', 'headShape', 'hornLShape', 'hornRShape', 'elbowCapL', 'armLShape', 'handLShape', 'elbowCapR', 'armRShape', 'handRShape',
];
export const OUTLINE_WIDTH = 14; // half of it shows outside the fill

// Where the exploded reference parts get slid to form the standing character.
// Legs are raised 20px so their tops tuck up under the torso (no floating gap),
// plus LEG_RAISE: shortens the visible legs by sliding them up into the torso
// (the ground rises with them, so every pose keeps the same leg geometry), and
// LEG_IN: slides each leg toward the middle so they stand closer together.
export const LEG_RAISE = 70;
export const LEG_IN = 25;
export const PART_OFFSETS = {
  head: [0, 18], hornL: [0, 18], hornR: [0, 18],
  earL: [32, 18], earLInner: [32, 18], earR: [-32, 18], earRInner: [-32, 18],
  glasses: [311.5, -58], glassesLens: [311.5, -58], glassesGlint: [311.5, -58],
  muzzle: [-314.5, 2], nostrils: [-314.5, 2], mouth: [-314.5, 2],
  torso: [0, 0], belly: [0, 0],
  armL: [58, 8], handL: [58, 8], armR: [-58, 8], handR: [-58, 8],
  legL: [10 + LEG_IN, -20 - LEG_RAISE], hoofL: [10 + LEG_IN, -20 - LEG_RAISE], legR: [-LEG_IN, -20 - LEG_RAISE], hoofR: [-LEG_IN, -20 - LEG_RAISE],
  tailTuft: [0, 0],
};

// Joints in assembled space (measured from the traced limb centerlines).
const RAW_JOINTS = {
  root: [545, 852 - LEG_RAISE],
  body: [545, 650],
  chest: [545, 640],
  spine: [[545, 640], [545, 555], [545, 470], [545, 385]],
  neck: [[545, 385], [545, 365], [545, 345]],
  head: [545, 348],
  face: [545, 240],
  armL: [[380, 388], [303, 518], [296, 588], [300, 636]],
  armR: [[715, 388], [792, 518], [794, 586], [792, 632]],
  legL: [[438, 640], [423, 730], [400, 808], [386, 848]].map(([x, y]) => [x + LEG_IN, y - LEG_RAISE]),
  legR: [[662, 640], [675, 728], [700, 806], [714, 846]].map(([x, y]) => [x - LEG_IN, y - LEG_RAISE]),
  earL: [[414, 226], [366, 218], [318, 208]],
  earR: [[678, 226], [726, 218], [774, 208]],
  hornL: [418, 186], hornR: [672, 186],
  tail: [[650, 596], [672, 620], [698, 643], [728, 661], [762, 674], [800, 681], [858, 682]],
};

// The traced limbs splay outward; rotate them about the shoulder/hip so the arms
// hang close to the body and the legs stand straight, like the character sheet.
export const PART_ROTATIONS = {
  armL: [-9, RAW_JOINTS.armL[0]], handL: [-9, RAW_JOINTS.armL[0]],
  armR: [9, RAW_JOINTS.armR[0]], handR: [9, RAW_JOINTS.armR[0]],
  legL: [-9, RAW_JOINTS.legL[0]], hoofL: [-9, RAW_JOINTS.legL[0]],
  legR: [9, RAW_JOINTS.legR[0]], hoofR: [9, RAW_JOINTS.legR[0]],
};
const rotAbout = (deg, [cx, cy]) => mul(compose(cx, cy, deg), compose(-cx, -cy));
const rotPts = (pts, part) => pts.map(([x, y]) => { const m = rotAbout(...PART_ROTATIONS[part]); return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; });
// Arms are drawn procedurally as straight, tapered limbs (see armOutline) so they
// deform cleanly in any direction. Rest: hanging slightly outward from the shoulder.
// Black hand region on the arm tip: cuff distance from the shoulder, its slant
// (px along the arm per px across) and how much the cuff edge bows.
export const HAND = { at: 214, slope: 0.32, bow: 5 };
export const ARM = {
  angle: 103, // screen angle of the left arm at rest (90 = straight down); mirrored for the right
  upper: 138, fore: 78, hand: 14, // shoulder->elbow, elbow->wrist, wrist->hand centre
  // full width along the arm (distance from shoulder, px)
  widths: [[0, 124], [40, 124], [95, 118], [138, 108], [178, 110], [216, 98], [230, 96]],
};
function armJoints(side) {
  const S = side === 'L' ? RAW_JOINTS.armL[0] : RAW_JOINTS.armR[0];
  const a = ((side === 'L' ? ARM.angle : 180 - ARM.angle) * Math.PI) / 180, d = [Math.cos(a), Math.sin(a)];
  const at = (l) => [+(S[0] + d[0] * l).toFixed(2), +(S[1] + d[1] * l).toFixed(2)];
  return [S, at(ARM.upper), at(ARM.upper + ARM.fore), at(ARM.upper + ARM.fore + ARM.hand)];
}
export const JOINTS = {
  ...RAW_JOINTS,
  armL: armJoints('L'), armR: armJoints('R'),
  legL: rotPts(RAW_JOINTS.legL, 'legL'), legR: rotPts(RAW_JOINTS.legR, 'legR'),
};

// Artboard placement of the root pivot (the ground point between the feet).
export const ARTBOARD = { width: 1000, height: 1200, rootX: 500, rootY: 1100 };

// The head is drawn at this scale (around the neck) so expressions read clearly.
export const HEAD_SCALE = 1.3;
// How far (px) the head sits below its traced position, tucking it into the body.
export const HEAD_DROP = 30;

// ---------------------------------------------------------------------------

export const rr = (w, h, r) => {
  const x = -w / 2, y = -h / 2, k = 0.5523 * r;
  return `M${x + r} ${y}L${x + w - r} ${y}C${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r}` +
    `L${x + w} ${y + h - r}C${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h}` +
    `L${x + r} ${y + h}C${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r}` +
    `L${x} ${y + r}C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}Z`;
};
const mapPath = (d, m) => contoursToSvg(transformContours(parsePath(d), (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]));
const r2 = (v) => +v.toFixed(3);
// Smooth path through points (Catmull-Rom converted to cubic beziers).
const smoothThrough = (pts) => {
  let d = `M${pts[0]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1.map(r2)} ${c2.map(r2)} ${p2}`;
  }
  return d;
};
// Closed smooth curve through points (Catmull-Rom -> cubic beziers).
function closedSmooth(pts) {
  const n = pts.length;
  let d = `M${pts[0].map(r2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${[p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6].map(r2)} ${[p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6].map(r2)} ${p2.map(r2)}`;
  }
  return d + 'Z';
}
// Arm outline from shoulder S to hand centre T (world space): tapered by
// ARM.widths, rounded caps at both ends, sampled every ~12px so skinning bends
// it smoothly.
function armOutline(S, T, cuff = null) {
  const from = cuff ? cuff.at - Math.abs(cuff.slope) * 60 - 4 : 0;
  const len = Math.hypot(T[0] - S[0], T[1] - S[1]);
  const dir = [(T[0] - S[0]) / len, (T[1] - S[1]) / len], nrm = [-dir[1], dir[0]];
  const width = (l) => {
    const W = ARM.widths;
    if (l <= W[0][0]) return W[0][1];
    for (let i = 1; i < W.length; i++) if (l <= W[i][0]) { const f = (l - W[i - 1][0]) / (W[i][0] - W[i - 1][0]); return W[i - 1][1] + (W[i][1] - W[i - 1][1]) * f; }
    return W[W.length - 1][1];
  };
  const P = (l, off) => [S[0] + dir[0] * l + nrm[0] * off, S[1] + dir[1] * l + nrm[1] * off];
  const steps = Math.max(2, Math.round((len - from) / (cuff ? 5 : 12)));
  const sideA = [], sideB = [];
  // Hand = the part of the arm past a slanted cuff line: l >= at + slope*offset.
  const cuffAt = (off) => cuff.at + cuff.slope * off;
  for (let i = 0; i <= steps; i++) {
    const l = from + ((len - from) * i) / steps;
    if (!cuff || l >= cuffAt(width(l) / 2)) sideA.push(P(l, width(l) / 2));
    if (!cuff || l >= cuffAt(-width(l) / 2)) sideB.push(P(l, -width(l) / 2));
  }
  const cap = (l, r, a0) => Array.from({ length: 7 }, (_, k) => {
    const a = a0 + (Math.PI * (k + 1)) / 8;
    return [S[0] + dir[0] * l + (nrm[0] * Math.cos(a) + dir[0] * Math.sin(a)) * r, S[1] + dir[1] * l + (nrm[1] * Math.cos(a) + dir[1] * Math.sin(a)) * r];
  });
  const end = cap(len, width(len) / 2, 0); // bulges past T
  if (cuff) {
    // cuff edge from side B back to side A, bowed slightly toward the shoulder
    const edge = [];
    for (let k = 1; k < 8; k++) {
      const f = k / 8, off = -width(cuff.at) / 2 + width(cuff.at) * f;
      edge.push(P(cuffAt(off) - cuff.bow * Math.sin(Math.PI * f), off));
    }
    return closedSmooth([...sideA, ...end, ...sideB.reverse(), ...edge]);
  }
  const start = cap(0, width(0) / 2, Math.PI); // round shoulder
  return closedSmooth([...sideA, ...end, ...sideB.reverse(), ...start]);
}

// T-shirt sleeve over the top of an arm: the arm's own tapered outline from the
// round shoulder down to `end` px along the arm, `grow` px wider so it sits over
// the arm, with a hem that can slant (`slope`, px along per px across).
function sleeveOutline(S, T, { end, grow = 8, slope = 0 }) {
  const len = Math.hypot(T[0] - S[0], T[1] - S[1]);
  const dir = [(T[0] - S[0]) / len, (T[1] - S[1]) / len], nrm = [-dir[1], dir[0]];
  const width = (l) => {
    const W = ARM.widths;
    for (let i = 1; i < W.length; i++) if (l <= W[i][0]) return W[i - 1][1] + ((W[i][1] - W[i - 1][1]) * (l - W[i - 1][0])) / (W[i][0] - W[i - 1][0]);
    return W[W.length - 1][1];
  } ;
  const half = (l) => (width(l) + grow) / 2;
  const P = (l, off) => [S[0] + dir[0] * l + nrm[0] * off, S[1] + dir[1] * l + nrm[1] * off];
  const endAt = (off) => end + slope * off;
  const side = (sign) => { const out = []; const stop = endAt(sign * half(end)); for (let l = 0; l <= stop; l += 6) out.push(P(l, sign * half(l))); out.push(P(stop, sign * half(stop))); return out; };
  const A = side(1), B = side(-1);
  const hem = [];
  for (let k = 1; k < 6; k++) { const off = half(end) * (1 - (2 * k) / 6); hem.push(P(endAt(off) + 2, off)); }
  const r = half(0), cap = Array.from({ length: 7 }, (_, k) => {
    const a = Math.PI + (Math.PI * (k + 1)) / 8;
    return [S[0] + (nrm[0] * Math.cos(a) + dir[0] * Math.sin(a)) * r, S[1] + (nrm[1] * Math.cos(a) + dir[1] * Math.sin(a)) * r];
  });
  return closedSmooth([...A, ...hem, ...B.reverse(), ...cap]);
}

// 8 tail bones along a smooth curve through the tail's key points.
export const TAIL_BONES = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6', 'tail7', 'tail8'];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
// Long limb segments are split in two so a bend spreads over several joints
// (the build distributes each elbow/knee rotation across them).
const splitLimb = (pts) => [pts[0], mid(pts[0], pts[1]), pts[1], mid(pts[1], pts[2]), pts[2], pts[3]];
function tailPoints(pts, n) {
  // resample the tail polyline into n equal-length segments
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const L = (k / n) * seg[seg.length - 1];
    let i = 1; while (i < seg.length - 1 && seg[i] < L) i++;
    const f = (L - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
    out.push([+(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f).toFixed(2), +(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f).toFixed(2)]);
  }
  return out;
}

// Rebuilds a closed traced outline as a clean curve: flatten it, even out the
// spacing, blur away pixel wobble, then refit with a few smooth bezier segments.
function smoothOutline(d, { keep = 22, blur = 4 } = {}) {
  const out = [];
  for (const c of parsePath(d)) {
    const pts = [], P = c.points, n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      for (let k = 0; k < 16; k++) {
        const t = k / 16, u = 1 - t;
        pts.push([
          u * u * u * a.x + 3 * u * u * t * a.outX + 3 * u * t * t * b.inX + t * t * t * b.x,
          u * u * u * a.y + 3 * u * u * t * a.outY + 3 * u * t * t * b.inY + t * t * t * b.y,
        ]);
      }
    }
    // resample by arc length
    const seg = [0];
    for (let i = 1; i <= pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i % pts.length][0] - pts[i - 1][0], pts[i % pts.length][1] - pts[i - 1][1]));
    const total = seg[seg.length - 1], N = 160, even = [];
    for (let j = 0, i = 0; j < N; j++) {
      const L = (j / N) * total;
      while (seg[i + 1] < L) i++;
      const f = (L - seg[i]) / (seg[i + 1] - seg[i] || 1), p = pts[i], q = pts[(i + 1) % pts.length];
      even.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
    }
    // circular gaussian blur
    const sm = even.map((_, j) => {
      let x = 0, y = 0, w = 0;
      for (let k = -blur * 2; k <= blur * 2; k++) {
        const g = Math.exp(-(k * k) / (2 * blur * blur)), p = even[(j + k + N) % N];
        x += p[0] * g; y += p[1] * g; w += g;
      }
      return [x / w, y / w];
    });
    const key = Array.from({ length: keep }, (_, j) => sm[Math.round((j * N) / keep) % N]);
    let dd = `M${key[0].map(r2)}`;
    for (let i = 0; i < keep; i++) {
      const p0 = key[(i - 1 + keep) % keep], p1 = key[i], p2 = key[(i + 1) % keep], p3 = key[(i + 2) % keep];
      dd += `C${[p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6].map(r2)} ${[p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6].map(r2)} ${p2.map(r2)}`;
    }
    out.push(dd + 'Z');
  }
  return out.join('');
}

export function buildRig() {
  const nodes = [];
  const shapes = [];
  const world = new Map(); // id -> world matrix (assembled space)
  const ROOT_PARENT = compose(JOINTS.root[0] - ARTBOARD.rootX, JOINTS.root[1] - ARTBOARD.rootY);

  const add = (n, wm) => { nodes.push(n); world.set(n.id, wm); };
  const parentWorld = (p) => (p ? world.get(p) : ROOT_PARENT);

  // Group node at a world point with no world rotation. Children of bones get a
  // counter-rotated frame, so dx/dy animation offsets stay screen-aligned.
  const node = (id, parent, wx, wy, extra = {}) => {
    const wm = compose(wx, wy);
    const local = mul(invert(parentWorld(parent)), wm);
    const rot = angleOf(local);
    add({ id, parent: parent || null, x: r2(local[4]), y: r2(local[5]), ...(Math.abs(rot) > 1e-4 ? { rotation: r2(rot) } : {}), ...extra }, wm);
  };
  const rel = (id, parent, lx, ly, extra = {}) => {
    const pm = world.get(parent);
    node(id, parent, pm[4] + lx, pm[5] + ly, extra);
  };
  // Bone chain through world points: the first is a RootBone, the rest Bones.
  const chain = (ids, parent, pts) => {
    let prevWorldAngle = angleOf(parentWorld(parent));
    ids.forEach((id, i) => {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const worldAngle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      const length = r2(Math.hypot(bx - ax, by - ay));
      const wm = compose(ax, ay, worldAngle);
      if (i === 0) {
        const local = mul(invert(parentWorld(parent)), wm);
        add({ id, parent, type: 'rootBone', x: r2(local[4]), y: r2(local[5]), rotation: r2(angleOf(local)), length }, wm);
      } else {
        add({ id, parent: ids[i - 1], type: 'bone', rotation: r2(worldAngle - prevWorldAngle), length }, wm);
      }
      prevWorldAngle = worldAngle;
    });
  };

  // Traced artwork: reference px -> assembled space -> parent-local.
  // `local` is an extra transform applied in the parent's space (e.g. resizing).
  // `worldPre` is an extra transform applied in world space after placement.
  const tracedShape = (id, parent, part, fill, { smooth, local, worldPre, ...extra } = {}) => {
    const [ox, oy] = PART_OFFSETS[part];
    let place = compose(ox, oy);
    if (PART_ROTATIONS[part]) place = mul(rotAbout(...PART_ROTATIONS[part]), place);
    if (worldPre) place = mul(worldPre, place);
    let m = mul(invert(world.get(parent)), place);
    if (local) m = mul(local, m);
    const d = smooth ? smoothOutline(traced.parts[part].d) : traced.parts[part].d;
    shapes.push({ id, parent, d: mapPath(d, m), fill, part, ...extra });
  };
  // Node fixed to a bone at bone-local (lx, ly), aligned with the bone.
  const onBone = (id, bone, lx, ly, extra = {}) => {
    add({ id, parent: bone, x: lx, y: ly, ...extra }, mul(world.get(bone), compose(lx, ly)));
  };
  // Hand-authored artwork in parent-local coordinates.
  const art = (id, parent, props) => shapes.push({ id, parent, ...props });
  // Hand-authored artwork in assembled (world) coordinates.
  const worldArt = (id, parent, d, props) => shapes.push({ id, parent, d: mapPath(d, invert(world.get(parent))), ...props });

  // ---- skeleton -------------------------------------------------------------
  node('root', null, ...JOINTS.root);
  node('body', 'root', ...JOINTS.body);
  node('tail', 'body', ...JOINTS.tail[0]);
  const TAIL = tailPoints(JOINTS.tail, TAIL_BONES.length);
  chain(TAIL_BONES, 'tail', TAIL);
  node('tailTip', TAIL_BONES[TAIL_BONES.length - 1], ...TAIL[TAIL.length - 1]);
  for (const s of ['L', 'R']) {
    node(`leg${s}`, 'body', ...JOINTS[`leg${s}`][0]);
    const L = JOINTS[`leg${s}`];
    chain([`thigh${s}`, `thighB${s}`, `shin${s}`, `shinB${s}`, `foot${s}`], `leg${s}`, splitLimb(L));
  }
  node('chest', 'body', ...JOINTS.chest);
  chain(['spine1', 'spine2', 'spine3'], 'chest', JOINTS.spine);
  chain(['neck1', 'neck2'], 'spine3', JOINTS.neck);
  // Clavicles run from the upper chest out to each shoulder: they carry the arm
  // (so shoulders can shrug) and anchor the top of the arm mesh to the torso.
  for (const s of ['L', 'R']) {
    const [sx, sy] = JOINTS[`arm${s}`][0];
    chain([`clavicle${s}`], 'spine3', [[545 + (s === 'L' ? -62 : 62), sy + 8], [sx, sy]]);
  }
  for (const s of ['L', 'R']) {
    node(`arm${s}`, `clavicle${s}`, ...JOINTS[`arm${s}`][0]);
    chain([`upperArm${s}`, `upperArmB${s}`, `forearm${s}`, `forearmB${s}`, `wrist${s}`], `arm${s}`, splitLimb(JOINTS[`arm${s}`]));
  }
  for (const s of ['L', 'R']) {
    const up = nodes.find((n) => n.id === `upperArm${s}`);
    const side = s === 'L' ? 1 : -1; // bone-local +y points outward on the left arm, inward on the right
    // Bicep: a short bone from the middle of the upper arm out to its outer edge.
    // The arm mesh is skinned to it, so scaling it swells the arm's own outline.
    const um = world.get(`upperArm${s}`);
    chain([`bicep${s}`], `upperArm${s}`, [apply(um, up.length, 0), apply(um, up.length, 44 * side)]); // bone tip = mid upper arm
    onBone(`elbow${s}`, `forearm${s}`, 0, 0);
    onBone(`knee${s}`, `shin${s}`, 0, 0);
  }
  node('handL', 'wristL', ...JOINTS.armL[3]);
  rel('dumbbellL', 'handL', 0, 0, { opacity: 0, scaleX: 1.95, scaleY: 1.95 });
  node('handR', 'wristR', ...JOINTS.armR[3]);
  rel('dumbbellR', 'handR', 0, 0, { opacity: 0, scaleX: 1.95, scaleY: 1.95 });
  // Barbell for leg day: rides across the upper back, just below the chin line.
  node('barbell', 'chest', 545, 398, { opacity: 0 });
  node('shirt', 'chest', 545, 500); // T-shirt group (hidden in head-only view)
  // Jump rope: a U-shaped loop hanging between the hands. Flipping its scaleY
  // from +1 (under the feet) to -2 (over the head) fakes the rope's rotation.
  node('ropeWrap', 'body', 545, 612); // lets the head-only view hide the rope without touching the pose's own keys
  node('rope', 'ropeWrap', 545, 612, { opacity: 0 });
  node('head', 'neck2', ...JOINTS.head);
  for (const s of ['L', 'R']) {
    node(`ear${s}`, 'head', ...JOINTS[`ear${s}`][0]);
    chain([`ear${s}1`, `ear${s}2`], `ear${s}`, JOINTS[`ear${s}`]);
  }
  node('hornL', 'head', ...JOINTS.hornL);
  node('hornR', 'head', ...JOINTS.hornR);
  node('face', 'head', ...JOINTS.face);
  rel('browL', 'face', -36, -60);
  rel('browR', 'face', 36, -60);
  rel('eyeL', 'face', -33, -2);
  rel('eyeOpenL', 'eyeL', 0, 0);
  rel('pupilL', 'eyeOpenL', 4, 6);
  rel('eyeR', 'face', 33, -2);
  rel('eyeOpenR', 'eyeR', 0, 0);
  rel('pupilR', 'eyeOpenR', -4, 6);
  rel('muzzle', 'face', 0, 66); // must match the traced muzzle's position so the mouths line up
  rel('glasses', 'face', 0, -12);
  rel('sweat', 'head', 118, -150, { opacity: 0 });
  rel('zzz', 'head', 150, -210, { opacity: 0 });
  rel('sparkles', 'root', 0, -540, { opacity: 0 });

  // ---- artwork, back to front ----------------------------------------------
  art('shadow', 'root', { ellipse: { w: 420, h: 36, cy: 4 }, fill: 'shadow' });
  // Rope half that is behind the body (drawn first) / in front (drawn last).
  const ROPE = 'M-186 0C-186 330 186 330 186 0';
  art('ropeBack', 'rope', { d: ROPE, stroke: { color: 'rope', width: 9, transformAffectsStroke: false }, opacity: 0 });

  // Tail: one stroked path skinned to a 6-bone chain; the tuft rides the tip.
  worldArt('tailLine', 'tail', smoothThrough(JOINTS.tail), { stroke: { color: 'hoof', width: 8 }, skin: TAIL_BONES, skinFalloff: 3 });
  // The tuft's joint with the tail line sits at ~(916, 745) on the reference.
  shapes.push({ id: 'tailTuft', parent: 'tailTip', d: mapPath(traced.parts.tailTuft.d, compose(-916, -745)), fill: 'hoof', part: 'tailTuft' });

  // Pelvis: fills the join between torso and legs so the legs read as attached.
  worldArt('pelvis', 'body', 'M430 600C470 585 620 585 660 600C690 612 690 660 662 672C620 690 470 690 428 672C400 660 400 612 430 600Z', { fill: 'body' });

  // Limbs use tight skin weights (high falloff) so each segment stays rigid and
  // only the joint region bends; a round cap behind each knee/elbow fills the
  // outer side of the bend so it reads as a clean ball joint.
  for (const s of ['L', 'R']) {
    const bones = [`thigh${s}`, `thighB${s}`, `shin${s}`, `shinB${s}`, `foot${s}`];
    art(`kneeCap${s}`, `knee${s}`, { ellipse: { w: 92, h: 92 }, fill: 'body' });
    tracedShape(`leg${s}Shape`, `leg${s}`, `leg${s}`, 'body', { skin: bones, skinFalloff: 9 });
    tracedShape(`hoof${s}`, `leg${s}`, `hoof${s}`, 'hoof', { skin: bones, skinFalloff: 9 });
  }

  const SPINE = ['spine1', 'spine2', 'spine3'];
  // Barbell bar: behind the torso, so it reads as resting across his back.
  art('barbellBar', 'barbell', { d: rr(800, 14, 7), fill: 'dbHandle' });
  tracedShape('torso', 'chest', 'torso', 'body', { skin: SPINE, skinFalloff: 3 });
  tracedShape('belly', 'chest', 'belly', 'belly', { skin: SPINE, skinFalloff: 3 });

  // T-shirt: a crew-neck tee just outside the torso silhouette (the neckline hides
  // under the head), skinned to the spine like the torso so it bends and breathes
  // with him. Covers the belly; the logo sits small on the left chest.
  const SHIRT = [[445, 352], [500, 346], [545, 358], [590, 346], [645, 352], [684, 362], [699, 382], [701, 420], [697, 470],
    [689, 510], [678, 560], [665, 600], [652, 628], [600, 642], [545, 648], [490, 642], [438, 628], [425, 600], [412, 560],
    [401, 510], [393, 470], [389, 420], [391, 382], [406, 362]];
  worldArt('shirtBody', 'shirt', closedSmooth(SHIRT), { fill: 'shirt', skin: SPINE, skinFalloff: 3 });
  worldArt('shirtHem', 'shirt', 'M440 618C480 634 610 634 650 618', { stroke: { color: 'shirtShade', width: 4 }, skin: SPINE, skinFalloff: 3 });
  const LOGO_AT = [600, 448], LOGO_H = 46;
  worldArt('shirtLogo', 'shirt', mapPath(LOGO.d, compose(LOGO_AT[0], LOGO_AT[1], 0, LOGO_H / 100, LOGO_H / 100)), { fill: 'logo', evenOdd: true, skin: SPINE, skinFalloff: 3 });

  // Barbell plates (monochrome), in front of the torso but behind the arms and
  // head, wide enough that they sit well outside the gripping hands.
  for (const x of [-1, 1]) {
    const sd = x < 0 ? 'L' : 'R';
    art(`barbellCollar${sd}`, 'barbell', { d: rr(12, 36, 4), fill: 'dbRim', x: 318 * x });
    art(`barbellPlate${sd}`, 'barbell', { d: rr(30, 168, 10), fill: 'dbPlate', x: 346 * x });
    art(`barbellPlateOuter${sd}`, 'barbell', { d: rr(22, 128, 8), fill: 'dbRim', x: 373 * x });
  }


  // Arms are drawn in front of the torso but behind the head, so the head always
  // reads on top (raised arms tuck behind the face).
  // Each arm is one densely-sampled chunky tapered outline skinned to its bone
  // chain with soft weights, so every bend is a smooth curve; the traced black
  // hand from the reference sits over its tip.
  for (const s of ['L', 'R']) {
    const bones = [`clavicle${s}`, `upperArm${s}`, `upperArmB${s}`, `bicep${s}`, `forearm${s}`, `forearmB${s}`, `wrist${s}`];
    const [S, , , T] = JOINTS[`arm${s}`];
    art(`elbowCap${s}`, `elbow${s}`, { ellipse: { w: 100, h: 100 }, fill: 'body' });
    worldArt(`arm${s}Shape`, `arm${s}`, armOutline(S, T), { fill: 'body', skin: bones, skinFalloff: 4 });
    worldArt(`sleeve${s}`, `arm${s}`, sleeveOutline(S, T, { end: 84, grow: 10 }), { fill: 'shirt', skin: bones.slice(0, 4), skinFalloff: 4 });
    // Black hoof-hand: the tip of the arm's own outline past a slanted cuff (higher
    // on the inner side, like the reference), so it is always flush with the arm.
    worldArt(`hand${s}Shape`, `arm${s}`, armOutline(S, T, { at: HAND.at, slope: HAND.slope * (s === 'L' ? 1 : -1), bow: HAND.bow }), { fill: 'hoof', skin: [`forearmB${s}`, `wrist${s}`], skinFalloff: 5 });
  }

  for (const s of ['L', 'R']) {
    const bones = [`ear${s}1`, `ear${s}2`];
    tracedShape(`ear${s}Shape`, `ear${s}`, `ear${s}`, 'body', { skin: bones, skinFalloff: 3 });
    tracedShape(`ear${s}Inner`, `ear${s}`, `ear${s}Inner`, 'innerEar', { skin: bones, skinFalloff: 3 });
  }

  tracedShape('headShape', 'head', 'head', 'body', {});
  tracedShape('hornLShape', 'hornL', 'hornL', 'horn', { smooth: true });
  tracedShape('hornRShape', 'hornR', 'hornR', 'horn', { smooth: true });

  // Eyes: tall ovals set close together, big enough that the muzzle overlaps
  // their bottoms. Big pupils glance inward; a body-colored mask keeps each pupil
  // inside its white.
  const mirrorX = (d, s) => (s === 'L' ? d : mapPath(d, [-1, 0, 0, 1, 0, 0]));
  const EYE_RX = 25, EYE_RY = 33;
  const oval = (rx, ry) => { const k = 0.5523; return `M${-rx} 0C${-rx} ${-ry * k} ${-rx * k} ${-ry} 0 ${-ry}C${rx * k} ${-ry} ${rx} ${-ry * k} ${rx} 0C${rx} ${ry * k} ${rx * k} ${ry} 0 ${ry}C${-rx * k} ${ry} ${-rx} ${ry * k} ${-rx} 0Z`; };
  for (const side of ['L', 'R']) {
    const eye = `eye${side}`, open = `eyeOpen${side}`, pupil = `pupil${side}`;
    art(`eyeWhite${side}`, open, { ellipse: { w: EYE_RX * 2, h: EYE_RY * 2 }, fill: 'eyeWhite' });
    art(`pupil${side}Shape`, pupil, { ellipse: { w: 30, h: 40 }, fill: 'pupil' });
    art(`glint${side}`, pupil, { ellipse: { w: 10, h: 12, cx: side === 'L' ? 5 : -5, cy: -10 }, fill: 'eyeWhite' });
    art(`eyeMask${side}`, open, { d: `M-31 -44L31 -44L31 44L-31 44Z${oval(EYE_RX, EYE_RY)}`, fill: 'body', evenOdd: true });
    art(`eyeHappy${side}`, eye, { d: 'M-20 8C-11 -12 11 -12 20 8', stroke: { color: 'horn', width: 6.5 }, opacity: 0 });
    art(`eyeClosed${side}`, eye, { d: 'M-20 0C-11 12 11 12 20 0', stroke: { color: 'horn', width: 6.5 }, opacity: 0 });
  }

  // Brows: soft gray ovals tilted up toward the middle.
  art('browLShape', 'browL', { ellipse: { w: 32, h: 17 }, fill: 'brow', rotation: -12 });
  art('browRShape', 'browR', { ellipse: { w: 32, h: 17 }, fill: 'brow', rotation: 12 });

  // Muzzle + mouths (one visible at a time, driven by the `mood` layer).
  tracedShape('muzzleShape', 'muzzle', 'muzzle', 'muzzle');
  tracedShape('nostrils', 'muzzle', 'nostrils', 'nostril');
  tracedShape('mouthNeutral', 'muzzle', 'mouth', 'mouthShadow');
  art('mouthSmile', 'muzzle', { d: 'M-14 22C-7 31 7 31 14 22', stroke: { color: 'mouth', width: 5 }, opacity: 0 });
  art('mouthGrin', 'muzzle', { d: 'M-18 18L18 18C16 38 -16 38 -18 18Z', fill: 'mouth', opacity: 0 });
  art('mouthTongue', 'muzzle', { d: 'M-9 30C-5 25 5 25 9 30C5 35 -5 35 -9 30Z', fill: 'tongue', opacity: 0 });
  art('mouthO', 'muzzle', { ellipse: { w: 15, h: 17, cy: 26 }, fill: 'mouth', opacity: 0 });
  art('mouthFrown', 'muzzle', { d: 'M-13 31C-6 23 6 23 13 31', stroke: { color: 'mouth', width: 5 }, opacity: 0 });
  art('mouthFlat', 'muzzle', { d: 'M-12 27L12 27', stroke: { color: 'mouth', width: 5 }, opacity: 0 });
  art('mouthSmirk', 'muzzle', { d: 'M-11 28C-3 30 6 28 14 20', stroke: { color: 'mouth', width: 5 }, opacity: 0 });

  // Sunglasses (traced from the reference), resized to cover the tall, close-set
  // eyes: a little narrower and taller than the original. Pushed up onto the
  // head when `glasses` is false.
  const SHADES = compose(0, 5, 0, 0.8, 1.32);
  tracedShape('glassesFrame', 'glasses', 'glasses', 'frame', { local: SHADES });
  tracedShape('glassesLens', 'glasses', 'glassesLens', 'lens', { local: SHADES });
  tracedShape('glassesGlint', 'glasses', 'glassesGlint', 'glint', { local: SHADES });

  art('ropeFront', 'rope', { d: ROPE, stroke: { color: 'rope', width: 9, transformAffectsStroke: false }, opacity: 0 });

  // Dumbbells, held in the hooves.
  for (const side of ['L', 'R']) {
    const p = `dumbbell${side}`;
    // Monochrome: light steel handle, dark plates with a lighter rim plate.
    art(`${p}Bar`, p, { d: rr(92, 9, 4), fill: 'dbHandle' });
    art(`${p}PlateIn`, p, { d: rr(13, 40, 5), fill: 'dbPlate', x: -27 });
    art(`${p}PlateIn2`, p, { d: rr(13, 40, 5), fill: 'dbPlate', x: 27 });
    art(`${p}PlateOut`, p, { d: rr(9, 28, 4), fill: 'dbRim', x: -39 });
    art(`${p}PlateOut2`, p, { d: rr(9, 28, 4), fill: 'dbRim', x: 39 });
  }

  // FX: sweat drops, Zzz, sparkles.
  const drop = 'M0 -15C5 -7 9 -1 9 4C9 9 5 13 0 13C-5 13 -9 9 -9 4C-9 -1 -5 -7 0 -15Z';
  art('sweat1', 'sweat', { d: drop, fill: 'sweat' });
  art('sweat2', 'sweat', { d: drop, fill: 'sweat', x: -250, y: 30, scaleX: 0.8, scaleY: 0.8 });
  const z = 'M-10 -10L10 -10L-10 10L10 10';
  art('z1', 'zzz', { d: z, stroke: { color: 'zzz', width: 5, join: 'round' }, scaleX: 0.7, scaleY: 0.7 });
  art('z2', 'zzz', { d: z, stroke: { color: 'zzz', width: 5, join: 'round' } });
  art('z3', 'zzz', { d: z, stroke: { color: 'zzz', width: 5, join: 'round' }, scaleX: 1.3, scaleY: 1.3 });
  const star = 'M0 -22C2 -7 7 -2 22 0C7 2 2 7 0 22C-2 7 -7 2 -22 0C-7 -2 -2 -7 0 -22Z';
  const sparkleAt = [[-300, 60], [290, 20], [-230, -60], [240, -90], [0, -110]];
  sparkleAt.forEach(([x, y], i) => art(`sparkle${i + 1}`, 'sparkles', { d: star, fill: i % 2 ? 'accent' : 'sparkle', x, y }));

  // Scale the head last: its children were placed in unscaled space, so everything
  // under it (face, horns, ears, glasses, sweat, Zzz) grows around the neck.
  const head = nodes.find((n) => n.id === 'head');
  head.scaleX = head.scaleY = HEAD_SCALE;
  // Sit the head lower so it nestles into the shoulders (a screen-space drop,
  // converted into the neck bone's frame).
  const nm = world.get(head.parent), det = nm[0] * nm[3] - nm[1] * nm[2];
  head.x = r2(head.x + (-nm[2] * HEAD_DROP) / det);
  head.y = r2(head.y + (nm[0] * HEAD_DROP) / det);

  // Outline copies go right after the ground shadow, behind everything else.
  const outlines = OUTLINE_PARTS.map((id) => {
    const src = shapes.find((sh) => sh.id === id);
    if (!src) throw new Error(`Outline part ${id} not found`);
    const { fill, stroke, opacity, part, ...rest } = src;
    const width = (stroke?.width ?? 0) + OUTLINE_WIDTH;
    return { ...rest, id: `${id}Outline`, stroke: { color: 'outline', width, join: 'round', cap: 'round' } };
  });
  shapes.splice(1, 0, ...outlines);

  return { nodes, shapes };
}

/** Rest world angle (degrees) of each bone, used to author poses in screen angles. */
export function restBoneAngles() {
  const out = {};
  const ang = ([ax, ay], [bx, by]) => (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  for (const s of ['L', 'R']) {
    const a = JOINTS[`arm${s}`], l = JOINTS[`leg${s}`];
    out[`upperArm${s}`] = ang(a[0], a[1]); out[`forearm${s}`] = ang(a[1], a[2]); out[`wrist${s}`] = ang(a[2], a[3]);
    out[`thigh${s}`] = ang(l[0], l[1]); out[`shin${s}`] = ang(l[1], l[2]); out[`foot${s}`] = ang(l[2], l[3]);
  }
  return out;
}
