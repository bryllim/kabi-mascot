// Renders a model's rest pose (or any pose override) to a flat SVG. Used for the
// editor's rig overlay and as an importable asset for the Rive editor / Figma.
import { resolveColor } from './compile.js';
import { worldTransforms } from './math.js';

export { worldTransforms };

function splitColor(c) {
  if (c.length === 9) return [c.slice(0, 7), parseInt(c.slice(7), 16) / 255];
  return [c, 1];
}

export function modelToSvg(model, { override, showHidden = false, background } = {}) {
  const W = worldTransforms(model, override);
  const { width, height } = model.artboard;
  const f = (n) => +n.toFixed(3);
  const body = [];
  if (background) body.push(`<rect width="${width}" height="${height}" fill="${background}"/>`);
  for (const s of model.shapes) {
    const { m, a } = W.get(s.id);
    if (!showHidden && a <= 0.001) continue;
    const attrs = [`transform="matrix(${m.map(f).join(' ')})"`, `data-id="${s.id}"`];
    if (a < 0.999) attrs.push(`opacity="${f(a)}"`);
    const paint = [];
    if (s.fill) {
      const [c, al] = splitColor(resolveColor(model, s.fill));
      paint.push(`fill="${c}"`); if (al < 1) paint.push(`fill-opacity="${f(al)}"`);
      if (s.evenOdd) paint.push('fill-rule="evenodd"');
    } else paint.push('fill="none"');
    if (s.stroke) {
      const [c, al] = splitColor(resolveColor(model, s.stroke.color));
      paint.push(`stroke="${c}"`, `stroke-width="${s.stroke.width ?? 4}"`, `stroke-linecap="${s.stroke.cap ?? 'round'}"`, `stroke-linejoin="${s.stroke.join ?? 'round'}"`);
      if (al < 1) paint.push(`stroke-opacity="${f(al)}"`);
    }
    let geom;
    if (s.ellipse) geom = `<ellipse cx="${s.ellipse.cx ?? 0}" cy="${s.ellipse.cy ?? 0}" rx="${s.ellipse.w / 2}" ry="${s.ellipse.h / 2}" ${paint.join(' ')}/>`;
    else geom = `<path d="${s.d}" ${paint.join(' ')}/>`;
    body.push(`<g id="${s.id}" ${attrs.join(' ')}>${geom}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n${body.join('\n')}\n</svg>\n`;
}
