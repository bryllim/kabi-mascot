// Thin wrapper around the Rive web runtime (loaded as a global from vendor/rive.js).
const rive = window.rive;
try { rive.RuntimeLoader.setWasmUrl(new URL('../vendor/rive.wasm', import.meta.url).href); } catch { /* older runtimes */ }
try { rive.Rive.suppressDeprecationWarnings = ['state-machines-param', 'state-machine-inputs']; } catch { /* ignore */ }

export { rive };

/**
 * Creates a Rive instance on `canvas` from a URL or bytes and resolves when loaded.
 * opts: { stateMachine?, animation?, autoplay? }
 */
export function mountRive(canvas, source, { stateMachine, animation, autoplay = true } = {}) {
  return new Promise((resolve, reject) => {
    const params = {
      canvas,
      autoplay,
      layout: new rive.Layout({ fit: rive.Fit.Contain, alignment: rive.Alignment.Center }),
      onLoad: () => { instance.resizeDrawingSurfaceToCanvas(); resolve(instance); },
      onLoadError: (e) => reject(e),
    };
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      params.buffer = source instanceof Uint8Array ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : source;
    } else params.src = source;
    if (stateMachine) params.stateMachines = stateMachine;
    if (animation) params.animations = animation;
    const instance = new rive.Rive(params);
  });
}

export function inputsOf(r, sm = 'Kabi') {
  return Object.fromEntries((r.stateMachineInputs(sm) || []).map((i) => [i.name, i]));
}

/** Keeps the drawing surface sharp when the canvas's CSS size changes. */
export function autoResize(canvas, getRive) {
  const ro = new ResizeObserver(() => getRive()?.resizeDrawingSurfaceToCanvas());
  ro.observe(canvas);
  return ro;
}

/** Artboard -> CSS pixel transform for Fit.Contain / center alignment. */
export function containTransform(cssW, cssH, abW, abH) {
  const s = Math.min(cssW / abW, cssH / abH);
  return { s, ox: (cssW - abW * s) / 2, oy: (cssH - abH * s) / 2 };
}

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
