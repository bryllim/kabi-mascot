import { mountRive, inputsOf, autoResize, containTransform, store } from './lib/stage.js';
import { POSES, MOODS, INPUTS, SKINS } from '../src/character/index.js';
import { PALETTE, ARTBOARD } from '../src/character/rig.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const stage = $('#stage');
let r = null;
let inp = {};

const label = (s) => s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

// Workout-app moments: each sets several inputs at once.
const MOMENTS = [
  { name: 'Welcome back', hint: 'idle · happy · says hi', pose: 'idle', mood: 'happy', trigger: 'hi' },
  { name: 'Warm-up', hint: 'stretch · neutral', pose: 'stretch', mood: 'neutral' },
  { name: 'Let’s go', hint: 'ready · determined', pose: 'ready', mood: 'determined' },
  { name: 'Cardio', hint: 'run · determined', pose: 'run', mood: 'determined' },
  { name: 'Leg day', hint: 'barbell squat · determined', pose: 'squat', mood: 'determined' },
  { name: 'Lifting', hint: 'bicep curls · determined', pose: 'curls', mood: 'determined' },
  { name: 'HIIT', hint: 'jumping jacks · happy', pose: 'jumpingJacks', mood: 'happy' },
  { name: 'Push-ups', hint: 'push-ups · determined', pose: 'pushup', mood: 'determined' },
  { name: 'Plank hold', hint: 'plank · tired', pose: 'plank', mood: 'tired' },
  { name: 'Lunges', hint: 'alternating lunges · determined', pose: 'lunge', mood: 'determined' },
  { name: 'Burpees', hint: 'burpee · determined', pose: 'burpee', mood: 'determined' },
  { name: 'Boxing', hint: 'jab-cross · proud', pose: 'boxing', mood: 'proud' },
  { name: 'Jump rope', hint: 'skipping · happy', pose: 'jumpRope', mood: 'happy' },
  { name: 'Sprint', hint: 'high knees · determined', pose: 'highKnees', mood: 'determined' },
  { name: 'Almost there', hint: 'tired · tired, shades off', pose: 'tired', mood: 'tired', glasses: false },
  { name: 'New PR!', hint: 'celebrate · happy', pose: 'celebrate', mood: 'happy', glasses: false },
  { name: 'Strong', hint: 'flex · proud', pose: 'flex', mood: 'proud', glasses: true },
  { name: 'Streak lost', hint: 'idle · sad', pose: 'idle', mood: 'sad', glasses: false },
  { name: 'Rest day', hint: 'sleep · sleepy', pose: 'sleep', mood: 'sleepy', glasses: false },
  { name: 'Coach mode', hint: 'hands on hips · proud', pose: 'handsOnHips', mood: 'proud' },
  { name: 'Let me explain', hint: 'present left · happy', pose: 'presentLeft', mood: 'happy', glasses: false },
  { name: 'Your plan', hint: 'present right · happy', pose: 'presentRight', mood: 'happy', glasses: false },
  { name: 'Planning', hint: 'thinking · neutral, shades off', pose: 'thinking', mood: 'neutral', glasses: false },
  { name: 'Skipped a day?', hint: 'shrug · surprised, shades off', pose: 'shrug', mood: 'surprised', glasses: false },
  { name: 'Nice work', hint: 'clap · happy', pose: 'clap', mood: 'happy', glasses: false },
  { name: 'Goal hit!', hint: 'fist pump · proud', pose: 'fistPump', mood: 'proud' },
  { name: 'Thanks', hint: 'hand on heart · happy', pose: 'heart', mood: 'happy', glasses: false },
  { name: 'Check-in', hint: 'listen · neutral, shades off', pose: 'listen', mood: 'neutral', glasses: false },
  { name: 'No excuses', hint: 'crossed arms · determined', pose: 'crossedArms', mood: 'determined' },
  { name: 'Whoa!', hint: 'idle · surprised · poke', pose: 'idle', mood: 'surprised', glasses: false, trigger: 'poke' },
  { name: 'Hop to it', hint: 'ready · happy · jump', pose: 'ready', mood: 'happy', trigger: 'jump' },
  { name: 'Low energy', hint: 'idle · tired, shades off', pose: 'idle', mood: 'tired', glasses: false },
];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1400);
}

function set(name, value) {
  if (!inp[name]) return;
  inp[name].value = value;
  sync();
}
function fire(name) { inp[name]?.fire(); }

function sync() {
  if (!r) return;
  const pose = inp.pose.value, mood = inp.mood.value;
  document.querySelectorAll('#poses .chip').forEach((b, i) => b.setAttribute('aria-pressed', String(i === pose)));
  document.querySelectorAll('#moods .chip').forEach((b, i) => b.setAttribute('aria-pressed', String(i === mood)));
  document.querySelectorAll('#colors .color').forEach((b, i) => b.setAttribute('aria-pressed', String(i === inp.color.value)));
  $('#glasses').checked = inp.glasses.value;
  $('#headOnly').checked = inp.headOnly.value;
  $('#shirt').checked = inp.shirt.value;
  $('#readout').textContent = `pose ${pose} · ${POSES[pose]}   mood ${mood} · ${MOODS[mood]}`;
  store.set('kabi.viewer', { pose, mood, color: inp.color.value, glasses: inp.glasses.value, headOnly: inp.headOnly.value, shirt: inp.shirt.value });
}

function buildControls() {
  $('#poses').append(...POSES.map((p, i) => chip(`<span class="n">${i}</span>${label(p)}`, () => { set('pose', i); markMoment(null); })));
  $('#moods').append(...MOODS.map((m, i) => chip(`<span class="n">${i}</span>${label(m)}`, () => { set('mood', i); markMoment(null); })));
  $('#moments').append(...MOMENTS.map((m) => {
    const b = document.createElement('button');
    b.className = 'moment'; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<b>${m.name}</b><span>${m.hint}</span>`;
    b.onclick = () => applyMoment(m, b);
    return b;
  }));
  $('#colors').append(...SKINS.map((c, i) => {
    const b = document.createElement('button');
    b.className = 'color'; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<i style="background:${c.body.startsWith('#') ? c.body : PALETTE[c.body]}"></i>${label(c.name)}`;
    b.onclick = () => set('color', i);
    return b;
  }));
  document.querySelectorAll('[data-trigger]').forEach((b) => (b.onclick = () => fire(b.dataset.trigger)));
  $('#glasses').onchange = (e) => set('glasses', e.target.checked);
  $('#headOnly').onchange = (e) => set('headOnly', e.target.checked);
  $('#shirt').onchange = (e) => set('shirt', e.target.checked);
  for (const axis of ['lookX', 'lookY']) {
    $(`#${axis}`).oninput = (e) => { $('#follow').checked = false; gaze[axis] = +e.target.value; target[axis] = +e.target.value; };
  }
  document.querySelectorAll('.swatch').forEach((s) => (s.onclick = () => {
    stage.dataset.bg = s.dataset.bg;
    document.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === s)));
    store.set('kabi.bg', s.dataset.bg);
  }));
  const bg = store.get('kabi.bg');
  if (bg) document.querySelector(`.swatch[data-bg="${bg}"]`)?.click();

  $('#inputs').innerHTML = INPUTS.map((i) => `<tr><td>${i.name}</td><td>${i.type}</td><td>${i.description}</td></tr>`).join('');
  buildCode();
}

function chip(html, onclick) {
  const b = document.createElement('button');
  b.className = 'chip'; b.innerHTML = html; b.onclick = onclick; b.setAttribute('aria-pressed', 'false');
  return b;
}
function markMoment(el) { document.querySelectorAll('.moment').forEach((m) => m.setAttribute('aria-pressed', String(m === el))); }
function applyMoment(m, el) {
  set('pose', POSES.indexOf(m.pose));
  set('mood', MOODS.indexOf(m.mood));
  set('glasses', m.glasses ?? true);
  if (m.trigger) setTimeout(() => fire(m.trigger), 350);
  markMoment(el);
}

// ---- gaze: follow the pointer, ease back to center -------------------------
const gaze = { lookX: 0, lookY: 0 }, target = { lookX: 0, lookY: 0 };
stage.addEventListener('pointermove', (e) => {
  if (!$('#follow').checked) return;
  const rect = canvas.getBoundingClientRect();
  const { s, ox, oy } = containTransform(rect.width, rect.height, ARTBOARD.width, ARTBOARD.height);
  const headX = ox + 500 * s, headY = oy + (inp.headOnly?.value ? 600 : 420) * s;
  target.lookX = Math.max(-100, Math.min(100, ((e.clientX - rect.left - headX) / (220 * s)) * 100));
  target.lookY = Math.max(-100, Math.min(100, ((e.clientY - rect.top - headY) / (220 * s)) * 100));
});
stage.addEventListener('pointerleave', () => { if ($('#follow').checked) target.lookX = target.lookY = 0; });
canvas.addEventListener('click', () => fire('poke'));
(function tick() {
  if (r) {
    for (const k of ['lookX', 'lookY']) {
      gaze[k] += (target[k] - gaze[k]) * 0.12;
      if (inp[k]) inp[k].value = Math.round(gaze[k] * 10) / 10;
      $(`#${k}`).value = gaze[k]; $(`#${k}v`).textContent = Math.round(gaze[k]);
    }
  }
  requestAnimationFrame(tick);
})();

// ---- integration snippets ------------------------------------------------------
const SNIPPETS = {
  Web: `import { Rive } from '@rive-app/canvas';

const kabi = new Rive({
  src: 'kabi.riv',
  canvas: document.querySelector('canvas'),
  stateMachines: 'Kabi',
  autoplay: true,
  onLoad: () => {
    kabi.resizeDrawingSurfaceToCanvas();
    const input = Object.fromEntries(
      kabi.stateMachineInputs('Kabi').map((i) => [i.name, i]));
    input.pose.value = 7;      // celebrate
    input.mood.value = 1;      // happy
    input.color.value = 1;     // blue body
    input.jump.fire();         // one-shot hop
  },
});`,
  React: `import { useRive, useStateMachineInput } from '@rive-app/react-canvas';

export function Kabi({ pose = 0, mood = 0 }) {
  const { rive, RiveComponent } = useRive({
    src: '/kabi.riv', stateMachines: 'Kabi', autoplay: true,
  });
  const poseIn = useStateMachineInput(rive, 'Kabi', 'pose');
  const moodIn = useStateMachineInput(rive, 'Kabi', 'mood');
  const jump = useStateMachineInput(rive, 'Kabi', 'jump');
  if (poseIn) poseIn.value = pose;
  if (moodIn) moodIn.value = mood;
  return <RiveComponent onClick={() => jump?.fire()} />;
}`,
  SwiftUI: `import RiveRuntime

struct KabiView: View {
  @StateObject var kabi = RiveViewModel(fileName: "kabi",
                                        stateMachineName: "Kabi")
  var body: some View {
    kabi.view()
      .onAppear {
        kabi.setInput("pose", value: 5.0)   // run
        kabi.setInput("mood", value: 2.0)   // determined
        kabi.setInput("glasses", value: false)
      }
      .onTapGesture { kabi.triggerInput("poke") }
  }
}`,
  Android: `// res/raw/kabi.riv  +  <app.rive.runtime.kotlin.RiveAnimationView
//   app:riveResource="@raw/kabi" app:riveStateMachine="Kabi" />
kabiView.setNumberState("Kabi", "pose", 9f)       // sleep
kabiView.setNumberState("Kabi", "mood", 6f)       // sleepy
kabiView.setBooleanState("Kabi", "glasses", false)
kabiView.fireState("Kabi", "hi")`,
  Flutter: `RiveAnimation.asset(
  'assets/kabi.riv',
  stateMachines: const ['Kabi'],
  onInit: (artboard) {
    final c = StateMachineController.fromArtboard(artboard, 'Kabi')!;
    artboard.addController(c);
    (c.findInput<double>('pose') as SMINumber).value = 3;  // squat
    (c.findInput<bool>('jump') as SMITrigger).fire();
  },
)`,
};
function buildCode() {
  const tabs = $('#codeTabs');
  const show = (k) => {
    $('#code').textContent = SNIPPETS[k];
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === k)));
  };
  for (const k of Object.keys(SNIPPETS)) {
    const b = document.createElement('button');
    b.setAttribute('role', 'tab'); b.textContent = k; b.onclick = () => show(k);
    tabs.append(b);
  }
  show('Web');
}

// ---- boot ---------------------------------------------------------------------
buildControls();
try {
  r = await mountRive(canvas, '../dist/kabi.riv', { stateMachine: 'Kabi' });
  autoResize(canvas, () => r);
  inp = inputsOf(r);
  const saved = store.get('kabi.viewer');
  if (saved) for (const [k, v] of Object.entries(saved)) if (inp[k]) inp[k].value = v;
  sync();
  setTimeout(() => fire('hi'), 600);
} catch (e) {
  $('#readout').textContent = 'Could not load dist/kabi.riv — run `npm run build`';
  console.error(e);
}
