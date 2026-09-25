// Compiles a mascot model (plain JSON, see src/character/) into a .riv file.
import { writeRiv } from './writer.js';
import { ANIMATABLE, LOOP, INTERP, TRANSITION_FLAGS, OP } from './schema.js';
import { parsePath, toRiveVertex } from './path.js';
import { worldTransforms, apply } from './math.js';

export const EASINGS = {
  linear: null,
  hold: null,
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  sine: [0.37, 0, 0.63, 1],
  back: [0.34, 1.56, 0.64, 1],
  anticipate: [0.36, 0, 0.66, -0.56],
  snap: [0.2, 0, 0, 1],
};

const DEG = Math.PI / 180;
const CAP = { butt: 0, round: 1, square: 2 };
const JOIN = { miter: 0, round: 1, bevel: 2 };

export function resolveColor(model, c) {
  if (c == null) return null;
  if (typeof c === 'string' && !c.startsWith('#')) {
    const v = model.palette?.[c];
    if (!v) throw new Error(`Unknown palette color "${c}"`);
    return v;
  }
  return c;
}

/** Converts a track value from model units to runtime units. */
export function toRuntimeValue(prop, v) {
  return prop === 'rotation' ? v * DEG : v;
}

export function compileModel(model) {
  const objects = [];
  const push = (type, props) => { objects.push({ type, props }); return objects.length - 1; };

  push('Backboard', {});

  // ---- Artboard components -------------------------------------------------
  const abStart = objects.length; // artboard-local index 0
  const local = (globalIdx) => globalIdx - abStart;
  const ab = model.artboard;
  push('Artboard', {
    name: ab.name || model.name || 'Artboard',
    width: ab.width, height: ab.height, x: 0, y: 0, originX: 0, originY: 0, clip: true,
    defaultStateMachineId: model.stateMachines?.length ? 0 : undefined,
  });

  const seen = new Set();
  for (const o of [...model.nodes, ...model.shapes]) {
    if (seen.has(o.id)) throw new Error(`Duplicate id "${o.id}" (node and shape ids share one namespace)`);
    seen.add(o.id);
  }
  const ids = new Map(); // node/shape id -> artboard-local index
  const fillIds = new Map(); // shape id -> SolidColor local index (for color keys)
  const strokeIds = new Map(); // shape id -> stroke SolidColor index (for strokeColor keys)

  const transformProps = (n) => ({
    x: n.x ?? 0, y: n.y ?? 0,
    rotation: n.rotation ? n.rotation * DEG : undefined,
    scaleX: n.scaleX ?? undefined, scaleY: n.scaleY ?? undefined,
    opacity: n.opacity ?? undefined,
  });
  const parentOf = (p) => {
    if (p == null) return 0;
    if (!ids.has(p)) throw new Error(`Parent "${p}" must be declared before its children`);
    return ids.get(p);
  };

  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) {
    let idx;
    if (n.type === 'rootBone') {
      const { x, y, ...t } = transformProps(n);
      idx = push('RootBone', { name: n.id, parentId: parentOf(n.parent), rootBoneX: x, rootBoneY: y, ...t, length: n.length });
    } else if (n.type === 'bone') {
      const { x, y, ...t } = transformProps(n);
      if (nodeById.get(n.parent)?.type == null) throw new Error(`Bone "${n.id}" must be parented to a bone`);
      idx = push('Bone', { name: n.id, parentId: parentOf(n.parent), ...t, length: n.length });
    } else {
      idx = push('Node', { name: n.id, parentId: parentOf(n.parent), ...transformProps(n) });
    }
    ids.set(n.id, local(idx));
  }
  const bind = model.shapes.some((s) => s.skin) ? worldTransforms(model) : null;

  // Automatic skin weights: inverse-distance to each bone segment in bind pose,
  // so vertices near a joint blend smoothly between the two bones.
  function skinBinding(s) {
    const pathWorld = bind.get(s.id).m;
    const bones = s.skin.map((id) => {
      const b = nodeById.get(id);
      if (!b?.type) throw new Error(`Shape "${s.id}" skins to "${id}", which is not a bone`);
      const m = bind.get(id).m;
      return { id, m, a: [m[4], m[5]], b: apply(m, b.length, 0) };
    });
    const falloff = s.skinFalloff ?? 5;
    const weigh = (lx, ly) => {
      const [px, py] = apply(pathWorld, lx, ly);
      let ws = bones.map((bn, i) => {
        const [ax, ay] = bn.a, [bx, by] = bn.b;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        return { i: i + 1, w: 1 / Math.pow(d + 4, falloff) };
      }).sort((p, q) => q.w - p.w).slice(0, 4);
      const total = ws.reduce((n, x) => n + x.w, 0);
      ws = ws.map((x) => ({ i: x.i, w: Math.round((x.w / total) * 255) })).filter((x) => x.w > 0);
      const drift = 255 - ws.reduce((n, x) => n + x.w, 0);
      ws[0].w += drift;
      let values = 0, indices = 0;
      ws.forEach((x, k) => { values += x.w * 2 ** (8 * k); indices += x.i * 2 ** (8 * k); });
      return [values, indices];
    };
    return { pathWorld, bones, weigh };
  }

  // Rive draws the first drawable on top; the model lists shapes back-to-front.
  const shapes = [...model.shapes].reverse();
  for (const s of shapes) {
    const shapeIdx = local(push('Shape', { name: s.id, parentId: parentOf(s.parent), ...transformProps(s) }));
    ids.set(s.id, shapeIdx);
    if (s.ellipse) {
      push('Ellipse', { name: 'ellipse', parentId: shapeIdx, pathWidth: s.ellipse.w, pathHeight: s.ellipse.h, x: s.ellipse.cx ?? 0, y: s.ellipse.cy ?? 0 });
    }
    if (s.rect) {
      push('Rectangle', { name: 'rect', parentId: shapeIdx, pathWidth: s.rect.w, pathHeight: s.rect.h, x: s.rect.cx ?? 0, y: s.rect.cy ?? 0 });
    }
    if (s.d) {
      const skin = s.skin ? skinBinding(s) : null;
      parsePath(s.d).forEach((c, ci) => {
        const pathIdx = local(push('PointsPath', { name: `path${ci}`, parentId: shapeIdx, x: 0, y: 0, isClosed: c.closed }));
        for (const p of c.points) {
          const v = local(push('CubicDetachedVertex', { parentId: pathIdx, ...toRiveVertex(p) }));
          if (!skin) continue;
          const [values, indices] = skin.weigh(p.x, p.y);
          const [inValues, inIndices] = skin.weigh(p.inX, p.inY);
          const [outValues, outIndices] = skin.weigh(p.outX, p.outY);
          push('CubicWeight', { parentId: v, weightValues: values, weightIndices: indices, inValues, inIndices, outValues, outIndices });
        }
        if (skin) {
          const m = skin.pathWorld;
          const skinIdx = local(push('Skin', { parentId: pathIdx, skinXX: m[0], skinXY: m[1], skinYX: m[2], skinYY: m[3], skinTX: m[4], skinTY: m[5] }));
          for (const b of skin.bones) {
            const bm = b.m;
            push('Tendon', { parentId: skinIdx, boneId: ids.get(b.id), tendonXX: bm[0], tendonXY: bm[1], tendonYX: bm[2], tendonYY: bm[3], tendonTX: bm[4], tendonTY: bm[5] });
          }
        }
      });
    }
    if (s.stroke) {
      const st = s.stroke;
      const strokeIdx = local(push('Stroke', {
        name: 'stroke', parentId: shapeIdx, isVisible: true, thickness: st.width ?? 4,
        cap: CAP[st.cap ?? 'round'], join: JOIN[st.join ?? 'round'], transformAffectsStroke: st.transformAffectsStroke ?? true,
      }));
      const c = local(push('SolidColor', { parentId: strokeIdx, colorValue: resolveColor(model, st.color) }));
      strokeIds.set(s.id, c);
      if (!s.fill) fillIds.set(s.id, c);
    }
    if (s.fill) {
      const fillIdx = local(push('Fill', { name: 'fill', parentId: shapeIdx, isVisible: true, fillRule: s.evenOdd ? 1 : 0 }));
      fillIds.set(s.id, local(push('SolidColor', { parentId: fillIdx, colorValue: resolveColor(model, s.fill) })));
    }
  }

  // Shared easing interpolators live in the artboard's object list.
  const interp = {};
  for (const [name, cp] of Object.entries(EASINGS)) {
    if (!cp) continue;
    interp[name] = local(push('CubicEaseInterpolator', { x1: cp[0], y1: cp[1], x2: cp[2], y2: cp[3] }));
  }

  // ---- Animations ----------------------------------------------------------
  const animIndex = new Map();
  (model.animations || []).forEach((a, ai) => {
    animIndex.set(a.name, ai);
    const fps = a.fps || 60;
    push('LinearAnimation', {
      animationName: a.name, fps, duration: Math.max(1, Math.round(a.duration * fps)),
      speed: a.speed ?? 1, loopValue: LOOP[a.loop || 'loop'],
    });
    // group tracks by target
    const byTarget = new Map();
    for (const t of a.tracks) {
      if (!byTarget.has(t.target)) byTarget.set(t.target, []);
      byTarget.get(t.target).push(t);
    }
    for (const [target, tracks] of byTarget) {
      const isColorTarget = tracks.some((t) => t.prop === 'color');
      const strokeTracks = tracks.filter((t) => t.prop === 'strokeColor');
      if (!ids.has(target)) throw new Error(`Animation "${a.name}" targets unknown object "${target}"`);
      const regular = tracks.filter((t) => t.prop !== 'color' && t.prop !== 'strokeColor');
      if (regular.length) {
        push('KeyedObject', { objectId: ids.get(target) });
        const isRootBone = nodeById.get(target)?.type === 'rootBone';
        for (const t of regular) {
          if (nodeById.get(target)?.type === 'bone' && (t.prop === 'x' || t.prop === 'y')) throw new Error(`Bone "${target}" cannot be translated (it sits on its parent's tip)`);
          const key = isRootBone && t.prop === 'x' ? ANIMATABLE.rootBoneX : isRootBone && t.prop === 'y' ? ANIMATABLE.rootBoneY : ANIMATABLE[t.prop];
          writeTrack(t, key, false);
        }
      }
      if (strokeTracks.length) {
        if (!strokeIds.has(target)) throw new Error(`Animation "${a.name}" keys strokeColor on "${target}", which has no stroke`);
        push('KeyedObject', { objectId: strokeIds.get(target) });
        for (const t of strokeTracks) writeTrack(t, ANIMATABLE.colorValue, true);
      }
      if (isColorTarget) {
        push('KeyedObject', { objectId: fillIds.get(target) });
        for (const t of tracks.filter((t) => t.prop === 'color')) writeTrack(t, ANIMATABLE.colorValue, true);
      }
    }
    function writeTrack(t, propertyKey, isColor) {
      if (propertyKey == null) throw new Error(`Unanimatable prop ${t.prop}`);
      push('KeyedProperty', { propertyKey });
      const keys = [...t.keys].sort((p, q) => p[0] - q[0]);
      for (const [time, value, ease = a.ease || 'easeInOut'] of keys) {
        const interpolationType = ease === 'hold' ? INTERP.hold : ease === 'linear' ? INTERP.linear : INTERP.cubic;
        const base = { frame: Math.round(time * fps), interpolationType, interpolatorId: interpolationType === INTERP.cubic ? interp[ease] : undefined };
        if (interpolationType === INTERP.cubic && base.interpolatorId == null) throw new Error(`Unknown ease ${ease}`);
        if (isColor) push('KeyFrameColor', { ...base, keyColor: resolveColor(model, value) });
        else push('KeyFrameDouble', { ...base, keyValue: toRuntimeValue(t.prop, value) });
      }
    }
  });

  // ---- State machines ------------------------------------------------------
  for (const sm of model.stateMachines || []) {
    push('StateMachine', { animationName: sm.name });
    const inputIndex = new Map();
    sm.inputs.forEach((inp, i) => {
      inputIndex.set(inp.name, i);
      if (inp.type === 'number') push('StateMachineNumber', { smName: inp.name, numberValue: inp.value ?? 0 });
      else if (inp.type === 'bool') push('StateMachineBool', { smName: inp.name, boolValue: !!inp.value });
      else if (inp.type === 'trigger') push('StateMachineTrigger', { smName: inp.name });
      else throw new Error('bad input type ' + inp.type);
    });
    const anim = (name) => {
      if (!animIndex.has(name)) throw new Error(`State references missing animation "${name}"`);
      return animIndex.get(name);
    };
    for (const layer of sm.layers) {
      push('StateMachineLayer', { smName: layer.name });
      // State indices: 0 entry, 1 any, 2 exit, then user states.
      const stateIdx = new Map([['entry', 0], ['any', 1], ['exit', 2]]);
      layer.states.forEach((s, i) => stateIdx.set(s.name, i + 3));
      const stateTo = (n) => {
        if (!stateIdx.has(n)) throw new Error(`Layer ${layer.name}: unknown state ${n}`);
        return stateIdx.get(n);
      };
      const transitionsFrom = (from) => (layer.transitions || []).filter((t) => t.from === from);
      const writeTransition = (t) => {
        let flags = 0;
        if (t.exitTime != null) flags |= TRANSITION_FLAGS.enableExitTime | TRANSITION_FLAGS.exitTimeIsPercentage;
        const easeId = t.ease && t.duration ? interp[t.ease] : undefined;
        push('StateTransition', {
          stateToId: stateTo(t.to), transitionFlags: flags,
          transitionDuration: t.duration ?? 0, exitTime: t.exitTime != null ? Math.round(t.exitTime) : undefined,
          transitionInterpolation: easeId != null ? INTERP.cubic : undefined, transitionInterpolatorId: easeId,
        });
        for (const c of t.conditions || []) {
          const inputId = inputIndex.get(c.input);
          if (inputId == null) throw new Error(`Unknown input ${c.input}`);
          const def = sm.inputs[inputId];
          if (def.type === 'trigger') push('TransitionTriggerCondition', { inputId });
          else if (def.type === 'bool') push('TransitionBoolCondition', { inputId, opValue: c.value ? OP.eq : OP.ne });
          else push('TransitionNumberCondition', { inputId, opValue: OP[c.op || 'eq'], conditionValue: c.value });
        }
      };
      push('EntryState', {});
      writeTransition({ to: layer.entry, duration: 0 });
      push('AnyState', {});
      transitionsFrom('any').forEach(writeTransition);
      push('ExitState', {});
      for (const s of layer.states) {
        if (s.blend) {
          push('BlendState1DInput', { blendInputId: inputIndex.get(s.blend.input) });
          for (const b of s.blend.animations) push('BlendAnimation1D', { blendAnimationId: anim(b.animation), blendValue: b.value });
        } else {
          push('AnimationState', { animationId: anim(s.animation) });
        }
        transitionsFrom(s.name).forEach(writeTransition);
      }
    }
  }

  return writeRiv(objects);
}
