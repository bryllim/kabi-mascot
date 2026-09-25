// Kabi editor: edits the mascot model (rig, keyframes, palette) and recompiles
// the .riv in the browser on every change, previewed with the real Rive runtime.
import { mountRive, inputsOf, containTransform, download, store } from './lib/stage.js';
import { samplePose, sampleTrack } from './lib/sampler.js';
import { buildModel, POSES, MOODS, restValue } from '../src/character/index.js';
import { compileModel, EASINGS } from '../src/riv/compile.js';
import { modelToSvg } from '../src/riv/svg.js';
import { worldTransforms, apply } from '../src/riv/math.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString();
const DIAMOND = '<svg viewBox="0 0 12 12"><path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" fill="currentColor"/></svg>';
const CHANNELS = [['rotation', 'rot°'], ['x', 'x'], ['y', 'y'], ['scaleX', 'scale x'], ['scaleY', 'scale y'], ['opacity', 'opacity']];
const STORE_KEY = 'kabi.editor.model';

// ---- state ------------------------------------------------------------------
const S = {
  model: null,
  tab: store.get('kabi.editor.tab', 'animate'),
  mode: 'anim',
  anim: 'idle',
  time: 0,
  playing: true,
  selected: 'armR',
  key: null, // { target, prop, index }
  onlySelected: false,
  showBones: true,
  bytes: null,
};
let rive = null, riveAnim = null, inputs = {};
const history = [], future = [];

function loadModel() {
  const saved = store.get(STORE_KEY);
  if (saved?.format === 'kabi-model@30') return saved;
  return buildModel();
}
S.model = loadModel();

const nodeById = () => new Map([...S.model.nodes, ...S.model.shapes].map((o) => [o.id, o]));
const anim = () => S.model.animations.find((a) => a.name === S.anim) || S.model.animations[0];
const trackOf = (a, target, prop) => a.tracks.find((t) => t.target === target && t.prop === prop);
const isBone = (n) => n?.type === 'rootBone' || n?.type === 'bone';

/** Animations that share a state-machine layer with `name` (they must key the same properties). */
function layerSiblings(name) {
  for (const sm of S.model.stateMachines || []) {
    for (const layer of sm.layers) {
      const names = new Set();
      for (const st of layer.states) {
        if (st.animation) names.add(st.animation);
        if (st.blend) st.blend.animations.forEach((b) => names.add(b.animation));
      }
      if (names.has(name)) return [...names].filter((n) => n !== name);
    }
  }
  return [];
}

// ---- history / persistence ---------------------------------------------------
function snapshot() { return JSON.stringify(S.model); }
let lastSnap = snapshot();
function commit() {
  const snap = snapshot();
  if (snap === lastSnap) return;
  history.push(lastSnap); if (history.length > 80) history.shift();
  future.length = 0; lastSnap = snap;
  store.set(STORE_KEY, S.model);
  schedulePreview();
  renderAll();
}
function undo() {
  if (!history.length) return;
  future.push(lastSnap); lastSnap = history.pop(); S.model = JSON.parse(lastSnap);
  store.set(STORE_KEY, S.model); S.key = null; schedulePreview(); renderAll();
}
function redo() {
  if (!future.length) return;
  history.push(lastSnap); lastSnap = future.pop(); S.model = JSON.parse(lastSnap);
  store.set(STORE_KEY, S.model); S.key = null; schedulePreview(); renderAll();
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---- keyframe editing ----------------------------------------------------------
function snapTime(a, t) { const fps = a.fps || 60; return Math.max(0, Math.min(a.duration, Math.round(t * fps) / fps)); }

function currentValue(target, prop, t = S.time) {
  const a = anim(), tr = trackOf(a, target, prop);
  if (tr) return sampleTrack(tr.keys, t);
  return restValue(nodeById().get(target), prop);
}

function setKey(target, prop, value, t = S.time) {
  const a = anim();
  t = snapTime(a, t);
  let tr = trackOf(a, target, prop);
  if (!tr) {
    tr = { target, prop, keys: [] };
    a.tracks.push(tr);
    // Keep sibling animations in the same layer keyed too, so state switches reset it.
    const rest = restValue(nodeById().get(target), prop);
    for (const sib of layerSiblings(a.name)) {
      const sa = S.model.animations.find((x) => x.name === sib);
      if (sa && !trackOf(sa, target, prop)) sa.tracks.push({ target, prop, keys: [[0, rest, 'hold']], padded: true });
    }
    if (tr.keys.length === 0 && t > 0) tr.keys.push([0, currentValue(target, prop, 0), 'easeInOut']);
  }
  delete tr.padded;
  const i = tr.keys.findIndex((k) => Math.abs(k[0] - t) < 1e-4);
  if (i >= 0) tr.keys[i][1] = value;
  else tr.keys.push([t, value, 'easeInOut']);
  tr.keys.sort((p, q) => p[0] - q[0]);
  S.key = { target, prop, index: tr.keys.findIndex((k) => Math.abs(k[0] - t) < 1e-4) };
}

function deleteKey() {
  if (!S.key) return;
  const tr = trackOf(anim(), S.key.target, S.key.prop);
  if (!tr) return;
  if (tr.keys.length <= 1) { toast('A track needs at least one key'); return; }
  tr.keys.splice(S.key.index, 1);
  S.key = null;
  commit();
}

// ---- preview (compile + Rive) ----------------------------------------------------
let previewTimer = 0, mountToken = 0;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 140); }
async function preview() {
  const token = ++mountToken;
  const t0 = performance.now();
  let bytes;
  try { bytes = compileModel(S.model); } catch (e) { setStatus(`⚠ ${e.message}`); console.error(e); return; }
  const ms = performance.now() - t0;
  S.bytes = bytes;
  const canvas = $('#rive');
  const smInputs = rive && S.mode === 'sm' ? Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])) : null;
  const opts = S.mode === 'sm' ? { stateMachine: 'Kabi' } : { animation: anim().name, autoplay: false };
  let r;
  try { r = await mountRive(canvas, bytes, opts); } catch (e) { setStatus('⚠ runtime rejected the file'); console.error(e); return; }
  if (token !== mountToken) { r.cleanup(); return; }
  rive?.cleanup();
  rive = r; riveAnim = S.mode === 'anim' ? anim().name : null;
  inputs = S.mode === 'sm' ? inputsOf(r) : {};
  if (smInputs) for (const [k, v] of Object.entries(smInputs)) if (inputs[k] && typeof v !== 'undefined' && inputs[k].type !== 58) inputs[k].value = v;
  if (S.mode === 'anim') r.scrub(riveAnim, S.time);
  setStatus(`${(bytes.length / 1024).toFixed(1)} KB .riv · compiled in ${ms.toFixed(0)} ms`);
  renderSmBar();
}
function setStatus(s) { $('#status').textContent = s; }

// ---- main loop: playhead, scrubbing, overlay ------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000; last = now;
  if (S.mode === 'anim') {
    const a = anim();
    if (S.playing && !drag) {
      S.time += dt * (a.speed || 1);
      if (S.time > a.duration) S.time = a.loop === 'oneShot' ? 0 : S.time % a.duration;
      updatePlayhead();
    }
    if (rive && riveAnim === a.name) rive.scrub(riveAnim, S.time);
  }
  drawOverlay();
  requestAnimationFrame(frame);
}

// Overlay: skeleton of the current pose + selection.
const overlay = $('#overlay');
function viewTransform() {
  const rect = overlay.getBoundingClientRect();
  const { s, ox, oy } = containTransform(rect.width, rect.height, S.model.artboard.width, S.model.artboard.height);
  return { rect, s, ox, oy };
}
function currentWorld() {
  if (S.mode !== 'anim') return worldTransforms(S.model);
  const pose = samplePose(anim(), S.time);
  return worldTransforms(S.model, (id) => pose[id]);
}
function drawOverlay() {
  const dpr = devicePixelRatio || 1;
  const { rect, s, ox, oy } = viewTransform();
  if (overlay.width !== Math.round(rect.width * dpr) || overlay.height !== Math.round(rect.height * dpr)) {
    overlay.width = Math.round(rect.width * dpr); overlay.height = Math.round(rect.height * dpr);
  }
  const g = overlay.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, overlay.width, overlay.height);
  if (!S.showBones || S.mode !== 'anim') return;
  g.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  const W = currentWorld();
  const px = 1 / s;
  // Monochrome overlay: selection is bright white with a dark rim so it reads
  // on the black body and on light backgrounds alike.
  const accent = '#ffffff', rim = '#1d1d1f';
  for (const n of S.model.nodes) {
    const { m } = W.get(n.id);
    const sel = n.id === S.selected;
    if (isBone(n)) {
      const [ax, ay] = [m[4], m[5]], [bx, by] = apply(m, n.length, 0);
      const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len;
      const w = Math.min(len * 0.12, 9 * px);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax + (bx - ax) * 0.2 + nx * w, ay + (by - ay) * 0.2 + ny * w);
      g.lineTo(bx, by);
      g.lineTo(ax + (bx - ax) * 0.2 - nx * w, ay + (by - ay) * 0.2 - ny * w);
      g.closePath();
      g.fillStyle = sel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)';
      g.strokeStyle = sel ? rim : 'rgba(20,18,22,0.6)';
      g.lineWidth = 1.5 * px;
      g.fill(); g.stroke();
      g.beginPath(); g.arc(ax, ay, 4 * px, 0, Math.PI * 2);
      g.fillStyle = '#fff'; g.fill(); g.stroke();
    } else if (!isHelperNode(n)) {
      g.beginPath(); g.arc(m[4], m[5], (sel ? 6 : 4) * px, 0, Math.PI * 2);
      g.fillStyle = sel ? accent : 'rgba(255,255,255,0.9)';
      g.strokeStyle = sel ? rim : 'rgba(20,18,22,0.8)';
      g.lineWidth = 1.5 * px; g.fill(); g.stroke();
      if (sel) {
        g.beginPath(); g.arc(m[4], m[5], 22 * px, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.setLineDash([4 * px, 4 * px]); g.stroke(); g.setLineDash([]);
      }
    }
  }
}
// Face-detail groups crowd the overlay; they stay selectable from the Rig tree.
const HELPERS = new Set(['eyeOpenL', 'eyeOpenR', 'pupilL', 'pupilR', 'tailTip', 'handL', 'handR', 'dumbbellL', 'dumbbellR', 'sweat', 'zzz', 'sparkles']);
const isHelperNode = (n) => HELPERS.has(n.id);

// ---- overlay interaction: select + drag to pose ------------------------------------
let drag = null;
function toArtboard(e) {
  const { rect, s, ox, oy } = viewTransform();
  return [(e.clientX - rect.left - ox) / s, (e.clientY - rect.top - oy) / s];
}
function hitTest(p) {
  const W = currentWorld();
  const { s } = viewTransform();
  let best = null, bestD = 14 / s;
  for (const n of S.model.nodes) {
    if (!isBone(n) && isHelperNode(n)) continue;
    const { m } = W.get(n.id);
    let d;
    if (isBone(n)) {
      const [ax, ay] = [m[4], m[5]], [bx, by] = apply(m, n.length, 0);
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
      d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)) + 2 / s;
    } else d = Math.hypot(p[0] - m[4], p[1] - m[5]);
    if (d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}
overlay.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'anim' || !S.showBones) return;
  const p = toArtboard(e);
  const hit = hitTest(p);
  if (!hit) return;
  S.selected = hit; S.key = null;
  const n = nodeById().get(hit);
  const W = currentWorld();
  const m = W.get(hit).m;
  // Drag rotates around the joint; with Shift (non-bones) it translates.
  const translate = e.shiftKey && !isBone(n);
  drag = {
    id: hit, translate, start: p, pivot: [m[4], m[5]],
    startAngle: Math.atan2(p[1] - m[5], p[0] - m[4]),
    rot0: currentValue(hit, 'rotation'), x0: currentValue(hit, 'x'), y0: currentValue(hit, 'y'),
    parentInv: parentInverse(hit, W), moved: false,
  };
  S.playing = false;
  overlay.setPointerCapture(e.pointerId);
  renderAll();
});
function parentInverse(id, W) {
  const n = nodeById().get(id);
  if (!n.parent) return null;
  const m = W.get(n.parent).m;
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}
overlay.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (S.mode === 'anim' && S.showBones) overlay.style.cursor = hitTest(toArtboard(e)) ? 'grab' : 'default';
    return;
  }
  const p = toArtboard(e);
  drag.moved = true;
  if (drag.translate) {
    const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    const inv = drag.parentInv || [1, 0, 0, 1];
    setKey(drag.id, 'x', +(drag.x0 + inv[0] * dx + inv[2] * dy).toFixed(2));
    setKey(drag.id, 'y', +(drag.y0 + inv[1] * dx + inv[3] * dy).toFixed(2));
  } else {
    const a = Math.atan2(p[1] - drag.pivot[1], p[0] - drag.pivot[0]);
    let delta = ((a - drag.startAngle) * 180) / Math.PI;
    if (e.altKey) delta = Math.round(delta / 5) * 5;
    setKey(drag.id, 'rotation', +(drag.rot0 + delta).toFixed(2));
  }
  overlay.style.cursor = 'grabbing';
  renderTimeline(); renderPanel();
});
overlay.addEventListener('pointerup', () => {
  if (!drag) return;
  const moved = drag.moved; drag = null;
  overlay.style.cursor = 'grab';
  if (moved) commit(); else renderAll();
});

// ---- panels ---------------------------------------------------------------------------
function renderAll() { renderTabs(); renderPanel(); renderTimeline(); renderHint(); }
function renderTabs() {
  document.querySelectorAll('.side-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
  $('#undo').disabled = !history.length; $('#redo').disabled = !future.length;
}
function renderHint() {
  $('#hint').innerHTML = S.mode === 'anim'
    ? 'Drag a bone to pose it at the playhead · <span class="kbd">Shift</span>-drag a group to move it · <span class="kbd">Alt</span> snaps to 5° · <span class="kbd">Space</span> play/pause'
    : 'Live state machine — drive the inputs below';
}

function renderPanel() {
  const panel = $('#panel');
  panel.innerHTML = '';
  if (S.tab === 'animate') panel.append(animatePanel());
  if (S.tab === 'rig') panel.append(rigPanel());
  if (S.tab === 'colors') panel.append(colorsPanel());
  if (S.tab === 'states') panel.append(statesPanel());
}

function groupedAnimations() {
  const groups = [['Poses (pose input)', []], ['One-shots (triggers)', []], ['Faces (mood input)', []], ['Ambient + blink', []], ['Gear + gaze', []]];
  for (const a of S.model.animations) {
    const i = POSES.includes(a.name) ? 0 : ['hop', 'hi', 'poke'].includes(a.name) ? 1 : a.name.startsWith('face_') ? 2
      : ['ambient', 'blink'].includes(a.name) ? 3 : 4;
    groups[i][1].push(a);
  }
  return groups;
}

function animatePanel() {
  const a = anim();
  const root = h('<div></div>');
  // Selected node channels
  const n = nodeById().get(S.selected);
  const sel = h(`<div class="section"><h3>${esc(S.selected)} <small>${isBone(n) ? 'bone' : n && S.model.shapes.includes(n) ? 'shape' : 'group'} · at ${fmt(S.time)}s</small></h3></div>`);
  for (const [prop, label] of CHANNELS) {
    if (isBone(n) && n.type === 'bone' && (prop === 'x' || prop === 'y')) continue;
    const tr = trackOf(a, S.selected, prop);
    const onKey = tr && tr.keys.some((k) => Math.abs(k[0] - snapTime(a, S.time)) < 1e-4);
    const v = currentValue(S.selected, prop);
    const row = h(`<div class="field"><label>${label}</label><div class="row">
      <input type="number" step="${prop.startsWith('scale') || prop === 'opacity' ? 0.01 : 0.5}" value="${fmt(v, 3)}" />
      <button class="keybtn ${onKey ? 'on' : tr && !tr.padded ? 'has' : ''}" title="${onKey ? 'Remove key at playhead' : 'Add key at playhead'}">${DIAMOND}</button></div></div>`);
    $('input', row).onchange = (e) => { S.playing = false; setKey(S.selected, prop, +e.target.value); commit(); };
    $('button', row).onclick = () => {
      S.playing = false;
      if (onKey) { S.key = { target: S.selected, prop, index: tr.keys.findIndex((k) => Math.abs(k[0] - snapTime(a, S.time)) < 1e-4) }; deleteKey(); }
      else { setKey(S.selected, prop, +v.toFixed(3)); commit(); }
    };
    sel.append(row);
  }
  root.append(sel);

  // Selected keyframe
  if (S.key) {
    const tr = trackOf(a, S.key.target, S.key.prop);
    const k = tr?.keys[S.key.index];
    if (k) {
      const sec = h(`<div class="section"><h3>Keyframe <small>${esc(S.key.target)}.${S.key.prop}</small></h3></div>`);
      const time = h(`<div class="field"><label>time (s)</label><input type="number" step="${(1 / (a.fps || 60)).toFixed(4)}" min="0" max="${a.duration}" value="${fmt(k[0], 3)}"/></div>`);
      $('input', time).onchange = (e) => {
        k[0] = snapTime(a, +e.target.value); tr.keys.sort((p, q) => p[0] - q[0]); S.key.index = tr.keys.indexOf(k); commit();
      };
      const val = h(`<div class="field"><label>value</label><input type="number" step="0.01" value="${fmt(k[1], 3)}"/></div>`);
      $('input', val).onchange = (e) => { k[1] = +e.target.value; commit(); };
      const eases = ['hold', 'linear', ...Object.keys(EASINGS).filter((x) => EASINGS[x])];
      const ease = h(`<div class="field"><label>ease out</label><select>${eases.map((x) => `<option ${x === (k[2] || 'easeInOut') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`);
      $('select', ease).onchange = (e) => { k[2] = e.target.value; commit(); };
      const del = h('<div style="margin-top:8px"><button class="btn sm">Delete key</button> <span class="note">or press <span class="kbd">⌫</span></span></div>');
      $('button', del).onclick = deleteKey;
      sec.append(time, val, ease, del);
      root.append(sec);
    }
  }

  // Animation settings
  const set = h(`<div class="section"><h3>Animation <small>${a.tracks.length} tracks</small></h3></div>`);
  const dur = h(`<div class="field"><label>duration (s)</label><input type="number" step="0.05" min="0.05" value="${a.duration}"/></div>`);
  $('input', dur).onchange = (e) => { a.duration = Math.max(0.05, +e.target.value); commit(); };
  const speed = h(`<div class="field"><label>speed</label><input type="number" step="0.05" min="0.05" value="${a.speed ?? 1}"/></div>`);
  $('input', speed).onchange = (e) => { a.speed = Math.max(0.05, +e.target.value); commit(); };
  const loop = h(`<div class="field"><label>loop</label><select>${['loop', 'oneShot', 'pingPong'].map((x) => `<option ${x === a.loop ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`);
  $('select', loop).onchange = (e) => { a.loop = e.target.value; commit(); };
  set.append(dur, speed, loop);
  root.append(set);

  // Animation list
  const listSec = h('<div class="section"><h3>Animations</h3></div>');
  for (const [label, items] of groupedAnimations()) {
    if (!items.length) continue;
    listSec.append(h(`<div class="group-label">${label}</div>`));
    const list = h('<div class="list"></div>');
    for (const it of items) {
      const b = h(`<button aria-selected="${it.name === S.anim}">${esc(it.name)}<span class="meta">${it.duration}s</span></button>`);
      b.onclick = () => selectAnimation(it.name);
      list.append(b);
    }
    listSec.append(list);
  }
  root.append(listSec);
  return root;
}

function selectAnimation(name) {
  S.anim = name; S.time = 0; S.key = null; S.mode = 'anim'; S.playing = true;
  // pick a sensible node to show
  const a = anim();
  if (!a.tracks.some((t) => t.target === S.selected && !t.padded)) {
    const first = a.tracks.find((t) => !t.padded);
    if (first) S.selected = first.target;
  }
  schedulePreview(); renderAll();
}

function rigPanel() {
  const root = h('<div></div>');
  const n = nodeById().get(S.selected);
  if (n) {
    const kind = isBone(n) ? (n.type === 'rootBone' ? 'root bone' : 'bone') : S.model.shapes.includes(n) ? 'shape' : 'group';
    const sec = h(`<div class="section"><h3>${esc(n.id)} <small>${kind} · rest pose</small></h3></div>`);
    const fields = [['x', 'x'], ['y', 'y'], ['rotation', 'rotation°'], ['scaleX', 'scale x'], ['scaleY', 'scale y'], ['opacity', 'opacity']];
    if (isBone(n)) fields.push(['length', 'length']);
    for (const [prop, label] of fields) {
      if (n.type === 'bone' && (prop === 'x' || prop === 'y')) continue;
      const v = prop === 'length' ? n.length : restValue(n, prop);
      const row = h(`<div class="field"><label>${label}</label><input type="number" step="${prop.startsWith('scale') || prop === 'opacity' ? 0.01 : 0.5}" value="${fmt(v, 3)}"/></div>`);
      $('input', row).onchange = (e) => { n[prop] = +e.target.value; commit(); };
      sec.append(row);
    }
    if (n.skin) sec.append(h(`<p class="note">Skinned to ${n.skin.map(esc).join(', ')} — weights are recomputed from the bind pose on every compile.</p>`));
    if (isBone(n)) {
      const skinned = S.model.shapes.filter((s) => s.skin?.includes(n.id)).map((s) => s.id);
      sec.append(h(`<p class="note">Deforms: ${skinned.length ? skinned.map(esc).join(', ') : 'nothing directly'}. Changing a bone's rest pose re-binds the skin, so artwork stays put.</p>`));
    }
    root.append(sec);
  }
  const treeSec = h(`<div class="section"><h3>Hierarchy <small>${S.model.nodes.filter(isBone).length} bones · ${S.model.nodes.length - S.model.nodes.filter(isBone).length} groups · ${S.model.shapes.length} shapes</small></h3></div>`);
  const kids = new Map();
  for (const o of [...S.model.nodes, ...S.model.shapes]) {
    const p = o.parent || '';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(o);
  }
  const tree = h('<div class="list tree"></div>');
  const walk = (parent, depth) => {
    for (const o of kids.get(parent) || []) {
      const shape = S.model.shapes.includes(o);
      const ico = isBone(o) ? '◆' : shape ? (o.skin ? '≈' : '▪') : '○';
      const b = h(`<button class="${isBone(o) ? 'bone' : ''}" style="padding-left:${8 + depth * 14}px" aria-selected="${o.id === S.selected}"><span class="ico">${ico}</span>${esc(o.id)}</button>`);
      b.onclick = () => { S.selected = o.id; renderAll(); };
      tree.append(b);
      walk(o.id, depth + 1);
    }
  };
  walk('', 0);
  treeSec.append(tree, h('<p class="note">◆ bone · ○ group · ▪ shape · ≈ skinned shape</p>'));
  root.append(treeSec);
  return root;
}

function colorsPanel() {
  const sec = h('<div class="section"><h3>Palette <small>applies everywhere</small></h3></div>');
  for (const [name, value] of Object.entries(S.model.palette)) {
    const hex = value.slice(0, 7), alpha = value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1;
    const row = h(`<div class="swatch-row"><input type="color" value="${hex}" aria-label="${esc(name)}"/><span>${esc(name)}</span>
      <input type="range" min="0" max="1" step="0.01" value="${alpha}" title="opacity" aria-label="${esc(name)} opacity"/></div>`);
    const update = () => {
      const c = $('input[type=color]', row).value, a = +$('input[type=range]', row).value;
      S.model.palette[name] = a >= 0.999 ? c : c + Math.round(a * 255).toString(16).padStart(2, '0');
    };
    $('input[type=color]', row).oninput = () => { update(); schedulePreview(); };
    $('input[type=color]', row).onchange = () => { update(); commit(); };
    $('input[type=range]', row).onchange = () => { update(); commit(); };
    sec.append(row);
  }
  const presets = h('<div class="section"><h3>Quick themes</h3><div class="chips"></div></div>');
  const THEMES = {
    'Original': { body: '#1f1e20', belly: '#535256', horn: '#f0e7dc', accent: '#ff5a2e' },
    'Carabao': { body: '#3b3f4a', belly: '#6c7382', horn: '#efe6d6', accent: '#2f9e6f' },
    'Golden': { body: '#6b4423', belly: '#b07a45', horn: '#fff3dc', accent: '#ffb000' },
    'Arctic': { body: '#e9edf2', belly: '#c7d2de', horn: '#6f7d8c', accent: '#2d7ff9' },
  };
  for (const [name, t] of Object.entries(THEMES)) {
    const b = h(`<button class="chip">${name}</button>`);
    b.onclick = () => { Object.assign(S.model.palette, t); commit(); };
    $('.chips', presets).append(b);
  }
  const root = h('<div></div>'); root.append(sec, presets);
  return root;
}

function statesPanel() {
  const sm = S.model.stateMachines[0];
  const root = h('<div></div>');
  const sec = h(`<div class="section"><h3>${esc(sm.name)} <small>${sm.layers.length} layers</small></h3></div>`);
  const tbl = h('<table class="kv"></table>');
  for (const i of S.model.meta?.inputs || sm.inputs) tbl.append(h(`<tr><td>${esc(i.name)}</td><td>${i.type}</td><td>${esc(i.description || '')}</td></tr>`));
  sec.append(tbl);
  root.append(sec);
  for (const layer of sm.layers) {
    const ls = h(`<div class="section"><h3>${esc(layer.name)} <small>${layer.states.length} states · ${(layer.transitions || []).length} transitions</small></h3></div>`);
    const list = h('<div class="list"></div>');
    for (const st of layer.states) {
      const an = st.animation || st.blend.animations.map((b) => b.animation).join(' ↔ ');
      const b = h(`<button>${esc(st.name)}<span class="meta">${esc(an)}</span></button>`);
      b.onclick = () => selectAnimation(st.animation || st.blend.animations[0].animation);
      list.append(b);
    }
    ls.append(list);
    const durs = [...new Set((layer.transitions || []).map((t) => t.duration))];
    if (durs.length) {
      const f = h(`<div class="field" style="margin-top:6px"><label>mix (ms)</label><input type="number" min="0" step="10" value="${durs[0]}"/></div>`);
      $('input', f).onchange = (e) => { for (const t of layer.transitions) if (!t.exitTime) t.duration = +e.target.value; commit(); };
      ls.append(f);
    }
    root.append(ls);
  }
  root.append(h('<div class="section"><p class="note" style="margin:0">Switch the preview to <b>State machine</b> (top-left of the stage) to drive these inputs live.</p></div>'));
  return root;
}

// ---- state machine test bar ------------------------------------------------------------
function renderSmBar() {
  const bar = $('#smbar');
  bar.hidden = S.mode !== 'sm';
  if (S.mode !== 'sm' || !inputs.pose) return;
  bar.innerHTML = '';
  const sel = (name, labels) => {
    const s = h(`<select aria-label="${name}">${labels.map((l, i) => `<option value="${i}" ${inputs[name].value === i ? 'selected' : ''}>${name}: ${l}</option>`).join('')}</select>`);
    s.onchange = (e) => { inputs[name].value = +e.target.value; };
    return s;
  };
  bar.append(sel('pose', POSES), sel('mood', MOODS), sel('color', S.model.meta?.skins || ['black']));
  for (const b of ['glasses', 'shirt', 'headOnly']) {
    const t = h(`<label class="toggle"><span>${b}</span><input type="checkbox" ${inputs[b].value ? 'checked' : ''}/></label>`);
    $('input', t).onchange = (e) => { inputs[b].value = e.target.checked; };
    bar.append(t);
  }
  for (const tr of ['jump', 'hi', 'poke']) {
    const b = h(`<button class="btn sm">${tr}</button>`);
    b.onclick = () => inputs[tr].fire();
    bar.append(b);
  }
}

// ---- timeline ------------------------------------------------------------------------------
const PX_PER_SEC = () => Math.max(180, Math.min(420, ($('#timeline').clientWidth - 220) / Math.max(anim().duration, 0.5)));
function renderTimeline() {
  const tl = $('#timeline');
  const a = anim();
  const pps = PX_PER_SEC();
  const width = Math.ceil(a.duration * pps) + 40;
  tl.innerHTML = '';
  const bar = h(`<div class="tl-bar">
    <button class="btn sm" id="play">${S.playing && S.mode === 'anim' ? 'Pause' : 'Play'}</button>
    <span class="name">${esc(a.name)}</span>
    <span class="time" id="tlTime"></span>
    <div class="spacer"></div>
    <label class="toggle" style="gap:6px;font-size:12px"><span>Selected only</span><input type="checkbox" id="onlySel" ${S.onlySelected ? 'checked' : ''}/></label>
  </div>`);
  $('#play', bar).onclick = () => { if (S.mode !== 'anim') { S.mode = 'anim'; schedulePreview(); } S.playing = !S.playing; renderAll(); };
  $('#onlySel', bar).onchange = (e) => { S.onlySelected = e.target.checked; renderTimeline(); };
  tl.append(bar);

  const body = h('<div class="tl-body"></div>');
  const grid = h(`<div class="tl-grid" style="width:${190 + width}px"></div>`);
  const ruler = h(`<div class="tl-ruler" style="width:${width}px"></div>`);
  const step = a.duration > 3 ? 0.5 : a.duration > 1.2 ? 0.25 : 0.1;
  for (let t = 0; t <= a.duration + 1e-6; t += step) ruler.append(h(`<span class="tick" style="left:${t * pps}px">${fmt(t)}</span>`));
  grid.append(h('<div class="tl-head tl-label" style="z-index:5">track</div>'));
  const headWrap = h('<div class="tl-head"></div>'); headWrap.append(ruler); grid.append(headWrap);

  const scrubAt = (e) => {
    const r = ruler.getBoundingClientRect();
    S.time = snapTime(a, (e.clientX - r.left) / pps);
    S.playing = false; updatePlayhead(); renderPanel();
  };
  ruler.onpointerdown = (e) => {
    ruler.setPointerCapture(e.pointerId); scrubAt(e);
    ruler.onpointermove = scrubAt;
    ruler.onpointerup = () => { ruler.onpointermove = null; renderTimeline(); };
  };

  const tracks = a.tracks
    .filter((t) => !S.onlySelected || t.target === S.selected)
    .sort((p, q) => (p.padded - q.padded) || p.target.localeCompare(q.target) || p.prop.localeCompare(q.prop));
  if (!tracks.length) body.append(h('<div class="tl-empty">No tracks for this selection — drag a bone on the stage or use ◆ in the side panel to add a key.</div>'));
  for (const tr of tracks) {
    const selRow = tr.target === S.selected;
    const label = h(`<div class="tl-label ${selRow ? 'sel' : ''}">${esc(tr.target)}.<b>${tr.prop}</b>${tr.padded ? ' <span class="pad">(hold)</span>' : ''}</div>`);
    label.onclick = () => { S.selected = tr.target; renderAll(); };
    const row = h(`<div class="tl-row ${selRow ? 'sel' : ''}" style="width:${width}px"></div>`);
    tr.keys.forEach((k, i) => {
      const isSel = S.key && S.key.target === tr.target && S.key.prop === tr.prop && S.key.index === i;
      const d = h(`<button class="tl-key ${k[2] === 'hold' ? 'hold' : ''} ${isSel ? 'sel' : ''}" style="left:${k[0] * pps}px" title="${fmt(k[0], 3)}s = ${fmt(+k[1] || 0, 3)} (${k[2] || 'easeInOut'})"></button>`);
      d.onpointerdown = (e) => {
        e.stopPropagation();
        S.selected = tr.target; S.key = { target: tr.target, prop: tr.prop, index: i };
        S.time = k[0]; S.playing = false;
        const startX = e.clientX, t0 = k[0];
        let moved = false;
        d.setPointerCapture(e.pointerId);
        d.onpointermove = (ev) => {
          const nt = snapTime(a, t0 + (ev.clientX - startX) / pps);
          if (nt !== k[0]) { k[0] = nt; moved = true; d.style.left = `${nt * pps}px`; S.time = nt; updatePlayhead(); }
        };
        d.onpointerup = () => {
          d.onpointermove = null;
          if (moved) { tr.keys.sort((p, q) => p[0] - q[0]); S.key.index = tr.keys.indexOf(k); commit(); } else renderAll();
        };
      };
      row.append(d);
    });
    grid.append(label, row);
  }
  body.append(grid);
  const ph = h('<div class="tl-playhead" id="playhead"></div>');
  body.append(ph);
  tl.append(body);
  updatePlayhead();
}
function updatePlayhead() {
  const ph = $('#playhead'); if (!ph) return;
  ph.style.left = `${190 + S.time * PX_PER_SEC()}px`;
  const t = $('#tlTime'); if (t) t.textContent = `${S.time.toFixed(2)}s / ${anim().duration}s`;
}

// ---- wiring ---------------------------------------------------------------------------------
document.querySelectorAll('.side-tabs button').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; store.set('kabi.editor.tab', S.tab); renderAll(); }));
document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
  if (S.mode === b.dataset.mode) return;
  S.mode = b.dataset.mode; S.playing = true; schedulePreview(); renderAll();
}));
document.querySelectorAll('.swatch').forEach((s) => (s.onclick = () => {
  $('#stage').dataset.bg = s.dataset.bg;
  document.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === s)));
}));
$('#showBones').onchange = (e) => { S.showBones = e.target.checked; };
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#reset').onclick = () => {
  if (!confirm('Discard all edits and rebuild Kabi from source?')) return;
  S.model = buildModel(); S.key = null; commit(); toast('Reset to source');
};
$('#exportRiv').onclick = () => { if (S.bytes) download('kabi.riv', S.bytes); };
$('#exportJson').onclick = () => download('kabi.model.json', JSON.stringify(S.model, null, 1), 'application/json');
$('#exportSvg').onclick = () => download('kabi.svg', modelToSvg(S.model), 'image/svg+xml');
$('#import').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const m = JSON.parse(await f.text());
    if (m.format !== 'kabi-model@30') throw new Error('not a Kabi model');
    compileModel(m);
    S.model = m; S.key = null; commit(); toast('Model imported');
  } catch (err) { toast(`Import failed: ${err.message}`); }
  e.target.value = '';
};
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (e.key === ' ') { e.preventDefault(); if (S.mode === 'anim') { S.playing = !S.playing; renderTimeline(); } }
  else if ((e.key === 'Backspace' || e.key === 'Delete') && S.key) { e.preventDefault(); deleteKey(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const a = anim(); S.playing = false;
    S.time = snapTime(a, S.time + (e.key === 'ArrowRight' ? 1 : -1) / (a.fps || 60) * (e.shiftKey ? 10 : 1));
    updatePlayhead(); renderPanel();
  }
});
addEventListener('resize', () => renderTimeline());

// ---- boot -----------------------------------------------------------------------------------
if (!S.model.animations.some((a) => a.name === S.anim)) S.anim = S.model.animations[0].name;
renderAll();
preview();
requestAnimationFrame(frame);
