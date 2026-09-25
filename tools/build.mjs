// Builds the mascot.
//
//   node tools/build.mjs                    # from src/character -> dist/
//   node tools/build.mjs --model my.json    # compile a model exported from the editor
//
// Outputs dist/kabi.riv, dist/kabi.model.json and dist/kabi.svg (rest pose).
import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../src/character/index.js';
import { compileModel } from '../src/riv/compile.js';
import { modelToSvg } from '../src/riv/svg.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const modelArg = args.indexOf('--model');
const model = modelArg >= 0
  ? JSON.parse(fs.readFileSync(path.resolve(args[modelArg + 1]), 'utf8'))
  : buildModel();

// Vendor the Rive web runtime next to the viewer so it works offline.
const vendor = path.join(ROOT, 'web/vendor');
fs.mkdirSync(vendor, { recursive: true });
for (const f of ['rive.js', 'rive.wasm']) fs.copyFileSync(path.join(ROOT, 'node_modules/@rive-app/canvas', f), path.join(vendor, f));

const out = path.join(ROOT, 'dist');
fs.mkdirSync(out, { recursive: true });
const riv = compileModel(model);
fs.writeFileSync(path.join(out, 'kabi.riv'), riv);
fs.writeFileSync(path.join(out, 'kabi.model.json'), JSON.stringify(model));
// The SVG shows Kabi's default look, so leave out the optional outline copies
// (at runtime the Outline layer keeps them transparent unless `outline` is on).
const svgModel = { ...model, shapes: model.shapes.filter((sh) => sh.stroke?.color !== 'outline') };
fs.writeFileSync(path.join(out, 'kabi.svg'), modelToSvg(svgModel));

const keys = model.animations.reduce((n, a) => n + a.tracks.reduce((m, t) => m + t.keys.length, 0), 0);
console.log(`dist/kabi.riv  ${(riv.length / 1024).toFixed(1)} KB`);
console.log(`  ${model.nodes.length} bones/groups, ${model.shapes.length} vector shapes`);
console.log(`  ${model.animations.length} animations (${keys} keyframes), ${model.stateMachines.length} state machine`);
console.log(`  inputs: ${model.stateMachines[0].inputs.map((i) => `${i.name}:${i.type}`).join(', ')}`);
