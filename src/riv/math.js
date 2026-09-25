// 2D affine helpers. Matrices are [a, b, c, d, e, f] (same as SVG / Rive Mat2D):
//   x' = a*x + c*y + e,  y' = b*x + d*y + f
const DEG = Math.PI / 180;

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function compose(x, y, rotDeg = 0, sx = 1, sy = 1) {
  const r = rotDeg * DEG, c = Math.cos(r), s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}
export function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const id = 1 / det;
  return [
    m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id, (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const angleOf = (m) => Math.atan2(m[1], m[0]) / DEG;

/** Local matrix of a node/bone given its parent (bones sit at the parent bone's tip). */
export function localMatrix(n, parent) {
  if (n.type === 'bone') return compose(parent?.length ?? 0, 0, n.rotation || 0, n.scaleX ?? 1, n.scaleY ?? 1);
  return compose(n.x || 0, n.y || 0, n.rotation || 0, n.scaleX ?? 1, n.scaleY ?? 1);
}

/**
 * World matrices (+ accumulated opacity) for every node and shape in a model.
 * `override(id)` can patch transform fields (used by the editor to preview poses).
 */
export function worldTransforms(model, override = () => null) {
  const all = new Map();
  for (const o of [...model.nodes, ...model.shapes]) all.set(o.id, o);
  const cache = new Map();
  const get = (id) => {
    if (cache.has(id)) return cache.get(id);
    const o = all.get(id);
    const eff = { ...o, ...(override(id) || {}) };
    const parentObj = o.parent ? all.get(o.parent) : null;
    const parent = o.parent ? get(o.parent) : { m: IDENTITY, a: 1 };
    const res = { m: mul(parent.m, localMatrix(eff, parentObj)), a: parent.a * (eff.opacity ?? 1) };
    cache.set(id, res);
    return res;
  };
  for (const id of all.keys()) get(id);
  return cache;
}
