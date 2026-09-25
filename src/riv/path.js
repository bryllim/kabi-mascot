// SVG path <-> Rive vertex helpers.
// Contour = { closed: bool, points: [{x, y, inX, inY, outX, outY}] } with
// absolute control-point positions (handles equal to the point = sharp corner).

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** Parse absolute/relative M, L, H, V, C, S, Q, Z commands into contours. */
export function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const contours = [];
  let cur = null, cmd = null, i = 0, cx = 0, cy = 0, sx = 0, sy = 0, lastCtrl = null;
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const start = (x, y) => {
    cur = { closed: false, points: [{ x, y, inX: x, inY: y, outX: x, outY: y }] };
    contours.push(cur); sx = x; sy = y;
  };
  const lineTo = (x, y) => { cur.points.push({ x, y, inX: x, inY: y, outX: x, outY: y }); };
  const curveTo = (x1, y1, x2, y2, x, y) => {
    const prev = cur.points[cur.points.length - 1];
    prev.outX = x1; prev.outY = y1;
    cur.points.push({ x, y, inX: x2, inY: y2, outX: x, outY: y });
    lastCtrl = [x2, y2];
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': { const x = num() + ox, y = num() + oy; start(x, y); cx = x; cy = y; cmd = rel ? 'l' : 'L'; lastCtrl = null; break; }
      case 'L': { const x = num() + ox, y = num() + oy; lineTo(x, y); cx = x; cy = y; lastCtrl = null; break; }
      case 'H': { const x = num() + ox; lineTo(x, cy); cx = x; lastCtrl = null; break; }
      case 'V': { const y = num() + oy; lineTo(cx, y); cy = y; lastCtrl = null; break; }
      case 'C': {
        const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
        curveTo(x1, y1, x2, y2, x, y); cx = x; cy = y; break;
      }
      case 'S': {
        const x1 = lastCtrl ? 2 * cx - lastCtrl[0] : cx, y1 = lastCtrl ? 2 * cy - lastCtrl[1] : cy;
        const x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
        curveTo(x1, y1, x2, y2, x, y); cx = x; cy = y; break;
      }
      case 'Q': {
        const qx = num() + ox, qy = num() + oy, x = num() + ox, y = num() + oy;
        curveTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        cx = x; cy = y; break;
      }
      case 'Z': {
        cur.closed = true;
        // Merge duplicated closing point into the first point.
        const pts = cur.points, first = pts[0], last = pts[pts.length - 1];
        if (pts.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 0.01) {
          first.inX = last.inX; first.inY = last.inY; pts.pop();
        }
        cx = sx; cy = sy; lastCtrl = null; break;
      }
      default: throw new Error('Unsupported path command ' + cmd);
    }
  }
  return contours;
}

export function contoursToSvg(contours, dp = 2) {
  const f = (n) => +n.toFixed(dp);
  return contours.map((c) => {
    const p = c.points;
    let s = `M${f(p[0].x)} ${f(p[0].y)}`;
    const seg = (a, b) => {
      const straight = a.outX === a.x && a.outY === a.y && b.inX === b.x && b.inY === b.y;
      s += straight ? `L${f(b.x)} ${f(b.y)}` : `C${f(a.outX)} ${f(a.outY)} ${f(b.inX)} ${f(b.inY)} ${f(b.x)} ${f(b.y)}`;
    };
    for (let k = 1; k < p.length; k++) seg(p[k - 1], p[k]);
    if (c.closed) { seg(p[p.length - 1], p[0]); s += 'Z'; }
    return s;
  }).join('');
}

export function transformContours(contours, fn) {
  return contours.map((c) => ({
    closed: c.closed,
    points: c.points.map((p) => {
      const [x, y] = fn(p.x, p.y), [inX, inY] = fn(p.inX, p.inY), [outX, outY] = fn(p.outX, p.outY);
      return { x, y, inX, inY, outX, outY };
    }),
  }));
}

export const translatePath = (d, dx, dy, s = 1) =>
  contoursToSvg(transformContours(parsePath(d), (x, y) => [x * s + dx, y * s + dy]));

/** Rive CubicDetachedVertex props for a contour point. */
export function toRiveVertex(p) {
  const inDx = p.inX - p.x, inDy = p.inY - p.y, outDx = p.outX - p.x, outDy = p.outY - p.y;
  return {
    vertexX: p.x, vertexY: p.y,
    inRotation: Math.atan2(inDy, inDx), inDistance: Math.hypot(inDx, inDy),
    outRotation: Math.atan2(outDy, outDx), outDistance: Math.hypot(outDx, outDy),
  };
}

export function contoursBBox(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const p of c.points) for (const [x, y] of [[p.x, p.y], [p.inX, p.inY], [p.outX, p.outY]]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

export { NUM };
