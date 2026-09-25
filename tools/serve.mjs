// Zero-dependency static server for the viewer/editor.
//   node tools/serve.mjs [port]   ->  http://localhost:5173/web/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = +process.argv[2] || +process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.riv': 'application/octet-stream',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.map': 'application/json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') { res.writeHead(302, { Location: '/web/' }); return res.end(); }
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
})
  .on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    // Usually an earlier `npm run dev` is still running; it serves files fresh
    // from disk, so the new build is already live there.
    console.log(`Port ${PORT} is already in use (a Kabi server is probably still running).`);
    console.log(`The fresh build is served there — just refresh http://localhost:${PORT}/web/`);
    console.log(`Or stop the other server first, or run on another port: node tools/serve.mjs ${PORT + 1}`);
    process.exit(0);
  })
  .listen(PORT, () => console.log(`Kabi viewer:  http://localhost:${PORT}/web/\nKabi editor:  http://localhost:${PORT}/web/editor.html`));
