// Minimal binary writer for the Rive runtime format (major version 7).
// Header: "RIVE" | varuint major | varuint minor | varuint fileId | ToC (empty) |
// objects: varuint typeKey, then (varuint propertyKey, value)* terminated by 0.
import { TYPES, PROPS } from './schema.js';

class ByteSink {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size); next.set(this.buf.subarray(0, this.len)); this.buf = next;
  }
  byte(b) { this.ensure(1); this.buf[this.len++] = b & 0xff; }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  varuint(v) {
    v = Math.max(0, Math.floor(v));
    do {
      let b = v % 128; v = Math.floor(v / 128);
      if (v > 0) b |= 0x80;
      this.byte(b);
    } while (v > 0);
  }
  float32(v) { const a = new DataView(new ArrayBuffer(4)); a.setFloat32(0, v, true); this.bytes(new Uint8Array(a.buffer)); }
  uint32(v) { const a = new DataView(new ArrayBuffer(4)); a.setUint32(0, v >>> 0, true); this.bytes(new Uint8Array(a.buffer)); }
  string(s) { const enc = new TextEncoder().encode(s); this.varuint(enc.length); this.bytes(enc); }
  result() { return this.buf.slice(0, this.len); }
}

// "#rrggbb" | "#aarrggbb"-less "#rrggbbaa" | number -> ARGB uint32
export function colorToArgb(c, alpha = 1) {
  if (typeof c === 'number') return c >>> 0;
  let h = c.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  let a = Math.round(alpha * 255);
  if (h.length === 8) { a = Math.round(parseInt(h.slice(6, 8), 16) * alpha); h = h.slice(0, 6); }
  return ((a << 24) | parseInt(h, 16)) >>> 0;
}

/**
 * @param {{type: string, props: Record<string, any>}[]} objects
 * @returns {Uint8Array}
 */
export function writeRiv(objects, { fileId = 0 } = {}) {
  const out = new ByteSink();
  for (const ch of 'RIVE') out.byte(ch.charCodeAt(0));
  out.varuint(7); // major
  out.varuint(0); // minor
  out.varuint(fileId);
  out.varuint(0); // empty table of contents: we only emit properties the runtime knows
  for (const obj of objects) {
    const typeKey = TYPES[obj.type];
    if (typeKey == null) throw new Error(`Unknown type ${obj.type}`);
    out.varuint(typeKey);
    for (const [name, value] of Object.entries(obj.props || {})) {
      if (value === undefined || value === null) continue;
      const def = PROPS[name];
      if (!def) throw new Error(`Unknown property ${name} on ${obj.type}`);
      const [key, field] = def;
      out.varuint(key);
      switch (field) {
        case 'uint': out.varuint(value); break;
        case 'double': out.float32(value); break;
        case 'string': out.string(String(value)); break;
        case 'color': out.uint32(colorToArgb(value)); break;
        case 'bool': out.byte(value ? 1 : 0); break;
        default: throw new Error(field);
      }
    }
    out.varuint(0);
  }
  return out.result();
}
