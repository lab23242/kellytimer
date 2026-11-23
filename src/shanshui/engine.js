// A clean, DOM-free wrapper around the shan-shui-inf generator (src/shanshui/upstream.js).
//
// Upstream generates the landscape left to right in "chunks" of 512 world units, drawing
// from one global PRNG, so chunk N depends on everything generated before it. To allow
// random access (resume mid-day, drop and regenerate chunks), the wrapper reseeds the PRNG
// at the start of every chunk from (seed, chunk index). The Perlin noise table is seeded
// once per landscape, so terrain stays continuous across chunk borders.
//
// Upstream's planner keeps a per-x "occupied" matrix (MEM.planmtx); entries ahead of the
// current chunk always end up NaN and get reset to 0 when that chunk is planned, so each
// chunk only ever sees its own mountains. Resetting it per chunk is therefore identical.
import { createUpstream } from "./upstream.js";

/** Upstream chunk width (MEM.cwid). */
export const CHUNK_WIDTH = 512;
/** Visible world height in upstream (MEM.windy / zoom in calcViewBox). */
export const WORLD_HEIGHT = 800 / 1.142;

// How far an element generated for chunk k can reach outside [k*W, (k+1)*W].
// Measured over 400 chunks by scripts/measure-reach.mjs (worst case left ~1100, right
// ~1550, from mountains offset by +-500 and 1500-wide distant ranges); padded.
export const REACH_LEFT = 1300;
export const REACH_RIGHT = 1800;

const POINTS_RE = /points='([^']*)'/g;

/** Horizontal extent of an SVG fragment made of upstream polylines. */
export function measureExtent(svg, fallbackX) {
  let min = Infinity;
  let max = -Infinity;
  for (const m of svg.matchAll(POINTS_RE)) {
    const nums = m[1].split(/[\s,]+/);
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === "") continue;
      const x = +nums[i];
      i++;
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }
  if (min === Infinity) return [fallbackX - REACH_LEFT, fallbackX + REACH_RIGHT];
  return [min, max];
}

/**
 * Create a deterministic, endless landscape.
 * @param {{seed: string|number, height?: number, cacheLimit?: number}} opts
 */
export function createLandscape({ seed, height = WORLD_HEIGHT, cacheLimit = 12 } = {}) {
  const seedStr = String(seed);
  // Upstream replaces Math.random with its PRNG; give it a private Math so nothing leaks.
  const localMath = Object.create(globalThis.Math);
  const quiet = { log() {} };
  const win = { btoa: (s) => globalThis.btoa(s) };
  const up = createUpstream(localMath, win, quiet);

  localMath.seed(seedStr);
  up.Noise.noise(0); // fill the Perlin table from the landscape seed

  const chunks = new Map(); // k -> { k, elements: [{tag, x, y, canv, x0, x1}] }

  function generateChunk(k) {
    const MEM = up.MEM;
    up.Prng.seed(`${seedStr}#${k}`);
    MEM.chunks = [];
    MEM.planmtx = [];
    MEM.xmin = -Infinity;
    MEM.xmax = k * CHUNK_WIDTH;
    // Makes upstream's chunkloader plan exactly one chunk: [k*W, (k+1)*W).
    const probe = MEM.xmax - CHUNK_WIDTH + 1;
    up.chunkloader(probe, probe);
    const elements = MEM.chunks.map((el, i) => {
      const [x0, x1] = measureExtent(el.canv, el.x);
      return { tag: el.tag, x: el.x, y: el.y, canv: el.canv, x0, x1, k, i };
    });
    MEM.chunks = [];
    return { k, elements };
  }

  function getChunk(k) {
    let chunk = chunks.get(k);
    if (chunk) {
      // refresh LRU position
      chunks.delete(k);
      chunks.set(k, chunk);
      return chunk;
    }
    chunk = generateChunk(k);
    chunks.set(k, chunk);
    while (chunks.size > cacheLimit) chunks.delete(chunks.keys().next().value);
    return chunk;
  }

  /** Chunk indices whose elements may overlap [x0, x1]. */
  function chunkRange(x0, x1) {
    return [
      Math.floor((x0 - REACH_RIGHT) / CHUNK_WIDTH),
      Math.floor((x1 + REACH_LEFT) / CHUNK_WIDTH),
    ];
  }

  /** Elements overlapping [x0, x1], in upstream's back-to-front (y) order. */
  function elementsIn(x0, x1) {
    const [kLo, kHi] = chunkRange(x0, x1);
    const out = [];
    for (let k = kLo; k <= kHi; k++) {
      for (const el of getChunk(k).elements) {
        if (el.x1 >= x0 && el.x0 <= x1) out.push(el);
      }
    }
    out.sort((a, b) => a.y - b.y || a.k - b.k || a.i - b.i);
    return out;
  }

  /**
   * SVG markup for world span [x0, x1] at full landscape height.
   * `width`/`height` set the rendered size in pixels (defaults to world units).
   */
  function renderRange(x0, x1, { width, height: pxHeight } = {}) {
    const w = width ?? x1 - x0;
    const h = pxHeight ?? height;
    const body = elementsIn(x0, x1)
      .map((el) => el.canv)
      .join("");
    return (
      `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' ` +
      `viewBox='${x0} 0 ${x1 - x0} ${height}' preserveAspectRatio='none'>${body}</svg>`
    );
  }

  /** Forget chunks that can no longer affect anything at or right of `x`. */
  function dropBefore(x) {
    for (const k of [...chunks.keys()]) {
      if ((k + 1) * CHUNK_WIDTH + REACH_RIGHT < x) chunks.delete(k);
    }
  }

  return {
    seed: seedStr,
    height,
    renderRange,
    elementsIn,
    chunkRange,
    getChunk,
    dropBefore,
    cachedChunks: () => chunks.size,
    /** Upstream's paper texture, drawn into a 2D context (size x size, mirrored tile). */
    paintPaper(ctx, size = 512) {
      // Ported from upstream's trailing <canvas id="bgcanv"> script, which touched the DOM.
      for (let i = 0; i < size / 2 + 1; i++) {
        for (let j = 0; j < size / 2 + 1; j++) {
          let c = 245 + up.Noise.noise(i * 0.1, j * 0.1) * 10;
          c -= localMath.random() * 20;
          ctx.fillStyle = `rgb(${c.toFixed(0)},${(c * 0.95).toFixed(0)},${(c * 0.85).toFixed(0)})`;
          ctx.fillRect(i, j, 1, 1);
          ctx.fillRect(size - i, j, 1, 1);
          ctx.fillRect(i, size - j, 1, 1);
          ctx.fillRect(size - i, size - j, 1, 1);
        }
      }
    },
  };
}
