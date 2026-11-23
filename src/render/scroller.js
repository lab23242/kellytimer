// The scrolling landscape strip.
//
// Tiles (one landscape chunk wide) are generated as SVG in a worker, rasterised once into
// an opaque canvas with the paper texture baked in, and placed side by side in a strip.
// Motion only changes the strip's transform (no re-rasterising), from a timer whose rate
// follows the speed: each update moves at most MAX_STEP_PX, at sub-pixel precision, so
// the pan looks smooth without paying for 60 frames a second. Tiles well behind the
// view are removed and the number alive is capped.
import { CHUNK_WIDTH, WORLD_HEIGHT, createLandscape } from "../shanshui/engine.js";

/** Keep at least this many viewports of tiles ready ahead of the view. */
const AHEAD_VIEWPORTS = 1.25;
const KEEP_BEHIND_TILES = 1;
const MAX_TILES = 12;
const PAPER_SIZE = 512;
const RETRY_AFTER_ERROR_MS = 3000;
/** Each tile is drawn this many device pixels wider and overlaps the next, so no seam
 *  shows while the strip sits at sub-pixel offsets during motion. */
const TILE_OVERLAP_DEV = 2;
/** Largest move per frame while scrolling (CSS px); sets the frame rate from the speed.
 *  At the default speed (~4.7 px/s in the small window) that is about 12 frames/s. */
const MAX_STEP_PX = 0.4;
const MIN_FPS = 2;
const MAX_FPS = 30;
/** Aged-scroll tint multiplied over upstream's (nearly white) paper texture. */
export const PAPER_TINT = "rgb(247 229 184)";
/** How many times the ink layer is multiplied in: 2 darkens upstream's light grey
 *  strokes (v -> v^2) while leaving the white occluding fills untouched. */
const INK_PASSES = 2;

const idle = (fn) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 30);
const idleTick = () => new Promise((resolve) => idle(resolve));

/** Upstream's paper texture, tinted like an old scroll, as a canvas (same every day). */
export function makePaper() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAPER_SIZE;
  const ctx = canvas.getContext("2d");
  createLandscape({ seed: "paper" }).paintPaper(ctx, PAPER_SIZE);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = PAPER_TINT;
  ctx.fillRect(0, 0, PAPER_SIZE, PAPER_SIZE);
  return canvas;
}

/** Tile generator running in a worker, or (if workers are unavailable) in idle time. */
function createGenerator() {
  try {
    const worker = new Worker(new URL("./tile-worker.js", import.meta.url), { type: "module" });
    const waiting = new Map();
    worker.onmessage = (e) => {
      const msg = e.data;
      const job = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (!job) return;
      if (msg.type === "error") job.reject(new Error(msg.message));
      else job.resolve(msg);
    };
    let nextId = 1;
    return {
      kind: "worker",
      init: (seed) => worker.postMessage({ type: "init", seed }),
      drop: (before) => worker.postMessage({ type: "drop", before }),
      render(req) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          waiting.set(id, { resolve, reject });
          worker.postMessage({ type: "render", id, ...req });
        });
      },
    };
  } catch (err) {
    console.warn("shanshui: worker unavailable, generating in idle time", err);
    let land = null;
    return {
      kind: "idle",
      init: (seed) => (land = createLandscape({ seed })),
      drop: (before) => land?.dropBefore(before),
      async render(req) {
        await idleTick();
        const t0 = performance.now();
        const svg = land.renderRange(req.x0, req.x1, { width: req.width, height: req.height });
        return { svg, ms: performance.now() - t0, chunks: land.cachedChunks() };
      },
    };
  }
}

async function loadSvgImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // the decoded image keeps its pixels; the URL is no longer needed
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * @param {{host: HTMLElement, paper: HTMLCanvasElement, mode?: "canvas"|"svg", fps?: number}} opts
 *   `fps` forces a fixed frame rate (benchmarking); by default it follows the speed.
 */
export function createScroller({ host, paper, mode = "canvas", fps }) {
  const strip = document.createElement("div");
  strip.className = "strip";
  host.append(strip);

  const gen = createGenerator();
  const tiles = new Map(); // tile index -> element
  let seed = null;
  let geometry = null; // { viewW, viewH, dpr, scale, tileDev, tileWorld }
  let epoch = 0; // bumps whenever seed or geometry changes; stale results are dropped
  let busy = false;
  let active = true;
  let motion = { x0: 0, v: 0, t0: 0 }; // world x at time t0 (performance.now), speed per ms
  let ticker = null; // setInterval moving the strip while scrolling
  let tickerRate = 0;
  let shownDevX = null;
  let droppedBefore = -Infinity;
  const stats = { generated: 0, lastGenerateMs: 0, lastRasterMs: 0, workerChunks: 0, mode, generator: gen.kind };

  function clearTiles() {
    for (const el of tiles.values()) releaseTile(el);
    tiles.clear();
    epoch++;
    busy = false;
    droppedBefore = -Infinity;
  }

  function releaseTile(el) {
    if (el instanceof HTMLCanvasElement) el.width = el.height = 0; // free the backing store now
    el.remove();
  }

  function setSeed(next) {
    if (next === seed) return;
    seed = next;
    gen.init(seed);
    clearTiles();
    update();
  }

  function setViewport(viewW, viewH, dpr = window.devicePixelRatio || 1) {
    if (geometry && geometry.viewW === viewW && geometry.viewH === viewH && geometry.dpr === dpr) return;
    const scale = viewH / WORLD_HEIGHT; // CSS px per world unit: full landscape height fits
    const tileDev = Math.max(1, Math.round(CHUNK_WIDTH * scale * dpr));
    const heightChanged = !geometry || geometry.viewH !== viewH || geometry.dpr !== dpr;
    geometry = { viewW, viewH, dpr, scale, tileDev, tileWorld: tileDev / (scale * dpr) };
    if (heightChanged) clearTiles();
    shownDevX = null;
    applyMotion();
    update();
  }

  /**
   * Where the view is (world x) and how fast it moves (world units per real ms, 0 when
   * stopped). Called about once a second; the strip is moved smoothly in between.
   */
  function setMotion(worldX, speed) {
    motion = { x0: worldX, v: speed, t0: performance.now() };
    applyMotion();
    update();
  }

  function setActive(on) {
    if (active === on) return;
    active = on;
    applyMotion();
    if (on) update();
  }

  const currentX = (now = performance.now()) => motion.x0 + motion.v * (now - motion.t0);

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
    tickerRate = 0;
  }

  function placeStrip() {
    strip.style.transform = `translate3d(${-currentX() * geometry.scale}px,0,0)`;
  }

  function applyMotion() {
    if (!geometry) return;
    const { scale, dpr } = geometry;
    if (motion.v === 0 || !active) {
      // standing still: sit on whole device pixels so the painting is crisp
      stopTicker();
      const devX = Math.round(motion.x0 * scale * dpr);
      if (devX !== shownDevX) {
        shownDevX = devX;
        strip.style.transform = `translate3d(${-devX / dpr}px,0,0)`;
      }
      return;
    }
    shownDevX = null;
    placeStrip();
    const pxPerSecond = motion.v * 1000 * scale;
    const rate = fps || Math.min(MAX_FPS, Math.max(MIN_FPS, pxPerSecond / MAX_STEP_PX));
    if (ticker && Math.abs(rate - tickerRate) < 0.5) return; // same pace: keep the ticker
    stopTicker();
    tickerRate = rate;
    ticker = setInterval(placeStrip, 1000 / rate);
  }

  /** Visible + buffered tile range for the current position. */
  function wantedRange() {
    const { tileWorld, viewW, scale } = geometry;
    const x = currentX();
    const first = Math.floor(x / tileWorld);
    const last = Math.floor((x + (viewW / scale) * (1 + AHEAD_VIEWPORTS)) / tileWorld);
    return [first, Math.min(last, first + MAX_TILES - 1 - KEEP_BEHIND_TILES)];
  }

  function update() {
    if (!geometry || seed == null || !active) return;

    const [first, last] = wantedRange();
    for (const [i, el] of tiles) {
      if (i < first - KEEP_BEHIND_TILES || i > last) {
        releaseTile(el);
        tiles.delete(i);
      }
    }
    const dropX = (first - KEEP_BEHIND_TILES) * geometry.tileWorld;
    if (dropX > droppedBefore) {
      droppedBefore = dropX;
      gen.drop(dropX);
    }
    pump(first, last);
  }

  /** Generate + rasterise one missing tile at a time, nearest first. */
  function pump(first, last) {
    if (busy || !active) return;
    let target = null;
    for (let i = first; i <= last; i++) {
      if (!tiles.has(i)) {
        target = i;
        break;
      }
    }
    if (target == null) return;
    busy = true;
    const myEpoch = epoch;
    let retryDelay = 0;
    buildTile(target, myEpoch)
      .catch((err) => {
        console.error("shanshui: tile failed", err);
        retryDelay = RETRY_AFTER_ERROR_MS; // don't spin on a persistent failure
      })
      .finally(() => {
        if (myEpoch !== epoch) return;
        setTimeout(() => {
          if (myEpoch !== epoch) return;
          busy = false;
          update();
        }, retryDelay);
      });
  }

  async function buildTile(i, myEpoch) {
    const { tileDev, tileWorld, viewH, dpr } = geometry;
    const devH = Math.round(viewH * dpr);
    const devW = tileDev + TILE_OVERLAP_DEV;
    const cssW = devW / dpr;
    const svgSize = mode === "canvas" ? { width: devW, height: devH } : { width: cssW, height: viewH };
    const x0 = i * tileWorld;
    const res = await gen.render({ x0, x1: x0 + (devW / tileDev) * tileWorld, ...svgSize });
    stats.generated++;
    stats.lastGenerateMs = Math.round(res.ms);
    stats.workerChunks = res.chunks;
    if (myEpoch !== epoch) return;

    let el;
    if (mode === "svg") {
      el = document.createElement("div");
      el.innerHTML = res.svg;
    } else {
      const img = await loadSvgImage(res.svg);
      if (myEpoch !== epoch) return;
      await idleTick(); // rasterise in idle time, never inside an animation frame
      if (myEpoch !== epoch) return;
      const t0 = performance.now();
      el = document.createElement("canvas");
      el.width = devW;
      el.height = devH;
      const ctx = el.getContext("2d");
      const pattern = ctx.createPattern(paper, "repeat");
      // align the paper grain to the whole strip so tile edges don't show
      pattern.setTransform(new DOMMatrix().translateSelf(-((i * tileDev) % (PAPER_SIZE * dpr)), 0).scaleSelf(dpr, dpr));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, devW, devH);
      ctx.globalCompositeOperation = "multiply"; // upstream draws the SVG with mix-blend-mode: multiply
      for (let pass = 0; pass < INK_PASSES; pass++) ctx.drawImage(img, 0, 0, devW, devH);
      stats.lastRasterMs = Math.round(performance.now() - t0);
    }
    el.className = "tile";
    el.style.width = `${cssW}px`;
    el.style.height = `${viewH}px`;
    el.style.transform = `translate3d(${(i * tileDev) / dpr}px,0,0)`;
    strip.append(el);
    tiles.set(i, el);
  }

  return {
    setSeed,
    setViewport,
    setMotion,
    setActive,
    /** CSS px moved per world unit. */
    scale: () => geometry?.scale ?? 0,
    dpr: () => geometry?.dpr ?? 1,
    stats: () => ({ ...stats, tiles: tiles.size, domTiles: strip.childElementCount, busy }),
  };
}
