// Assembles Kabi's full model: rig + artwork + animations + state machine.
// The model is plain JSON, so the web editor can tweak it and re-compile.
import { buildRig, PALETTE, ARTBOARD, OUTLINE_PARTS } from './rig.js';
import { sampleTrack } from '../riv/sample.js';
import {
  POSES, MOODS, ONE_SHOTS,
  BODY_ANIMATIONS, AMBIENT_ANIMATIONS, BLINK_ANIMATIONS, FACE_ANIMATIONS,
  GLASSES_ANIMATIONS, LOOK_ANIMATIONS,
} from './animations.js';

export { POSES, MOODS, ONE_SHOTS };

// Head-only view: everything below the neck fades out and the root zooms in so
// the head fills the artboard (for avatars / chat bubbles). Only properties no
// other layer animates are touched here, so it composes with every pose.
const HEAD_VIEW = { scale: 1.5, dy: 370 }; // head + ears ~590px wide -> ~885px of the 1000px artboard
const BELOW_NECK = [
  'tail', 'armL', 'armR', 'legLShape', 'legRShape', 'hoofL', 'hoofR', 'kneeCapL', 'kneeCapR',
  'pelvis', 'torso', 'belly', 'shadow', 'ropeWrap', 'shirt',
  ...['pelvis', 'torso', 'legLShape', 'legRShape', 'hoofL', 'hoofR', 'kneeCapL', 'kneeCapR'].map((id) => `${id}Outline`),
  'barbellBar', 'barbellCollarL', 'barbellCollarR', 'barbellPlateL', 'barbellPlateR', 'barbellPlateOuterL', 'barbellPlateOuterR',
];
function viewAnimations() {
  const pose = (head) => {
    const tracks = BELOW_NECK.map((target) => ({ target, prop: 'opacity', keys: [[0, head ? 0 : 1, 'hold']] }));
    tracks.push(
      { target: 'root', prop: 'scaleX', keys: [[0, head ? HEAD_VIEW.scale : 1, 'hold']] },
      { target: 'root', prop: 'scaleY', keys: [[0, head ? HEAD_VIEW.scale : 1, 'hold']] },
    );
    return tracks;
  };
  return [
    { name: 'view_full', duration: 0.5, loop: 'loop', fps: 60, tracks: pose(false) },
    { name: 'view_head', duration: 0.5, loop: 'loop', fps: 60, tracks: pose(true) },
  ];
}

// Body colors for the `color` input. Index 0 uses the palette, so palette edits
// in the editor still change the default look; the others are fixed recolors.
export const SKINS = [
  { name: 'black', body: 'body', belly: 'belly' },
  { name: 'blue', body: '#2f5fd0', belly: '#86a8f2' },
  { name: 'red', body: '#cf3434', belly: '#f29488' },
  { name: 'pink', body: '#ee76a6', belly: '#fbc6db' },
  { name: 'green', body: '#2c9a66', belly: '#8bd6ad' },
  { name: 'purple', body: '#6b4bcf', belly: '#b09cf0' },
  { name: 'orange', body: '#ee7a2c', belly: '#f9bf92' },
  { name: 'brown', body: '#7a4a2a', belly: '#bf936d' },
];

/** T-shirt on/off: fades the shirt body, hem, logo and sleeves. */
const SHIRT_PARTS = ['shirtBody', 'shirtHem', 'shirtLogo', 'sleeveL', 'sleeveR'];
function shirtAnimations() {
  const pose = (on) => SHIRT_PARTS.map((target) => ({ target, prop: 'opacity', keys: [[0, on ? 1 : 0, 'hold']] }));
  return [
    { name: 'shirt_on', duration: 0.5, loop: 'loop', fps: 60, tracks: pose(true) },
    { name: 'shirt_off', duration: 0.5, loop: 'loop', fps: 60, tracks: pose(false) },
  ];
}

/** Outline on/off: fades every outline copy's stroke in or out. */
function outlineAnimations(palette) {
  const on = palette.outline, off = `${on.slice(0, 7)}00`;
  const pose = (color) => OUTLINE_PARTS.map((id) => ({ target: `${id}Outline`, prop: 'strokeColor', keys: [[0, color, 'hold']] }));
  return [
    { name: 'outline_on', duration: 0.5, loop: 'loop', fps: 60, tracks: pose(on) },
    { name: 'outline_off', duration: 0.5, loop: 'loop', fps: 60, tracks: pose(off) },
  ];
}

/** One held pose per skin that recolors every body/belly-filled shape. */
function skinAnimations(shapes) {
  const bodyIds = shapes.filter((s) => s.fill === 'body').map((s) => s.id);
  const bellyIds = shapes.filter((s) => s.fill === 'belly').map((s) => s.id);
  return SKINS.map((skin) => ({
    name: `color_${skin.name}`, duration: 0.5, loop: 'loop', fps: 60,
    tracks: [
      ...bodyIds.map((target) => ({ target, prop: 'color', keys: [[0, skin.body, 'hold']] })),
      ...bellyIds.map((target) => ({ target, prop: 'color', keys: [[0, skin.belly, 'hold']] })),
    ],
  }));
}

const PROP_OF = { rot: 'rotation', dx: 'x', dy: 'y', sx: 'scaleX', sy: 'scaleY', op: 'opacity' };

export function restValue(obj, prop) {
  switch (prop) {
    case 'x': return obj.x ?? 0;
    case 'y': return obj.y ?? 0;
    case 'rotation': return obj.rotation ?? 0;
    case 'scaleX': return obj.scaleX ?? 1;
    case 'scaleY': return obj.scaleY ?? 1;
    case 'opacity': return obj.opacity ?? 1;
    default: throw new Error(prop);
  }
}

/** Pose-style keys -> per-property tracks with absolute values. */
export function posesToTracks(a, objects) {
  const tracks = new Map();
  for (const [time, pose, ease] of a.keys) {
    for (const [target, vals] of Object.entries(pose)) {
      const obj = objects.get(target);
      if (!obj) throw new Error(`Animation ${a.name}: unknown target ${target}`);
      const expanded = { ...vals };
      if ('s' in expanded) { expanded.sx ??= expanded.s; expanded.sy ??= expanded.s; delete expanded.s; }
      for (const [k, v] of Object.entries(expanded)) {
        const prop = PROP_OF[k];
        if (!prop) throw new Error(`Animation ${a.name}: bad channel ${k}`);
        const value = k === 'dx' || k === 'dy' || k === 'rot' ? restValue(obj, prop) + v : v;
        const id = `${target}.${prop}`;
        if (!tracks.has(id)) tracks.set(id, { target, prop, keys: [] });
        const keys = tracks.get(id).keys;
        const existing = keys.findIndex((kk) => Math.abs(kk[0] - time) < 1e-6);
        const key = [+time.toFixed(4), +value.toFixed(4), ease || 'easeInOut'];
        if (existing >= 0) keys[existing] = key; else keys.push(key);
      }
    }
  }
  for (const t of tracks.values()) t.keys.sort((p, q) => p[0] - q[0]);
  return [...tracks.values()];
}

/** Pads every animation in a layer so each keys every property the layer uses. */
function padLayer(anims, objects) {
  const all = new Map();
  for (const a of anims) for (const t of a.tracks) all.set(`${t.target}.${t.prop}`, t);
  for (const a of anims) {
    const have = new Set(a.tracks.map((t) => `${t.target}.${t.prop}`));
    for (const [id, t] of all) {
      if (have.has(id)) continue;
      a.tracks.push({ target: t.target, prop: t.prop, keys: [[0, restValue(objects.get(t.target), t.prop), 'hold']], padded: true });
    }
  }
}

function meshTransitions(stateNames, input, duration, ease = 'easeInOut') {
  const out = [];
  stateNames.forEach((from) => stateNames.forEach((to, j) => {
    if (from !== to) out.push({ from, to, duration, ease, conditions: [{ input, op: 'eq', value: j }] });
  }));
  return out;
}

// Bend distribution: each elbow/knee bend authored on the forearm/shin is spread
// over the joint before it, the joint itself and the joint after it (25/50/25),
// so limbs curve in a smooth arc instead of kinking at a single hinge.
const BEND_SPLIT = [];
for (const s of ['L', 'R']) {
  BEND_SPLIT.push({ main: `forearm${s}`, before: `upperArmB${s}`, after: `forearmB${s}` });
  BEND_SPLIT.push({ main: `shin${s}`, before: `thighB${s}`, after: `shinB${s}` });
}
function distributeBends(a, objects) {
  for (const { main, before, after } of BEND_SPLIT) {
    const tr = a.tracks.find((t) => t.target === main && t.prop === 'rotation');
    if (!tr) continue;
    const r0 = restValue(objects.get(main), 'rotation');
    const rb = restValue(objects.get(before), 'rotation'), ra = restValue(objects.get(after), 'rotation');
    const share = (rest, f) => tr.keys.map(([t, v, e]) => [t, +(rest + (v - r0) * f).toFixed(4), e]);
    a.tracks = a.tracks.filter((t) => !(t.prop === 'rotation' && (t.target === before || t.target === after)));
    a.tracks.push({ target: before, prop: 'rotation', keys: share(rb, 0.25) }, { target: after, prop: 'rotation', keys: share(ra, 0.25) });
    tr.keys = share(r0, 0.5);
  }
}

// Follow-through: in looping body poses, parts further down the chain trail the
// motion that drives them. Each listed track is delayed (wrapping around the
// loop, so it stays seamless).
const FOLLOW_THROUGH = {
  clavicleL: 0.04, clavicleR: 0.04,
  upperArmBL: 0.05, upperArmBR: 0.05,
  forearmL: 0.09, forearmR: 0.09, forearmBL: 0.12, forearmBR: 0.12, wristL: 0.15, wristR: 0.15,
  dumbbellL: 0.11, dumbbellR: 0.11, // ~average lag of the joints it counter-rotates, so it stays level
  thighBL: 0.03, thighBR: 0.03, shinBL: 0.05, shinBR: 0.05,
  bicepL: 0.05, bicepR: 0.05,
  neck1: 0.04, neck2: 0.07, head: 0.06,
};
function applyFollowThrough(a) {
  const D = a.duration;
  if (a.loop === 'oneShot') {
    // One-shots start and end at rest, so simply delay the trailing parts; the
    // exit crossfade absorbs the short remainder.
    for (const tr of a.tracks) {
      const lag = FOLLOW_THROUGH[tr.target];
      if (!lag || tr.prop === 'color' || tr.keys.length < 2) continue;
      const first = tr.keys[0][1];
      const shifted = tr.keys.map(([t, v, e]) => [+(t + lag).toFixed(4), v, e]).filter((k) => k[0] < D - 1e-4);
      tr.keys = [[0, first, 'linear'], ...shifted, [D, +sampleTrack(tr.keys, D - lag).toFixed(4), 'linear']];
    }
    return;
  }
  if (a.loop !== 'loop') return;
  for (const tr of a.tracks) {
    const lag = FOLLOW_THROUGH[tr.target];
    if (!lag || tr.prop === 'color' || tr.keys.length < 2) continue;
    const v0 = sampleTrack(tr.keys, 0), vD = sampleTrack(tr.keys, D);
    const values = tr.keys.map((k) => k[1]);
    if (Math.max(...values) - Math.min(...values) < 1e-3) continue; // constant
    if (Math.abs(v0 - vD) > 1e-3) continue; // not a seamless loop; leave it alone
    // Shift every key later by `lag`; keys pushed past the end wrap to the start.
    // The loop seam gets a short linear bridge through the value at D - lag.
    const seam = +sampleTrack(tr.keys, D - lag).toFixed(4);
    const keys = tr.keys
      .filter((k) => k[0] < D - 1e-6)
      .map(([t, v, e]) => [+(((t + lag) % D)).toFixed(4), v, e])
      .sort((p, q) => p[0] - q[0]);
    const lastBefore = [...keys].reverse().find((k) => k[0] > 0);
    if (lastBefore && keys[keys.length - 1] === lastBefore) lastBefore[2] = 'linear';
    tr.keys = [[0, seam, 'linear'], ...keys.filter((k) => k[0] > 1e-4), [D, seam, 'linear']];
  }
}

export const INPUTS = [
  { name: 'pose', type: 'number', value: 0, description: `Body pose: ${POSES.map((p, i) => `${i}=${p}`).join(', ')}` },
  { name: 'mood', type: 'number', value: 0, description: `Facial expression: ${MOODS.map((p, i) => `${i}=${p}`).join(', ')}` },
  { name: 'color', type: 'number', value: 0, description: `Body color: ${SKINS.map((c, i) => `${i}=${c.name}`).join(', ')}` },
  { name: 'shirt', type: 'bool', value: true, description: 'T-shirt with the logo on the chest' },
  { name: 'outline', type: 'bool', value: false, description: 'Light rim around the silhouette, for dark backgrounds' },
  { name: 'headOnly', type: 'bool', value: false, description: 'Show just the head, zoomed to fill the frame (avatars, chat bubbles)' },
  { name: 'glasses', type: 'bool', value: true, description: 'Sunglasses on (true) or taken off (false)' },
  { name: 'lookX', type: 'number', value: 0, description: 'Gaze, -100 (left) .. 100 (right)' },
  { name: 'lookY', type: 'number', value: 0, description: 'Gaze, -100 (up) .. 100 (down)' },
  { name: 'jump', type: 'trigger', description: 'One-shot celebratory hop' },
  { name: 'hi', type: 'trigger', description: 'One-shot wave hello' },
  { name: 'poke', type: 'trigger', description: 'One-shot surprised squash (e.g. on tap)' },
];

export function buildStateMachine() {
  const poseStates = POSES.map((p) => `pose_${p}`);
  const body = {
    name: 'Body',
    entry: poseStates[0],
    states: [
      ...POSES.map((p) => ({ name: `pose_${p}`, animation: p })),
      ...ONE_SHOTS.map((o) => ({ name: `once_${o.trigger}`, animation: o.animation })),
    ],
    transitions: [
      ...meshTransitions(poseStates, 'pose', 480),
      ...ONE_SHOTS.map((o) => ({ from: 'any', to: `once_${o.trigger}`, duration: 140, ease: 'easeOut', conditions: [{ input: o.trigger }] })),
      ...ONE_SHOTS.flatMap((o) => poseStates.map((to, j) => ({
        from: `once_${o.trigger}`, to, exitTime: 100, duration: 320, ease: 'easeInOut', conditions: [{ input: 'pose', op: 'eq', value: j }],
      }))),
    ],
  };
  const moodStates = MOODS.map((m) => `mood_${m}`);
  const face = {
    name: 'Face',
    entry: moodStates[0],
    states: [...MOODS.map((m) => ({ name: `mood_${m}`, animation: `face_${m}` })), { name: 'face_poke', animation: 'face_poke' }],
    transitions: [
      ...meshTransitions(moodStates, 'mood', 220),
      { from: 'any', to: 'face_poke', duration: 60, conditions: [{ input: 'poke' }] },
      ...moodStates.map((to, j) => ({ from: 'face_poke', to, exitTime: 100, duration: 200, conditions: [{ input: 'mood', op: 'eq', value: j }] })),
    ],
  };
  const toggle = (name, input, onAnim, offAnim, duration) => ({
    name,
    entry: INPUTS.find((i) => i.name === input).value ? 'on' : 'off',
    states: [{ name: 'on', animation: onAnim }, { name: 'off', animation: offAnim }],
    transitions: [
      { from: 'on', to: 'off', duration, ease: 'easeInOut', conditions: [{ input, value: false }] },
      { from: 'off', to: 'on', duration, ease: 'easeInOut', conditions: [{ input, value: true }] },
    ],
  });
  const glasses = toggle('Glasses', 'glasses', 'glasses_on', 'glasses_off', 380);
  const view = toggle('View', 'headOnly', 'view_head', 'view_full', 220);
  const outline = toggle('Outline', 'outline', 'outline_on', 'outline_off', 250);
  const shirt = toggle('Shirt', 'shirt', 'shirt_on', 'shirt_off', 300);
  const skinStates = SKINS.map((c) => `color_${c.name}`);
  const color = {
    name: 'Color',
    entry: skinStates[0],
    states: skinStates.map((name) => ({ name, animation: name })),
    transitions: meshTransitions(skinStates, 'color', 350),
  };
  const blend = (name, input, anims) => ({
    name, entry: 'blend',
    states: [{ name: 'blend', blend: { input, animations: anims.map(([animation, value]) => ({ animation, value })) } }],
  });
  return {
    name: 'Kabi',
    inputs: INPUTS.map(({ description, ...i }) => i),
    layers: [
      body,
      { name: 'Ambient', entry: 'ambient', states: [{ name: 'ambient', animation: 'ambient' }] },
      { name: 'Blink', entry: 'blink', states: [{ name: 'blink', animation: 'blink' }] },
      face,
      glasses,
      color,
      view,
      outline,
      shirt,
      blend('LookX', 'lookX', [['look_left', -100], ['look_center', 0], ['look_right', 100]]),
      blend('LookY', 'lookY', [['look_up', -100], ['look_middle', 0], ['look_down', 100]]),
    ],
  };
}

export function buildModel() {
  const { nodes, shapes } = buildRig();
  const objects = new Map([...nodes, ...shapes].map((o) => [o.id, o]));
  const layers = [BODY_ANIMATIONS, AMBIENT_ANIMATIONS, BLINK_ANIMATIONS, FACE_ANIMATIONS, GLASSES_ANIMATIONS, LOOK_ANIMATIONS];
  const animations = [];
  for (const group of layers) {
    const compiled = group.map((a) => ({ name: a.name, duration: a.duration, loop: a.loop, fps: 60, tracks: posesToTracks(a, objects) }));
    if (group !== LOOK_ANIMATIONS) padLayer(compiled, objects);
    if (group === BODY_ANIMATIONS) compiled.forEach((a) => { distributeBends(a, objects); applyFollowThrough(a); });
    animations.push(...compiled);
  }
  animations.push(...skinAnimations(shapes));
  animations.push(...outlineAnimations(PALETTE));
  animations.push(...shirtAnimations());
  // Zooming scales around the root (the ground point), so the root also moves
  // down by HEAD_VIEW.dy to bring the enlarged head back to the artboard centre.
  const root = nodes.find((n) => n.id === 'root');
  const [full, head] = viewAnimations();
  full.tracks.push({ target: 'root', prop: 'y', keys: [[0, root.y, 'hold']] });
  head.tracks.push({ target: 'root', prop: 'y', keys: [[0, root.y + HEAD_VIEW.dy, 'hold']] });
  animations.push(full, head);
  // Look X / Y blend layers each touch their own channels; pad them separately.
  const lookX = animations.filter((a) => ['look_left', 'look_center', 'look_right'].includes(a.name));
  const lookY = animations.filter((a) => ['look_up', 'look_middle', 'look_down'].includes(a.name));
  padLayer(lookX, objects); padLayer(lookY, objects);

  return {
    format: 'kabi-model@30',
    name: 'Kabi',
    artboard: { name: 'Kabi', width: ARTBOARD.width, height: ARTBOARD.height },
    palette: { ...PALETTE },
    nodes,
    shapes,
    animations,
    stateMachines: [buildStateMachine()],
    meta: { poses: POSES, moods: MOODS, skins: SKINS.map((c) => c.name), oneShots: ONE_SHOTS, inputs: INPUTS },
  };
}
