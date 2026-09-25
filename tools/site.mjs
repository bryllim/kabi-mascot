// Assembles the static site for hosting (Vercel, GitHub Pages, any static host):
//   site/web   viewer, editor, pose lab (+ vendored Rive runtime)
//   site/src   ES modules the pages import to build/preview the model live
//   site/dist  the prebuilt kabi.riv / model / svg
// Run after `npm run build` (npm run build:site does both).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'site');
fs.rmSync(OUT, { recursive: true, force: true });
for (const dir of ['web', 'src', 'dist']) fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'reference.jpeg'), path.join(OUT, 'reference.jpeg'));
// Plain-static fallback for hosts without redirects: / -> /web/
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Kabi</title><meta http-equiv="refresh" content="0; url=web/"><a href="web/">Open the Kabi viewer</a>\n');
const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
console.log(`site/ ready (${count(OUT)} files)`);
