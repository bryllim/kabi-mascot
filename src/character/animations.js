// Kabi's animation library.
//
// Keys are authored as poses: [time, { target: { rot, dx, dy, sx, sy, s, op } }, ease?]
//   rot     rotation in degrees, relative to the rest pose
//   dx, dy  offset from the rest position
//   sx, sy  scale (s sets both); op = opacity
// The ease on a key shapes the segment that starts at that key.
// Limbs are posed with arms()/legs(), which take *screen* angles for the bone
// chain (90 = hanging straight down, 180 = pointing outward, 270 = straight up),
// mirrored for the right side, and convert them to bone rotations.
// Every animation in a state-machine layer is padded so it keys every property
// the layer touches; switching states never leaves stale values behind.
import { restBoneAngles } from './rig.js';

export const POSES = ['idle', 'wave', 'flex', 'squat', 'jumpingJacks', 'run', 'curls', 'celebrate', 'tired', 'sleep', 'stretch', 'ready',
  'pushup', 'plank', 'lunge', 'burpee', 'boxing', 'jumpRope', 'highKnees',
  'thinking', 'shrug', 'presentLeft', 'presentRight', 'handsOnHips', 'clap', 'heart', 'listen', 'fistPump', 'crossedArms'];
export const MOODS = ['neutral', 'happy', 'determined', 'tired', 'sad', 'surprised', 'sleepy', 'proud'];
export const ONE_SHOTS = [
  { trigger: 'jump', animation: 'hop' },
  { trigger: 'hi', animation: 'hi' },
  { trigger: 'poke', animation: 'poke' },
];

const anim = (name, duration, keys, opts = {}) => ({ name, duration, keys, loop: 'loop', ...opts });
const merge = (...ps) => {
  const out = {};
  for (const p of ps) for (const [k, v] of Object.entries(p || {})) out[k] = { ...(out[k] || {}), ...v };
  return out;
};
const norm = (d) => { d = ((d % 360) + 360) % 360; return +(d > 180 ? d - 360 : d).toFixed(3); };

// ---- limb posing ------------------------------------------------------------
const REST = restBoneAngles();
const screen = (side, a) => (side === 'L' ? a : 180 - a);
/**
 * One arm: upper/forearm screen angles. `wrist` bends the hand (degrees, + curls
 * it toward the body's midline). `dumbbell` keeps the held dumbbell level.
 */
// Pose angles were authored against the traced (splayed) limbs; ARM_SHIFT/LEG_SHIFT
// map them onto the tucked-in rest pose so every pose keeps its tuned shape.
const ARM_SHIFT = [-9.36, -8.29]; // tuned against the previous traced arms; keeps every pose's look
const LEG_SHIFT = [REST.thighL - 99, REST.shinL - 109];
function arm(side, upper, fore, { dumbbell = false, wrist = 0 } = {}) {
  upper += ARM_SHIFT[0]; fore += ARM_SHIFT[1];
  const u = screen(side, upper), f = screen(side, fore), w = side === 'L' ? wrist : -wrist;
  const out = {
    [`arm${side}`]: { rot: norm(u - REST[`upperArm${side}`]) },
    [`forearm${side}`]: { rot: norm(f - u - (REST[`forearm${side}`] - REST[`upperArm${side}`])) },
    [`wrist${side}`]: { rot: w },
  };
  if (dumbbell) out[`dumbbell${side}`] = { rot: norm(-(f - REST[`forearm${side}`] + w)) };
  return out;
}
/** Both arms mirrored; or pass separate [upper, fore] per side. */
const arms = (upper, fore, opts) => merge(arm('L', upper, fore, opts), arm('R', upper, fore, opts));
const armsLR = ([uL, fL], [uR, fR], opts) => merge(arm('L', uL, fL, opts), arm('R', uR, fR, opts));
const REST_ARM = [121, 95];
/**
 * One leg: thigh/shin screen angles. The foot stays level with the ground unless
 * `foot` is given. `fore` < 1 foreshortens the thigh (knee coming toward the
 * viewer, as in a knee raise or squat); the shin is scaled back to full length.
 */
function leg(side, thigh, shin, foot, fore = 1) {
  thigh += LEG_SHIFT[0]; shin += LEG_SHIFT[1];
  const t = screen(side, thigh), s = screen(side, shin);
  const f = foot == null ? REST[`foot${side}`] : screen(side, foot);
  return {
    [`thigh${side}`]: { rot: norm(t - REST[`thigh${side}`]), sx: +fore.toFixed(3) },
    [`shin${side}`]: { rot: norm(s - t - (REST[`shin${side}`] - REST[`thigh${side}`])), sx: +(1 / fore).toFixed(3) },
    [`foot${side}`]: { rot: norm(f - s - (REST[`foot${side}`] - REST[`shin${side}`])) },
  };
}
// Screen-angle versions (no authoring shift): 90 = straight down, <90 inward.
const armS = (side, upper, fore, opts) => arm(side, upper - ARM_SHIFT[0], fore - ARM_SHIFT[1], opts);
const legS = (side, thigh, shin, fore = 1) => leg(side, thigh - LEG_SHIFT[0], shin - LEG_SHIFT[1], null, fore);
const legs = (thigh, shin) => merge(leg('L', thigh, shin), leg('R', thigh, shin));
const REST_LEG = [99, 109];
// Bends are spread over the three spine bones and two neck bones for a smooth curve.
const spine = (lower, upper, neck = 0) => ({
  spine1: { rot: lower * 0.6 }, spine2: { rot: (lower + upper) * 0.4 }, spine3: { rot: upper * 0.6 },
  neck1: { rot: neck / 2 }, neck2: { rot: neck / 2 },
});
const neck = (deg) => ({ neck1: { rot: deg / 2 }, neck2: { rot: deg / 2 } });

// Samples a sine wave into keys: target.prop = amp * sin(2π(t/period) + phase) + base
function wave(target, prop, { amp, period, phase = 0, base = 0, duration, steps = 8 }) {
  const keys = [];
  const n = Math.round((duration / period) * steps);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * duration;
    keys.push([+t.toFixed(4), { [target]: { [prop]: +(base + amp * Math.sin((2 * Math.PI * t) / period + phase)).toFixed(3) } }, 'linear']);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Body layer: looping poses (driven by `pose`)

// Idle: breathing, a slow sway through the spine, arms drifting with the
// forearms lagging behind the upper arms (follow-through).
const idle = anim('idle', 3.2, [
  [0, merge(arms(122, 100), spine(-1, -1.2, 1.5), { body: { dy: 0 }, chest: { sx: 1, sy: 1 }, head: { rot: -1 } }), 'sine'],
  [0.4, { forearmL: { rot: -1 }, forearmR: { rot: 1 } }, 'sine'],
  [0.7, { wristL: { rot: -2 }, wristR: { rot: 2 } }, 'sine'],
  [1.6, merge(arms(114, 86), spine(1, 1.2, -1.5), { body: { dy: -2 }, chest: { sx: 0.99, sy: 1.03 }, head: { rot: 1 } }), 'sine'],
  [2.0, { forearmL: { rot: 5 }, forearmR: { rot: -5 } }, 'sine'],
  [2.3, { wristL: { rot: 6 }, wristR: { rot: -6 } }, 'sine'],
  [3.2, merge(arms(122, 100), spine(-1, -1.2, 1.5), { body: { dy: 0 }, chest: { sx: 1, sy: 1 }, head: { rot: -1 } })],
]);

// Wave: right arm up, forearm doing the waving, body leaning away.
const waveKeys = [[0, merge(armsLR([118, 92], [178, 245]), spine(-2, -4, 5), { body: { dy: 0 } }), 'sine']];
for (let i = 1; i <= 8; i++) {
  const out = i % 2;
  waveKeys.push([i * 0.25, merge(arm('R', out ? 172 : 184, out ? 226 : 262, { wrist: out ? 26 : -22 }), { body: { dy: out ? -3 : 0 } }, neck(out ? 7 : 4)), 'sine']);
}
const waveAnim = anim('wave', 2.0, waveKeys);

// Flex: double-biceps, pumping, chest puffed.
const flexA = merge(arms(168, 258), spine(0, -2, 2), { chest: { sx: 1.04, sy: 1 }, body: { dy: 4 }, legL: { rot: 2 }, legR: { rot: -2 } });
const flexB = merge(arms(160, 242), spine(0, 3, -3), { chest: { sx: 1.09, sy: 1.04 }, body: { dy: 7 } });
const flex = anim('flex', 2.4, [
  [0, flexA, 'easeInOut'], [0.6, flexB, 'easeInOut'], [1.2, merge(flexA, spine(0, 2, -2)), 'easeInOut'],
  [1.8, merge(flexB, spine(0, -3, 3)), 'easeInOut'], [2.4, flexA],
]);

// Leg day: barbell back squat (front view). The bar rests across the upper back
// behind the neck, gripped just outside the shoulders. Feet stay planted, the thighs foreshorten toward parallel as the
// hips sink and the knees track out over the toes, the torso settles forward and
// the quads swell under load. Tempo: 1 s controlled descent, pause, powerful
// drive up with a slight rise at the top, settle.
const SQUAT = { thigh: 38, shin: -12, squash: 0.2, dy: 45.9, dx: 39 }; // dy/dx measured so the hooves stay planted
const squatLegs = (depth) => {
  // depth 0 = standing, 1 = bottom. The knees open (thigh angle) while the whole
  // leg compresses vertically (leg node sy); the hoof is counter-scaled so it keeps
  // its shape. Hips drop (dy) and move inward (dx) so the feet stay planted.
  const thigh = 90.5 + SQUAT.thigh * depth, shin = 97.4 + SQUAT.shin * depth;
  const sy = +(1 - SQUAT.squash * depth).toFixed(4);
  const L = legS('L', thigh, shin), R = legS('R', thigh, shin);
  // the vertical squash skews the foot slightly; rotate it back flat
  L.footL.rot = +(L.footL.rot - 2.6 * depth).toFixed(3); R.footR.rot = +(R.footR.rot + 2.6 * depth).toFixed(3);
  return merge(L, R,
    { legL: { sy, dx: +(SQUAT.dx * depth).toFixed(2) }, legR: { sy, dx: +(-SQUAT.dx * depth).toFixed(2) } },
    { footL: { sx: +(1 / sy).toFixed(4) }, footR: { sx: +(1 / sy).toFixed(4) } },
    { body: { dy: +(SQUAT.dy * depth).toFixed(2) } });
};
// Hands grip the barbell just outside the shoulders, elbows down under the bar.
const barGrip = merge(armS('L', 131, 288), armS('R', 131, 288), { barbell: { op: 1 } });
const squatTorso = (depth) => merge(spine(0, 0, 0), {
  chest: { sy: +(1 - 0.07 * depth).toFixed(3), sx: +(1 + 0.03 * depth).toFixed(3) },
  head: { dy: +(9 * depth).toFixed(2) },
});
const squat = anim('squat', 2.6, [
  [0, merge(squatLegs(0), barGrip, squatTorso(0), { shadow: { s: 1 } }), 'easeInOut'],
  [1.0, merge(squatLegs(1), barGrip, squatTorso(1), { shadow: { s: 1.04 } }), 'easeInOut'],
  [1.3, merge(squatLegs(0.98), barGrip, squatTorso(1)), 'easeOut'],
  [1.9, merge(squatLegs(-0.06), barGrip, squatTorso(-0.3), { shadow: { s: 0.98 } }), 'easeInOut'],
  [2.6, merge(squatLegs(0), barGrip, squatTorso(0), { shadow: { s: 1 } })],
]);

// Jumping jacks: straight-ish arms overhead, legs out, knees soak up landings.
const jClosed = (dy, knee = 0) => merge(arms(118, 100), legs(REST_LEG[0] - knee, REST_LEG[1] + knee), { body: { dy }, legL: { rot: 0 }, legR: { rot: 0 }, shadow: { s: 1 } });
const jacks = anim('jumpingJacks', 1.0, [
  [0, merge(jClosed(0), { chest: { sy: 1 } }), 'easeOut'],
  [0.1, merge(jClosed(8, 10), { chest: { sy: 0.96 } }), 'easeOut'],
  [0.28, merge(arms(150, 170), legs(...REST_LEG), { body: { dy: -50 }, legL: { rot: 6 }, legR: { rot: -6 }, shadow: { s: 0.78 }, chest: { sy: 1.03 } }), 'easeIn'],
  [0.44, merge(arms(226, 250), legs(REST_LEG[0] - 8, REST_LEG[1] + 8), { body: { dy: 8 }, legL: { rot: 11 }, legR: { rot: -11 }, shadow: { s: 1 }, chest: { sy: 0.96 } }), 'easeOut'],
  [0.54, merge(arms(222, 244), { body: { dy: 3 }, chest: { sy: 1 } }), 'easeOut'],
  [0.72, merge(arms(145, 165), legs(...REST_LEG), { body: { dy: -45 }, legL: { rot: 5 }, legR: { rot: -5 }, shadow: { s: 0.8 }, chest: { sy: 1.03 } }), 'easeIn'],
  [0.88, merge(jClosed(7, 9), { chest: { sy: 0.97 } }), 'easeOut'],
  [1.0, merge(jClosed(0), { chest: { sy: 1 } })],
]);

// Run in place (front view): alternating knee raises, the raised thigh
// foreshortens toward the viewer while the shin hangs under it; arms bent ~90°
// pump in front of the body opposite to the legs; the body bobs on each landing.
const KNEE_UP = (side) => legS(side, 92, 80, 0.3);
const PLANT = (side, bend = 0) => legS(side, 90.5 - bend, 97.4 + bend * 1.2);
const armFwd = (side) => armS(side, 80, -30);
const armBack = (side) => armS(side, 104, 116);
const runA = merge(KNEE_UP('L'), PLANT('R', 3), armFwd('R'), armBack('L'), spine(1, 3, -3), { body: { dy: -9 }, shadow: { s: 0.94 } });
const runB = merge(KNEE_UP('R'), PLANT('L', 3), armFwd('L'), armBack('R'), spine(-1, -3, 3), { body: { dy: -9 }, shadow: { s: 0.94 } });
const runMid = merge(PLANT('L', 6), PLANT('R', 6), armS('L', 92, 40), armS('R', 92, 40), spine(0, 0, 0), { body: { dy: 5 }, shadow: { s: 1 } });
const run = anim('run', 0.7, [[0, runA, 'sine'], [0.175, runMid, 'sine'], [0.35, runB, 'sine'], [0.525, runMid, 'sine'], [0.7, runA]]);

// Curls: alternating dumbbell bicep curls. Elbows stay pinned at the sides,
// one forearm curls up to the shoulder while the other lowers, the working
// bicep swells at the top, and the body braces slightly on each rep.
const db = { dumbbell: true };
const CURL = { down: [97, 95], mid: [95, 172], up: [93, 246] }; // [upper, forearm] screen angles
const curlArm = (side, phase, wrist = 0) => armS(side, ...CURL[phase], { ...db, wrist });
const bicepOf = (side, effort) => ({ [`bicep${side}`]: { sx: +(1 + effort * 0.42).toFixed(3), sy: +(1 + effort * 0.3).toFixed(3) } });
function curlKeys(side, t0) {
  // one rep for `side` starting at t0 (1.2 s: up 0.6 s, squeeze 0.15 s, lower 0.45 s)
  return [
    [t0, merge(curlArm(side, 'down'), bicepOf(side, 0.1)), 'easeIn'],
    [t0 + 0.32, merge(curlArm(side, 'mid', 6), bicepOf(side, 0.5)), 'easeOut'],
    [t0 + 0.6, merge(curlArm(side, 'up', 14), bicepOf(side, 0.95)), 'easeInOut'],
    [t0 + 0.75, merge(curlArm(side, 'up', 16), bicepOf(side, 1)), 'easeIn'],
    [t0 + 0.98, merge(curlArm(side, 'mid', 4), bicepOf(side, 0.45)), 'easeOut'],
    [t0 + 1.2, merge(curlArm(side, 'down'), bicepOf(side, 0.1)), 'easeInOut'],
  ];
}
const curls = anim('curls', 2.4, [
  [0, { dumbbellL: { op: 1 }, dumbbellR: { op: 1 } }, 'hold'],
  ...curlKeys('L', 0), [2.4, merge(curlArm('L', 'down'), bicepOf('L', 0.1))],
  [0, merge(curlArm('R', 'down'), bicepOf('R', 0.1)), 'hold'], ...curlKeys('R', 1.2),
  // brace: tiny lean away from the working arm + a breath on each rep
  [0, merge(spine(0, 0, 0), { body: { dy: 2 }, chest: { sy: 0.99, sx: 1 } }), 'sine'],
  [0.6, merge(spine(0, 2, -2), { body: { dy: 0 }, chest: { sy: 1.02, sx: 1.01 } }), 'sine'],
  [1.2, merge(spine(0, 0, 0), { body: { dy: 2 }, chest: { sy: 0.99, sx: 1 } }), 'sine'],
  [1.8, merge(spine(0, -2, 2), { body: { dy: 0 }, chest: { sy: 1.02, sx: 1.01 } }), 'sine'],
  [2.4, merge(spine(0, 0, 0), { body: { dy: 2 }, chest: { sy: 0.99, sx: 1 } })],
]);

// Pop in -> twinkle -> gone. `offset` is a fraction of the loop (<= 0.55 so it never wraps).
const sparklePop = (i, period, offset) => {
  const seq = [[0, 0, 0], [0.12, 1.15, 45], [0.3, 0.9, 90], [0.45, 0, 135]];
  const keys = seq.map(([dt, s, rot]) => [+((offset + dt) * period).toFixed(3), { [`sparkle${i}`]: { s, rot } }, 'easeOut']);
  if (offset > 0) keys.unshift([0, { [`sparkle${i}`]: { s: 0, rot: 0 } }, 'hold']);
  keys.push([period, { [`sparkle${i}`]: { s: 0, rot: 0 } }]);
  return keys;
};
const celebrateSparkles = [0, 0.12, 0.25, 0.4, 0.55].flatMap((o, i) => sparklePop(i + 1, 1.1, o));
const celebrate = anim('celebrate', 1.1, [
  [0, merge(arms(212, 244), legs(REST_LEG[0] - 10, REST_LEG[1] + 10), spine(0, 0, 0), { body: { dy: 14 }, chest: { sy: 0.93, sx: 1.04 }, shadow: { s: 1 }, head: { rot: -4 }, sparkles: { op: 1 } }), 'easeOut'],
  [0.38, merge(arms(224, 258), leg('L', 95, 135), leg('R', 95, 135), spine(0, 0, 0), { body: { dy: -92 }, chest: { sy: 1.05, sx: 0.98 }, shadow: { s: 0.68 }, head: { rot: 4 } }), 'easeIn'],
  [0.7, merge(arms(204, 236), legs(REST_LEG[0] - 12, REST_LEG[1] + 12), { body: { dy: 16 }, chest: { sy: 0.92, sx: 1.05 }, shadow: { s: 1 }, head: { rot: -2 } }), 'easeOut'],
  [0.86, merge(arms(214, 248), legs(...REST_LEG), { body: { dy: 3 }, chest: { sy: 1, sx: 1 } }), 'easeInOut'],
  [1.1, merge(arms(212, 244), legs(REST_LEG[0] - 10, REST_LEG[1] + 10), { body: { dy: 14 }, chest: { sy: 0.93, sx: 1.04 }, head: { rot: -4 } })],
  ...celebrateSparkles,
]);

// One drip: appear, slide down while fading, then snap back (hidden) for reuse.
const drip = (target, start, travel = 1.05) => [
  [start, { [target]: { dy: 0, op: 0, s: 0.6 } }, 'easeIn'],
  [start + 0.25, { [target]: { op: 1, s: 1 } }, 'easeIn'],
  [start + travel, { [target]: { dy: 38, op: 0, s: 0.9 } }, 'hold'],
];
// Tired: slumped spine, dangling arms, soft knees, heavy breathing, sweat.
const tiredBase = merge(arms(98, 92), legs(REST_LEG[0] - 5, REST_LEG[1] + 6), { body: { dy: 10 }, sweat: { op: 1 } });
const tired = anim('tired', 3.0, [
  [0, merge(tiredBase, spine(3, 4, 8), { chest: { sy: 0.94, sx: 1.02 }, head: { dy: 10 } }), 'sine'],
  [1.5, merge(arms(101, 96), spine(2, 2, 6), { chest: { sy: 0.99, sx: 1 }, head: { dy: 6 } }), 'sine'],
  [3.0, merge(tiredBase, spine(3, 4, 8), { chest: { sy: 0.94, sx: 1.02 }, head: { dy: 10 } })],
  ...drip('sweat1', 0), ...drip('sweat1', 1.5), ...drip('sweat2', 0.75),
  [0, { sweat2: { dy: 0, op: 0, s: 0.6 } }, 'hold'],
  [3.0, { sweat1: { dy: 0, op: 0, s: 0.6 }, sweat2: { dy: 0, op: 0, s: 0.6 } }],
]);

const zFloat = (target, start, period, travel = 2.6) => {
  const keys = [];
  const add = (t, v, ease = 'easeOut') => keys.push([+t.toFixed(3), { [target]: v }, ease]);
  const off = { dx: 0, dy: 0, op: 0, s: 0.5, rot: -10 };
  const mid = { op: 1 };
  const end = { dx: 34, dy: -120, op: 0, s: 1.15, rot: 12 };
  if (start + travel <= period) {
    add(0, off, 'hold'); add(start, off, 'easeOut'); add(start + 0.35, mid, 'linear'); add(start + travel, end, 'hold'); add(period, off, 'hold');
  } else {
    // wraps around the loop end: interpolate the value at t=0
    const f = (period - start) / travel;
    const lerp = (a, b) => +(a + (b - a) * f).toFixed(3);
    const wrap = { dx: lerp(0, 34), dy: lerp(0, -120), op: 1, s: lerp(0.5, 1.15), rot: lerp(-10, 12) };
    add(0, wrap, 'linear'); add(start + travel - period, end, 'hold'); add(start, off, 'easeOut'); add(Math.min(start + 0.35, period), mid, 'linear'); add(period, wrap);
  }
  return keys;
};
// Sleep: head drooped on the chest, slow deep breaths, floating Zzz.
const sleep = anim('sleep', 4.0, [
  [0, merge(arms(100, 94), legs(REST_LEG[0] - 3, REST_LEG[1] + 4), spine(2, 4, 12), { body: { dy: 6 }, chest: { sy: 0.97, sx: 1.01 }, head: { dy: 12 }, zzz: { op: 1 } }), 'sine'],
  [2.0, merge(arms(104, 100), spine(1, 3, 10), { chest: { sy: 1.03, sx: 0.995 }, head: { dy: 8 } }), 'sine'],
  [4.0, merge(arms(100, 94), spine(2, 4, 12), { chest: { sy: 0.97, sx: 1.01 }, head: { dy: 12 } })],
  ...zFloat('z1', 0, 4.0), ...zFloat('z2', 1.33, 4.0), ...zFloat('z3', 2.66, 4.0),
]);

// Stretch: cross-body shoulder stretch. One arm is pulled across the chest by
// the other forearm while the head tilts away; then the other side.
const neutralStretch = merge(arms(120, 96), spine(0, 0, 0), { body: { dx: 0 } });
const crossR = merge(armsLR([69, -32], [24, 14]), spine(0, -3, -9), { body: { dx: 0 } });
const crossL = merge(armsLR([24, 14], [69, -32]), spine(0, 3, 9), { body: { dx: 0 } });
const stretch = anim('stretch', 4.8, [
  [0, neutralStretch, 'easeInOut'],
  [0.8, crossR, 'easeOut'], [1.8, merge(crossR, armsLR([66, -38], [20, 12]), spine(0, -4, -12)), 'easeInOut'],
  [2.4, neutralStretch, 'easeInOut'],
  [3.2, crossL, 'easeOut'], [4.2, merge(crossL, armsLR([20, 12], [66, -38]), spine(0, 4, 12)), 'easeInOut'],
  [4.8, neutralStretch],
]);

// Ready: athletic stance, fists up, bouncing on the knees.
const ready = anim('ready', 0.8, [
  [0, merge(arms(128, 225), legs(107, 101), { legL: { rot: 2 }, legR: { rot: -2 }, body: { dy: 8 }, chest: { sx: 1.02, sy: 0.98 }, head: { dy: 2 } }, spine(0, 1, -1)), 'sine'],
  [0.4, merge(arms(125, 216), legs(103, 105), { body: { dy: 2 }, chest: { sx: 1.0, sy: 1.02 }, head: { dy: -1 } }, spine(0, -1, 1)), 'sine'],
  [0.8, merge(arms(128, 225), legs(107, 101), { body: { dy: 8 }, chest: { sx: 1.02, sy: 0.98 }, head: { dy: 2 } }, spine(0, 1, -1))],
]);

// ---- app poses ----------------------------------------------------------------
// Conversational poses for the app's screens (coach chat, empty states, tips).
// Limbs use armS() screen angles: 90 = hanging down, <90 toward the midline,
// 180 = straight out to the side, 270 = straight up, >270 up and inward.

// Thinking: hoof on the chin, the other forearm folded across the belly
// propping the elbow; head tilts and bobs as he mulls it over.
const thinkA = merge(armS('R', 58, 278, { wrist: 42 }), armS('L', 44, 356, { wrist: 10 }), spine(0, -1, 5), { head: { rot: 4 }, body: { dy: 0 } });
const thinkB = merge(armS('R', 60, 280, { wrist: 48 }), armS('L', 46, 354, { wrist: 14 }), spine(0, 1, 8), { head: { rot: 7 }, body: { dy: -2 } });
const thinking = anim('thinking', 3.6, [[0, thinkA, 'sine'], [1.8, thinkB, 'sine'], [3.6, thinkA]]);

// Shrug: forearms out with open palms, shoulders bouncing up to the ears.
const shrugA = merge(armS('L', 128, 178, { wrist: -18 }), armS('R', 128, 178, { wrist: -18 }), spine(0, 0, 6), { head: { rot: 6 }, body: { dy: 2 } });
const shrugB = merge(armS('L', 124, 186, { wrist: -24 }), armS('R', 124, 186, { wrist: -24 }), spine(0, 0, 9), { head: { rot: 9 }, body: { dy: -4 } });
const shrugPose = anim('shrug', 2.2, [[0, shrugA, 'easeInOut'], [0.7, shrugB, 'easeInOut'], [1.3, shrugA, 'easeInOut'], [2.2, shrugA]]);

// Present: one arm swept out to the side, palm up, "check this out";
// the body leans toward it. presentLeft/Right present to the viewer's left/right.
const present = (side) => {
  const other = side === 'L' ? 'R' : 'L', lean = side === 'L' ? 1 : -1;
  const a = merge(armS(side, 168, 196, { wrist: -16 }), armS(other, 100, 84), spine(0, 2 * lean, 5 * lean), { body: { dy: 0 } });
  const b = merge(armS(side, 172, 204, { wrist: -22 }), armS(other, 98, 80), spine(0, 3 * lean, 7 * lean), { body: { dy: -2 } });
  return anim(side === 'L' ? 'presentLeft' : 'presentRight', 2.8, [[0, a, 'sine'], [1.4, b, 'sine'], [2.8, a]]);
};
const presentLeft = present('L'), presentRight = present('R');

// Hands on hips: elbows out, hooves planted on the hips, chest puffed — the
// confident coach stance.
const hipsA = merge(armS('L', 146, 58, { wrist: 22 }), armS('R', 146, 58, { wrist: 22 }), legs(REST_LEG[0] + 3, REST_LEG[1] - 3), spine(0, 0, 0), { chest: { sx: 1.03, sy: 1 }, body: { dy: 0 } });
const hipsB = merge(armS('L', 148, 56, { wrist: 22 }), armS('R', 148, 56, { wrist: 22 }), spine(0, 0, -2), { chest: { sx: 1.05, sy: 1.02 }, body: { dy: -2 } });
const handsOnHips = anim('handsOnHips', 3.2, [[0, hipsA, 'sine'], [1.6, hipsB, 'sine'], [3.2, hipsA]]);

// Clap: forearms swing in front of the chest and meet in the middle.
const clapOpen = merge(armS('L', 74, 22), armS('R', 74, 22), { body: { dy: 0 }, chest: { sx: 1, sy: 1 } });
const clapShut = merge(armS('L', 52, 345), armS('R', 52, 345), { body: { dy: 4 }, chest: { sx: 1.02, sy: 0.98 } });
const clap = anim('clap', 0.8, [[0, clapOpen, 'easeIn'], [0.24, clapShut, 'easeOut'], [0.4, clapOpen, 'easeIn'], [0.64, clapShut, 'easeOut'], [0.8, clapOpen]]);

// Hand on heart: one hoof pressed to the chest, head tilted, slow warm breaths.
const heartA = merge(armS('R', 80, 322, { wrist: 20 }), armS('L', 104, 92), spine(0, -1, -6), { head: { rot: -5 }, chest: { sx: 1, sy: 1 }, body: { dy: 0 } });
const heartB = merge(armS('R', 78, 318, { wrist: 24 }), armS('L', 102, 90), spine(0, 1, -8), { head: { rot: -7 }, chest: { sx: 1.02, sy: 1.03 }, body: { dy: -2 } });
const heart = anim('heart', 3.4, [[0, heartA, 'sine'], [1.7, heartB, 'sine'], [3.4, heartA]]);

// Listen: hoof cupped behind the ear, leaning in.
const listenA = merge(armS('L', 166, 282, { wrist: 30 }), armS('R', 102, 88), spine(0, 3, 9), { head: { rot: 6 }, body: { dy: 0 } });
const listenB = merge(armS('L', 164, 278, { wrist: 34 }), armS('R', 100, 86), spine(0, 4, 12), { head: { rot: 8 }, body: { dy: -1 } });
const listen = anim('listen', 2.6, [[0, listenA, 'sine'], [1.3, listenB, 'sine'], [2.6, listenA]]);

// Point: arm thrust up and out to the side (a "let's go" / "you got this").
const pointA = merge(armS('R', 214, 232, { wrist: -8 }), armS('L', 110, 238), spine(0, -2, 3), { chest: { sx: 1.03, sy: 1 }, body: { dy: 0 } });
const pointB = merge(armS('R', 218, 238, { wrist: -12 }), armS('L', 108, 232), spine(0, -3, 4), { chest: { sx: 1.05, sy: 1.02 }, body: { dy: -3 } });
const fistPump = anim('fistPump', 1.6, [[0, pointA, 'easeInOut'], [0.8, pointB, 'easeInOut'], [1.6, pointA]]);

// Crossed arms: forearms folded across the chest, one over the other (the
// hooves tuck out of sight under the opposite biceps), chest
// puffed, weight settling from hoof to hoof — the unimpressed coach.
const crossA = merge(armS('L', 54, 352), armS('R', 72, 8), { handLShape: { op: 0 }, handRShape: { op: 0 } }, legs(REST_LEG[0] + 2, REST_LEG[1] - 2), spine(0, 0, 0), { chest: { sx: 1.03, sy: 1 }, body: { dy: 0, dx: 0 }, head: { rot: -2 } });
const crossB = merge(armS('L', 53, 350), armS('R', 71, 6), { handLShape: { op: 0 }, handRShape: { op: 0 } }, spine(0, 0, -2), { chest: { sx: 1.05, sy: 1.02 }, body: { dy: -2, dx: 2 }, head: { rot: 2 } });
const crossedArms = anim('crossedArms', 3.6, [[0, crossA, 'sine'], [1.8, crossB, 'sine'], [3.6, crossA]]);

// ---- one-shots (triggers) ---------------------------------------------------
const hop = anim('hop', 0.9, [
  [0, merge(arms(...REST_ARM), legs(...REST_LEG), { body: { dy: 0 }, chest: { sy: 1, sx: 1 }, shadow: { s: 1 } }), 'easeOut'],
  [0.12, merge(arms(110, 80), legs(REST_LEG[0] - 12, REST_LEG[1] + 14), { body: { dy: 16 }, chest: { sy: 0.9, sx: 1.05 } }), 'easeOut'],
  [0.24, merge(arms(150, 222), { body: { dy: -40 } }), 'easeIn'],
  [0.36, merge(arms(205, 240), leg('L', 95, 135), leg('R', 95, 135), { body: { dy: -110 }, chest: { sy: 1.06, sx: 0.97 }, shadow: { s: 0.62 }, sparkles: { op: 1 } }), 'easeIn'],
  [0.6, merge(arms(134, 128), legs(REST_LEG[0] - 12, REST_LEG[1] + 14), { body: { dy: 16 }, chest: { sy: 0.9, sx: 1.06 }, shadow: { s: 1 } }), 'easeOut'],
  [0.75, merge(arms(126, 108), legs(...REST_LEG), { body: { dy: -3 }, chest: { sy: 1.02, sx: 0.99 } }), 'easeInOut'],
  [0.9, merge(arms(...REST_ARM), { body: { dy: 0 }, chest: { sy: 1, sx: 1 }, sparkles: { op: 0 } })],
  ...[1, 2, 3, 4, 5].flatMap((i) => [[0.2 + i * 0.03, { [`sparkle${i}`]: { s: 0, rot: 0 } }, 'back'], [0.42 + i * 0.03, { [`sparkle${i}`]: { s: 1, rot: 60 } }, 'easeIn'], [0.85, { [`sparkle${i}`]: { s: 0, rot: 120 } }]]),
], { loop: 'oneShot' });

const hiKeys = [[0, merge(arm('R', ...REST_ARM), neck(0)), 'easeOut'], [0.3, merge(arm('R', 178, 245), neck(6)), 'sine']];
for (let i = 1; i <= 5; i++) hiKeys.push([0.3 + i * 0.2, arm('R', i % 2 ? 172 : 184, i % 2 ? 226 : 262, { wrist: i % 2 ? 26 : -22 }), 'sine']);
hiKeys.push([1.5, merge(arm('R', 178, 245), neck(6)), 'easeInOut'], [1.9, merge(arm('R', ...REST_ARM), neck(0))]);
const hi = anim('hi', 1.9, hiKeys, { loop: 'oneShot' });

const poke = anim('poke', 0.75, [
  [0, merge(arms(...REST_ARM), spine(0, 0, 0), { body: { dy: 0 }, chest: { sy: 1, sx: 1 }, head: { dy: 0 } }), 'easeOut'],
  [0.08, merge(arms(112, 80), spine(0, 0, 0), { body: { dy: 14 }, chest: { sy: 0.86, sx: 1.1 }, head: { dy: 8 } }), 'easeOut'],
  [0.24, merge(arms(130, 158), spine(0, 0, 0), { body: { dy: -26 }, chest: { sy: 1.08, sx: 0.95 }, head: { dy: -6 } }), 'easeInOut'],
  [0.42, merge(arms(128, 110), { body: { dy: 4 }, chest: { sy: 0.97, sx: 1.02 }, head: { dy: 2 } }), 'easeInOut'],
  [0.58, merge(arms(119, 92), { body: { dy: -3 }, chest: { sy: 1.01, sx: 1 } }), 'easeInOut'],
  [0.75, merge(arms(...REST_ARM), { body: { dy: 0 }, chest: { sy: 1, sx: 1 }, head: { dy: 0 } })],
], { loop: 'oneShot' });

// ---- muscles + polish ------------------------------------------------------------
// Biceps swell (bicep bones) when he works; wrists, neck
// and chest add follow-through so poses settle instead of stopping dead.
// Muscle effort 0.4 (relaxed) .. 1.35 (full squeeze) swells the bicep bone,
// which pushes the upper arm's outline out into a smooth bulge.
const muscle = (s) => {
  const sx = +(1 + (s - 0.4) * 0.42).toFixed(3), sy = +(1 + (s - 0.4) * 0.3).toFixed(3);
  return { bicepL: { sx, sy }, bicepR: { sx, sy } };
};
const add = (a, keys) => { a.keys.push(...keys); };

// Flex: biceps pump on every squeeze, fists curl, head nods with effort.
add(flex, [
  [0, merge(muscle(1.0, 0.25), { wristL: { rot: 10 }, wristR: { rot: -10 } }), 'easeInOut'],
  [0.6, merge(muscle(1.35, 0.85), { wristL: { rot: 22 }, wristR: { rot: -22 } }), 'easeInOut'],
  [1.2, merge(muscle(1.0, 0.25), { wristL: { rot: 10 }, wristR: { rot: -10 } }), 'easeInOut'],
  [1.8, merge(muscle(1.35, 0.85), { wristL: { rot: 22 }, wristR: { rot: -22 } }), 'easeInOut'],
  [2.4, merge(muscle(1.0, 0.25), { wristL: { rot: 10 }, wristR: { rot: -10 } })],
  // tiny tremble at peak squeeze
  [0.66, { body: { dx: -1.5 } }, 'linear'], [0.72, { body: { dx: 1.5 } }, 'linear'], [0.78, { body: { dx: -1 } }, 'linear'], [0.9, { body: { dx: 0 } }, 'easeOut'],
  [1.86, { body: { dx: 1.5 } }, 'linear'], [1.92, { body: { dx: -1.5 } }, 'linear'], [1.98, { body: { dx: 1 } }, 'linear'], [2.1, { body: { dx: 0 } }, 'easeOut'],
  [0, { body: { dx: 0 } }, 'hold'], [2.4, { body: { dx: 0 } }],
]);

// Leg day: arms tense on the bar as he drives up.
add(squat, [
  [0, muscle(0.7), 'easeInOut'], [1.0, muscle(0.85), 'easeInOut'], [1.3, muscle(1.0), 'easeOut'], [1.9, muscle(0.8), 'easeInOut'], [2.6, muscle(0.7)],
]);

// Jumping jacks: hands flick at the top, head bobs on landings.
add(jacks, [
  [0, { wristL: { rot: 0 }, wristR: { rot: 0 }, head: { dy: 0 } }, 'easeOut'],
  [0.28, { wristL: { rot: -14 }, wristR: { rot: 14 }, head: { dy: -4 } }, 'easeIn'],
  [0.44, { wristL: { rot: 18 }, wristR: { rot: -18 }, head: { dy: 6 } }, 'easeOut'],
  [0.6, { wristL: { rot: 0 }, wristR: { rot: 0 }, head: { dy: 0 } }, 'easeOut'],
  [0.72, { wristL: { rot: -10 }, wristR: { rot: 10 }, head: { dy: -4 } }, 'easeIn'],
  [0.88, { wristL: { rot: 8 }, wristR: { rot: -8 }, head: { dy: 5 } }, 'easeOut'],
  [1.0, { wristL: { rot: 0 }, wristR: { rot: 0 }, head: { dy: 0 } }],
]);

// Run: wrists trail the arm swing, head bobs with each stride.
add(run, [
  [0, { wristL: { rot: 0 }, wristR: { rot: -10 }, head: { dy: -2 } }, 'sine'],
  [0.175, { wristL: { rot: 4 }, wristR: { rot: -4 }, head: { dy: 4 } }, 'sine'],
  [0.35, { wristL: { rot: 10 }, wristR: { rot: 0 }, head: { dy: -2 } }, 'sine'],
  [0.525, { wristL: { rot: 4 }, wristR: { rot: -4 }, head: { dy: 4 } }, 'sine'],
  [0.7, { wristL: { rot: 0 }, wristR: { rot: -10 }, head: { dy: -2 } }],
]);

// Celebrate: hands wave, biceps pop, head bobs with the bounce.
add(celebrate, [
  [0, merge(muscle(0.8, 0.2), { wristL: { rot: -12 }, wristR: { rot: 12 } }), 'easeOut'],
  [0.38, merge(muscle(1.05, 0.4), { wristL: { rot: 18 }, wristR: { rot: -18 } }), 'easeIn'],
  [0.7, merge(muscle(0.85, 0.2), { wristL: { rot: -16 }, wristR: { rot: 16 } }), 'easeOut'],
  [1.1, merge(muscle(0.8, 0.2), { wristL: { rot: -12 }, wristR: { rot: 12 } })],
  [0, { head: { dy: 8 } }, 'easeOut'], [0.38, { head: { dy: -8 } }, 'easeIn'], [0.74, { head: { dy: 10 } }, 'easeOut'], [0.9, { head: { dy: 0 } }, 'easeInOut'], [1.1, { head: { dy: 8 } }],
]);

// Ready: fists up and tight, biceps engaged.
add(ready, [
  [0, merge(muscle(0.85, 0.25), { wristL: { rot: 18 }, wristR: { rot: -18 } }), 'sine'],
  [0.4, merge(muscle(0.95, 0.35), { wristL: { rot: 12 }, wristR: { rot: -12 } }), 'sine'],
  [0.8, merge(muscle(0.85, 0.25), { wristL: { rot: 18 }, wristR: { rot: -18 } })],
]);

// Tired: dangling hands lag behind the heavy breathing.
add(tired, [
  [0, { wristL: { rot: -6 }, wristR: { rot: 6 } }, 'sine'], [1.8, { wristL: { rot: 4 }, wristR: { rot: -4 } }, 'sine'], [3.0, { wristL: { rot: -6 }, wristR: { rot: 6 } }],
]);

// Stretch: the pulled hand stays flat, the hooking hand curls around it.
add(stretch, [
  [0, { wristL: { rot: 0 }, wristR: { rot: 0 } }, 'easeInOut'],
  [1.8, { wristL: { rot: 20 }, wristR: { rot: 0 } }, 'easeInOut'], [2.4, { wristL: { rot: 0 }, wristR: { rot: 0 } }, 'easeInOut'],
  [4.2, { wristR: { rot: -20 }, wristL: { rot: 0 } }, 'easeInOut'], [4.8, { wristL: { rot: 0 }, wristR: { rot: 0 } }],
]);

// Hop: muscles pop at the apex.
add(hop, [
  [0, muscle(0.4, 0), 'easeOut'], [0.36, muscle(1.0, 0.4), 'easeIn'], [0.75, muscle(0.6, 0.1), 'easeInOut'], [0.9, muscle(0.4, 0)],
  [0.12, { wristL: { rot: 10 }, wristR: { rot: -10 } }, 'easeOut'], [0.36, { wristL: { rot: -16 }, wristR: { rot: 16 } }, 'easeIn'],
  [0.6, { wristL: { rot: 8 }, wristR: { rot: -8 } }, 'easeOut'], [0.9, { wristL: { rot: 0 }, wristR: { rot: 0 } }],
]);

// Shoulders (clavicles): + lifts both shoulders, - drops them.
const shrug = (deg, degR = deg) => ({ clavicleL: { rot: deg }, clavicleR: { rot: -degR } });

// Idle: shoulders rise with each breath and the weight shifts slowly from foot to
// foot, so standing still never looks frozen.
add(idle, [
  [0, merge(shrug(0), { body: { dx: 0 } }), 'sine'],
  [1.6, merge(shrug(3.5), { body: { dx: 2.5 } }), 'sine'],
  [3.2, merge(shrug(0), { body: { dx: 0 } })],
]);

// Wave: the waving shoulder lifts, the other relaxes.
add(waveAnim, [[0, shrug(-1, 7), 'sine'], [1.0, shrug(-1.5, 9), 'sine'], [2.0, shrug(-1, 7)]]);
add(hi, [[0, shrug(0, 0), 'easeOut'], [0.3, shrug(-1, 8), 'sine'], [1.5, shrug(-1, 8), 'easeInOut'], [1.9, shrug(0, 0)]]);

// Flex: shoulders bunch up on every squeeze.
add(flex, [[0, shrug(4), 'easeInOut'], [0.6, shrug(9), 'easeInOut'], [1.2, shrug(4), 'easeInOut'], [1.8, shrug(9), 'easeInOut'], [2.4, shrug(4)]]);

// Squat: shoulders set as he sinks.
add(squat, [[0, shrug(1), 'easeInOut'], [1.0, shrug(5), 'easeInOut'], [1.3, shrug(5), 'easeOut'], [1.9, shrug(-1), 'easeInOut'], [2.6, shrug(1)]]);

// Jumping jacks: shoulders fly up with the arms.
add(jacks, [[0, shrug(0), 'easeOut'], [0.28, shrug(6), 'easeIn'], [0.44, shrug(10), 'easeOut'], [0.72, shrug(6), 'easeIn'], [0.88, shrug(0), 'easeOut'], [1.0, shrug(0)]]);

// Run: shoulders counter-rotate with the arm pump.
add(run, [[0, shrug(-1, 4), 'sine'], [0.175, shrug(1, 1), 'sine'], [0.35, shrug(4, -1), 'sine'], [0.525, shrug(1, 1), 'sine'], [0.7, shrug(-1, 4)]]);

// Curls: the working shoulder lifts slightly at the top of each rep.
add(curls, [[0, shrug(1, 1), 'sine'], [0.6, shrug(4, 0), 'sine'], [1.2, shrug(1, 1), 'sine'], [1.8, shrug(0, 4), 'sine'], [2.4, shrug(1, 1)]]);

// Celebrate: big shoulder pop at the top of each jump.
add(celebrate, [[0, shrug(3), 'easeOut'], [0.38, shrug(12), 'easeIn'], [0.7, shrug(1), 'easeOut'], [0.86, shrug(5), 'easeInOut'], [1.1, shrug(3)]]);

// Tired: shoulders sag and heave with the breathing.
add(tired, [[0, shrug(-7), 'sine'], [1.5, shrug(-3), 'sine'], [3.0, shrug(-7)]]);

// Sleep: fully slumped shoulders, gently rising with each breath.
add(sleep, [[0, shrug(-8), 'sine'], [2.0, shrug(-4), 'sine'], [4.0, shrug(-8)]]);

// Stretch: the pulled shoulder drops, the hooking one lifts.
add(stretch, [[0, shrug(0), 'easeInOut'], [0.8, shrug(4, -5), 'easeOut'], [1.8, shrug(5, -6), 'easeInOut'], [2.4, shrug(0), 'easeInOut'], [3.2, shrug(-5, 4), 'easeOut'], [4.2, shrug(-6, 5), 'easeInOut'], [4.8, shrug(0)]]);

// Ready: shoulders up and tight, bouncing with the knees.
add(ready, [[0, shrug(5), 'sine'], [0.4, shrug(2), 'sine'], [0.8, shrug(5)]]);

// App poses: shoulders carry the attitude.
add(shrugPose, [[0, shrug(4), 'easeInOut'], [0.7, shrug(16), 'easeInOut'], [1.3, shrug(4), 'easeInOut'], [2.2, shrug(4)]]);
add(handsOnHips, [[0, merge(shrug(3), muscle(0.7)), 'sine'], [1.6, merge(shrug(5), muscle(0.8)), 'sine'], [3.2, merge(shrug(3), muscle(0.7))]]);
add(thinking, [[0, shrug(1, 4), 'sine'], [1.8, shrug(0, 5), 'sine'], [3.6, shrug(1, 4)]]);
add(heart, [[0, shrug(1, 3), 'sine'], [1.7, shrug(3, 5), 'sine'], [3.4, shrug(1, 3)]]);
add(listen, [[0, shrug(6, 0), 'sine'], [1.3, shrug(7, 0), 'sine'], [2.6, shrug(6, 0)]]);
add(fistPump, [[0, merge(shrug(2, 9), muscle(1.0)), 'easeInOut'], [0.8, merge(shrug(2, 11), muscle(1.2)), 'easeInOut'], [1.6, merge(shrug(2, 9), muscle(1.0))]]);
add(crossedArms, [[0, merge(shrug(3), muscle(0.9)), 'sine'], [1.8, merge(shrug(5), muscle(1.0)), 'sine'], [3.6, merge(shrug(3), muscle(0.9))]]);
add(clap, [[0, shrug(2), 'easeIn'], [0.24, shrug(5), 'easeOut'], [0.4, shrug(2), 'easeIn'], [0.64, shrug(5), 'easeOut'], [0.8, shrug(2)]]);

// Hop: shoulders dip on the crouch and pop at the apex.
add(hop, [[0, shrug(0), 'easeOut'], [0.12, shrug(-4), 'easeOut'], [0.36, shrug(11), 'easeIn'], [0.6, shrug(-3), 'easeOut'], [0.9, shrug(0)]]);

// Poke: shoulders jump up in surprise.
add(poke, [[0, shrug(0), 'easeOut'], [0.08, shrug(-3), 'easeOut'], [0.24, shrug(10), 'easeInOut'], [0.42, shrug(2), 'easeInOut'], [0.75, shrug(0)]]);

// Idle: a relaxed bicep so the silhouette matches the working poses' rest.
add(idle, [[0, muscle(0.4, 0), 'hold'], [3.2, muscle(0.4, 0)]]);

// =============================================================================
// Dynamic workout poses
// =============================================================================

// ---- floor work: push-up / plank / burpee --------------------------------------
// Front view of a push-up: the torso recedes away from the viewer, so it is
// foreshortened (chest sy) while the head, arms and shoulders are counter-scaled
// back to full size. Legs extend away behind the body and are hidden; the tail
// sticks up behind him.
const PLANK_K = 0.68;
// Legs stretch away behind him: drawn smaller and squashed (perspective), feet
// converging toward the middle and resting on the floor behind the torso.
const LEG_BACK = { sx: 0.72, sy: 0.3, dx: 58, foot: 1.9 };
const floorBody = (dy, k = PLANK_K) => ({
  body: { dy }, chest: { sy: k, sx: 1.03 },
  clavicleL: { sy: +(1 / k).toFixed(4) }, clavicleR: { sy: +(1 / k).toFixed(4) }, neck1: { sx: +(1 / k).toFixed(4) },
  // legs counter the body's dip so the feet stay planted on the floor
  legL: { op: 1, sx: LEG_BACK.sx, sy: LEG_BACK.sy, dx: LEG_BACK.dx, dy: +(137 - dy).toFixed(2) }, legR: { op: 1, sx: LEG_BACK.sx, sy: LEG_BACK.sy, dx: -LEG_BACK.dx, dy: +(137 - dy).toFixed(2) },
  footL: { sx: LEG_BACK.foot }, footR: { sx: LEG_BACK.foot },
  tail: { rot: -80, dy: -40 }, shadow: { sx: 1.3, sy: 1.15 },
});
const standBody = () => ({
  body: { dy: 0 }, chest: { sy: 1, sx: 1 }, clavicleL: { sy: 1 }, clavicleR: { sy: 1 }, neck1: { sx: 1 },
  legL: { op: 1, sx: 1, sy: 1, dx: 0, dy: 0 }, legR: { op: 1, sx: 1, sy: 1, dx: 0, dy: 0 }, footL: { sx: 1 }, footR: { sx: 1 },
  tail: { rot: 0, dy: 0 }, shadow: { sx: 1, sy: 1 },
});
// Hands planted about shoulder width, arms straight at the top; at the bottom the
// elbows bend back and out (angles solved with 2-bone IK so the hands stay put).
const PU = { topDy: 155, botDy: 184 };
const armsTop = merge(armS('L', 97, 97), armS('R', 97, 97));
const armsBottom = merge(armS('L', 135, 49), armS('R', 135, 49));
const pushup = anim('pushup', 1.7, [
  [0, merge(floorBody(PU.topDy), armsTop, spine(0, 0, -3), muscle(0.6), legs(...REST_LEG)), 'easeInOut'],
  [0.75, merge(floorBody(PU.botDy, PLANK_K - 0.03), armsBottom, spine(0, 0, -6), muscle(0.95)), 'easeInOut'],
  [0.9, merge(floorBody(PU.botDy + 2, PLANK_K - 0.03), armsBottom, spine(0, 0, -6), muscle(1.0)), 'easeOut'],
  [1.5, merge(floorBody(PU.topDy - 2), armsTop, spine(0, 0, -2), muscle(0.7)), 'easeInOut'],
  [1.7, merge(floorBody(PU.topDy), armsTop, spine(0, 0, -3), muscle(0.6))],
]);

// Plank: hold at the top of a push-up, trembling with effort, breathing hard.
const plankKeys = [[0, merge(floorBody(PU.topDy), armsTop, spine(0, 0, -4), muscle(0.8)), 'sine']];
for (let i = 1; i <= 12; i++) {
  const sh = i % 2 ? 1.6 : -1.6;
  plankKeys.push([i * 0.2, merge({ body: { dx: i === 12 ? 0 : sh } }, i % 4 === 2 ? { chest: { sx: 1.05 } } : { chest: { sx: 1.03 } }), 'linear']);
}
plankKeys.push([0, { body: { dx: 0 } }, 'linear'], [0, { sweat: { op: 1 } }, 'hold'], ...drip('sweat1', 0.2), ...drip('sweat2', 1.2), [0, { sweat1: { op: 0 }, sweat2: { op: 0 } }, 'hold'], [2.4, { sweat1: { dy: 0, op: 0, s: 0.6 }, sweat2: { dy: 0, op: 0, s: 0.6 } }]);
const plank = anim('plank', 2.4, plankKeys);

// Burpee: squat down, hands to the floor, kick back to plank, push-up, jump the
// feet in, explode up with arms overhead, land.
const burpee = anim('burpee', 2.6, [
  [0, merge(standBody(), squatLegs(0), arms(122, 98), spine(0, 0, 0)), 'easeIn'],
  [0.35, merge(standBody(), squatLegs(1), armS('L', 100, 95), armS('R', 100, 95), spine(0, 0, 4), { body: { dy: 60 } }), 'easeOut'],
  [0.6, merge(floorBody(PU.topDy), armsTop, spine(0, 0, -4)), 'easeInOut'],
  [0.95, merge(floorBody(PU.botDy, PLANK_K - 0.03), armsBottom, spine(0, 0, -8)), 'easeInOut'],
  [1.25, merge(floorBody(PU.topDy), armsTop, spine(0, 0, -4)), 'easeOut'],
  [1.5, merge(standBody(), squatLegs(1), armS('L', 100, 95), armS('R', 100, 95), spine(0, 0, 4), { body: { dy: 60 } }), 'easeOut'],
  [1.85, merge(standBody(), squatLegs(0), arms(222, 250), spine(0, 0, -2), { body: { dy: -95 }, shadow: { sx: 0.7, sy: 0.7 } }), 'easeIn'],
  [2.15, merge(standBody(), squatLegs(0.45), arms(138, 124), spine(0, 0, 2), { body: { dy: 20 } }), 'easeOut'],
  [2.6, merge(standBody(), squatLegs(0), arms(122, 98), spine(0, 0, 0))],
]);

// ---- lunges ------------------------------------------------------------------------
// Front view: the front thigh comes toward the viewer (foreshortened) over a
// vertical shin; the back shin goes away (foreshortened) so its knee drops toward
// the floor. Hands on hips, torso tall, alternating legs.
const hipsHands = merge(armS('L', 125, 31), armS('R', 125, 31));
const lungeLegs = (front, depth) => {
  const back = front === 'L' ? 'R' : 'L';
  const F = legS(front, 90.5 + 12 * depth, 97.4 - 4 * depth, 1 - 0.6 * depth);
  const B = legS(back, 90.5 - 3 * depth, 97.4 + 2 * depth);
  const shinScale = +(1 - 0.6 * depth).toFixed(3);
  B[`shin${back}`].sx = shinScale; B[`foot${back}`] = { ...B[`foot${back}`], sx: +(1 / shinScale).toFixed(3) };
  const sway = front === 'L' ? -10 : 10; // weight shifts over the front foot
  return merge(F, B, { body: { dy: +(52 * depth).toFixed(2), dx: +(sway * depth).toFixed(2) }, [`leg${front}`]: { dx: +((-sway - (front === 'L' ? 14 : -14)) * depth).toFixed(2) }, [`leg${back}`]: { dx: +(-sway * depth).toFixed(2) } });
};
const lunge = anim('lunge', 3.2, [
  [0, merge(lungeLegs('L', 0), hipsHands, spine(0, 0, 0), { chest: { sy: 1 } }), 'easeInOut'],
  [0.65, merge(lungeLegs('L', 1), hipsHands, spine(0, 1, -1), { chest: { sy: 0.98 } }), 'easeInOut'],
  [0.9, merge(lungeLegs('L', 1), hipsHands, spine(0, 1, -1), { chest: { sy: 0.98 } }), 'easeInOut'],
  [1.5, merge(lungeLegs('L', 0), hipsHands, spine(0, 0, 0), { chest: { sy: 1.01 } }), 'easeInOut'],
  [1.6, merge(lungeLegs('R', 0), hipsHands, spine(0, 0, 0), { chest: { sy: 1 } }), 'easeInOut'],
  [2.25, merge(lungeLegs('R', 1), hipsHands, spine(0, -1, 1), { chest: { sy: 0.98 } }), 'easeInOut'],
  [2.5, merge(lungeLegs('R', 1), hipsHands, spine(0, -1, 1), { chest: { sy: 0.98 } }), 'easeInOut'],
  [3.1, merge(lungeLegs('R', 0), hipsHands, spine(0, 0, 0), { chest: { sy: 1.01 } }), 'easeInOut'],
  [3.2, merge(lungeLegs('L', 0), hipsHands, spine(0, 0, 0), { chest: { sy: 1 } })],
]);

// ---- boxing -------------------------------------------------------------------------
// Guard with fists up by the chin, bouncing on the toes; jab (left) then cross
// (right). A punching fist swings in front of the chest and grows (it is coming
// toward the viewer); the torso twists into each punch.
const guard = (side) => armS(side, 100, 285);
const punch = (side) => merge(armS(side, 45, -25), { [`wrist${side}`]: { s: 1.3 } });
const fistBack = (side) => ({ [`wrist${side}`]: { s: 1 } });
const boxStance = (dy) => merge(legs(REST_LEG[0] + 4, REST_LEG[1] - 5), { legL: { rot: 4 }, legR: { rot: -4 }, body: { dy } });
const boxing = anim('boxing', 1.4, [
  [0, merge(boxStance(6), guard('L'), guard('R'), fistBack('L'), fistBack('R'), spine(0, 0, 0)), 'easeOut'],
  [0.13, merge(boxStance(2), punch('L'), guard('R'), spine(0, 5, -3), shrug(6, 0)), 'easeOut'],
  [0.32, merge(boxStance(6), guard('L'), guard('R'), fistBack('L'), spine(0, 0, 0), shrug(0, 0)), 'easeInOut'],
  [0.5, merge(boxStance(0), guard('L'), guard('R'), spine(0, -2, 1)), 'easeIn'],
  [0.64, merge(boxStance(3), guard('L'), punch('R'), spine(0, -9, 5), shrug(0, 8)), 'easeOut'],
  [0.86, merge(boxStance(6), guard('L'), guard('R'), fistBack('R'), spine(0, 0, 0), shrug(0, 0)), 'easeInOut'],
  [1.1, merge(boxStance(0), guard('L'), guard('R'), spine(0, 1, -1)), 'easeInOut'],
  [1.4, merge(boxStance(6), guard('L'), guard('R'), fistBack('L'), fistBack('R'), spine(0, 0, 0))],
]);

// ---- jump rope -----------------------------------------------------------------------
// Hands low at the hips turning the rope; the rope's scaleY sweeps from under the
// feet (+1) up behind him, over the head (-2.05) and back down in front. The back
// half is drawn behind the body, the front half in front; small hops clear it.
const ropeHands = merge(armS('L', 105, 80), armS('R', 105, 80));
const jumpRope = anim('jumpRope', 0.64, [
  [0, merge(ropeHands, legs(...REST_LEG), { rope: { op: 1, sy: 1 }, ropeBack: { op: 1 }, ropeFront: { op: 0 }, body: { dy: -20 }, shadow: { s: 0.9 }, wristL: { rot: 10 }, wristR: { rot: -10 } }), 'easeIn'],
  [0.16, merge({ rope: { sy: -0.4 }, body: { dy: 4 }, shadow: { s: 1 }, wristL: { rot: -6 }, wristR: { rot: 6 } }, legs(REST_LEG[0] - 5, REST_LEG[1] + 6)), 'linear'],
  [0.32, merge({ rope: { sy: -2.05 }, ropeBack: { op: 0 }, ropeFront: { op: 1 }, body: { dy: 0 }, wristL: { rot: -12 }, wristR: { rot: 12 } }, legs(...REST_LEG)), 'linear'],
  [0.48, merge({ rope: { sy: -0.4 }, body: { dy: -8 }, wristL: { rot: 4 }, wristR: { rot: -4 } }), 'linear'],
  [0.63, { ropeBack: { op: 0 }, ropeFront: { op: 1 } }, 'hold'],
  [0.64, merge(ropeHands, legs(...REST_LEG), { rope: { op: 1, sy: 1 }, ropeBack: { op: 1 }, ropeFront: { op: 0 }, body: { dy: -20 }, shadow: { s: 0.9 }, wristL: { rot: 10 }, wristR: { rot: -10 } })],
  [0.31, { ropeBack: { op: 1 }, ropeFront: { op: 0 } }, 'hold'],
]);

// ---- high knees ------------------------------------------------------------------------
// Sprint in place: knees drive up high and fast, arms pump hard.
const HK_UP = (side) => legS(side, 92, 78, 0.18);
const highA = merge(HK_UP('L'), PLANT('R', 2), armS('R', 70, -45), armS('L', 110, 125), spine(1, 4, -4), { body: { dy: -14 }, shadow: { s: 0.9 } });
const highB = merge(HK_UP('R'), PLANT('L', 2), armS('L', 70, -45), armS('R', 110, 125), spine(-1, -4, 4), { body: { dy: -14 }, shadow: { s: 0.9 } });
const highMid = merge(PLANT('L', 5), PLANT('R', 5), armS('L', 90, 40), armS('R', 90, 40), spine(0, 0, 0), { body: { dy: 4 }, shadow: { s: 1 } });
const highKnees = anim('highKnees', 0.5, [[0, highA, 'sine'], [0.125, highMid, 'sine'], [0.25, highB, 'sine'], [0.375, highMid, 'sine'], [0.5, highA]]);

export const BODY_ANIMATIONS = [idle, waveAnim, flex, squat, jacks, run, curls, celebrate, tired, sleep, stretch, ready,
  pushup, plank, lunge, burpee, boxing, jumpRope, highKnees,
  thinking, shrugPose, presentLeft, presentRight, handsOnHips, clap, heart, listen, fistPump, crossedArms, hop, hi, poke];

// ---------------------------------------------------------------------------
// Ambient layer: tail swishing through its 4 bones + ear flicks, always running

const AMB = 6;
export const AMBIENT_ANIMATIONS = [anim('ambient', AMB, [
  // A travelling wave down the 8 tail bones: each lags and swings a bit more.
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => wave(`tail${i}`, 'rot', { amp: 2.4 + i * 1.5, period: 2, phase: -0.42 * (i - 1), duration: AMB })),
  ...wave('tailTip', 'rot', { amp: 12, period: 2, phase: -3.6, duration: AMB }),
  // Ear tips sway gently and trail behind each flick.
  ...wave('earL2', 'rot', { amp: 3, period: 3, duration: AMB, steps: 6 }),
  ...wave('earR2', 'rot', { amp: 3, period: 3, phase: 1.2, duration: AMB, steps: 6 }),
  [0, { earL: { rot: 0 }, earR: { rot: 0 } }, 'hold'],
  [2.2, { earL: { rot: 0 } }, 'easeOut'], [2.3, { earL: { rot: 16 } }, 'easeInOut'], [2.45, { earL: { rot: -4 } }, 'easeInOut'], [2.6, { earL: { rot: 0 } }, 'hold'],
  [4.4, { earR: { rot: 0 } }, 'easeOut'], [4.5, { earR: { rot: -16 } }, 'easeInOut'], [4.65, { earR: { rot: 4 } }, 'easeInOut'], [4.8, { earR: { rot: 0 } }, 'easeOut'],
  [4.9, { earR: { rot: -10 } }, 'easeInOut'], [5.05, { earR: { rot: 0 } }, 'hold'],
  [AMB, { earL: { rot: 0 }, earR: { rot: 0 } }],
])];

export const BLINK_ANIMATIONS = [anim('blink', 4.2, [
  [0, { eyeL: { sy: 1 }, eyeR: { sy: 1 } }, 'hold'],
  [3.0, { eyeL: { sy: 1 }, eyeR: { sy: 1 } }, 'easeIn'],
  [3.07, { eyeL: { sy: 0.08 }, eyeR: { sy: 0.08 } }, 'easeOut'],
  [3.16, { eyeL: { sy: 1 }, eyeR: { sy: 1 } }, 'hold'],
  [3.7, { eyeL: { sy: 1 }, eyeR: { sy: 1 } }, 'easeIn'],
  [3.76, { eyeL: { sy: 0.08 }, eyeR: { sy: 0.08 } }, 'easeOut'],
  [3.85, { eyeL: { sy: 1 }, eyeR: { sy: 1 } }, 'hold'],
  [4.2, { eyeL: { sy: 1 }, eyeR: { sy: 1 } }],
])];

// ---------------------------------------------------------------------------
// Face layer (driven by `mood`)

const MOUTHS = ['mouthNeutral', 'mouthSmile', 'mouthGrin', 'mouthTongue', 'mouthO', 'mouthFrown', 'mouthFlat', 'mouthSmirk'];
const face = ({ eyes = 'open', lid = 1, eyeW = 1, pupil = 1, browL = [0, 0], browR, mouth = ['mouthNeutral'], mouthScale = 1 }) => {
  browR = browR || [-browL[0], browL[1]];
  const p = {
    eyeOpenL: { op: eyes === 'open' ? 1 : 0, sy: lid, sx: eyeW }, eyeOpenR: { op: eyes === 'open' ? 1 : 0, sy: lid, sx: eyeW },
    eyeHappyL: { op: eyes === 'happy' ? 1 : 0 }, eyeHappyR: { op: eyes === 'happy' ? 1 : 0 },
    eyeClosedL: { op: eyes === 'closed' ? 1 : 0 }, eyeClosedR: { op: eyes === 'closed' ? 1 : 0 },
    pupilL: { s: pupil }, pupilR: { s: pupil },
    browL: { rot: browL[0], dy: browL[1] }, browR: { rot: browR[0], dy: browR[1] },
    mouthO: { s: mouthScale },
  };
  for (const m of MOUTHS) p[m] = { ...(p[m] || {}), op: mouth.includes(m) ? 1 : 0 };
  return p;
};
export const FACES = {
  neutral: face({}),
  happy: face({ eyes: 'happy', browL: [-6, -6], mouth: ['mouthGrin', 'mouthTongue'] }),
  determined: face({ lid: 0.78, pupil: 0.9, browL: [32, 12], mouth: ['mouthFlat'] }),
  tired: face({ lid: 0.52, pupil: 0.85, browL: [-22, 8], mouth: ['mouthO'], mouthScale: 0.85 }),
  sad: face({ lid: 0.92, browL: [-30, -4], mouth: ['mouthFrown'] }),
  surprised: face({ lid: 1.12, eyeW: 1.06, pupil: 0.7, browL: [0, -13], mouth: ['mouthO'], mouthScale: 1.25 }),
  sleepy: face({ eyes: 'closed', browL: [-5, 5] }),
  proud: face({ lid: 0.84, browL: [-12, -10], browR: [18, 5], mouth: ['mouthSmirk'] }),
};
export const FACE_ANIMATIONS = [
  ...MOODS.map((m) => anim(`face_${m}`, 1, [[0, FACES[m], 'hold'], [1, FACES[m]]])),
  anim('face_poke', 0.8, [[0, FACES.surprised, 'hold'], [0.8, FACES.surprised]], { loop: 'oneShot' }),
];

// ---------------------------------------------------------------------------
// Accessory + look layers

export const GLASSES_ANIMATIONS = [
  anim('glasses_on', 0.5, [[0, { glasses: { dy: 0, s: 1, rot: 0 } }, 'hold'], [0.5, { glasses: { dy: 0, s: 1, rot: 0 } }]]),
  anim('glasses_off', 0.5, [[0, { glasses: { dy: -108, s: 0.78, rot: -4 } }, 'hold'], [0.5, { glasses: { dy: -108, s: 0.78, rot: -4 } }]]),
];
const look = (name, p) => anim(name, 0.5, [[0, p, 'hold'], [0.5, p]]);
export const LOOK_ANIMATIONS = [
  look('look_left', { face: { dx: -18 }, pupilL: { dx: -5 }, pupilR: { dx: -5 }, earL: { dx: 5 }, earR: { dx: 5 }, hornL: { dx: 4 }, hornR: { dx: 4 } }),
  look('look_center', { face: { dx: 0 }, pupilL: { dx: 0 }, pupilR: { dx: 0 }, earL: { dx: 0 }, earR: { dx: 0 }, hornL: { dx: 0 }, hornR: { dx: 0 } }),
  look('look_right', { face: { dx: 18 }, pupilL: { dx: 5 }, pupilR: { dx: 5 }, earL: { dx: -5 }, earR: { dx: -5 }, hornL: { dx: -4 }, hornR: { dx: -4 } }),
  look('look_up', { face: { dy: -10 }, pupilL: { dy: -5 }, pupilR: { dy: -5 } }),
  look('look_middle', { face: { dy: 0 }, pupilL: { dy: 0 }, pupilR: { dy: 0 } }),
  look('look_down', { face: { dy: 9 }, pupilL: { dy: 4 }, pupilR: { dy: 4 } }),
];
