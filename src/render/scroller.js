// The scrolling landscape strip.
//
// Tiles (one landscape chunk wide) are generated as SVG in a worker, rasterised once into
// an opaque canvas with the paper texture baked in, and placed side by side in a strip.
// Scrolling only changes the strip's transform, snapped to whole device pixels, so the
// browser never re-rasterises the painting while it moves. Tiles well behind the view
// are removed and the number alive is capped.
import { CHUNK_WIDTH, WORLD_HEIGHT, createLandscape } from "../shanshui/engine.js";

/** Keep at least this many viewports of tiles ready ahead of the view. */
const AHEAD_VIEWPORTS = 1.25;
const KEEP_BEHIND_TILES = 1;
const MAX_TILES = 12;
const PAPER_SIZE = 512;
const RETRY_AFTER_ERROR_MS = 3000;

const idle = (fn) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 30);
const idleTick = () => new Promise((resolve) => idle(resolve));

/** Upstream's paper texture as a canvas (same every day). */
export function makePaper() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAPER_SIZE;
  createLandscape({ seed: "paper" }).paintPaper(canvas.getContext("2d"), PAPER_SIZE);
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
 * @param {{host: HTMLElement, paper: HTMLCanvasElement, mode?: "canvas"|"svg"}} opts
 */
export function createScroller({ host, paper, mode = "canvas" }) {
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
  let x = 0;
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
    update();
  }

  function setPosition(worldX) {
    x = worldX;
    update();
  }

  function setActive(on) {
    if (active === on) return;
    active = on;
    if (on) update();
  }

  /** Visible + buffered tile range for the current position. */
  function wantedRange() {
    const { tileWorld, viewW, scale } = geometry;
    const first = Math.floor(x / tileWorld);
    const last = Math.floor((x + (viewW / scale) * (1 + AHEAD_VIEWPORTS)) / tileWorld);
    return [first, Math.min(last, first + MAX_TILES - 1 - KEEP_BEHIND_TILES)];
  }

  function update() {
    if (!geometry || seed == null) return;
    const { dpr, scale } = geometry;
    const devX = Math.round(x * scale * dpr);
    if (devX !== shownDevX) {
      shownDevX = devX;
      strip.style.transform = `translate3d(${-devX / dpr}px,0,0)`;
    }
    if (!active) return;

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
    const cssW = tileDev / dpr;
    const svgSize = mode === "canvas" ? { width: tileDev, height: devH } : { width: cssW, height: viewH };
    const res = await gen.render({ x0: i * tileWorld, x1: (i + 1) * tileWorld, ...svgSize });
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
      el.width = tileDev;
      el.height = devH;
      const ctx = el.getContext("2d");
      const pattern = ctx.createPattern(paper, "repeat");
      // align the paper grain to the whole strip so tile edges don't show
      pattern.setTransform(new DOMMatrix().translateSelf(-((i * tileDev) % (PAPER_SIZE * dpr)), 0).scaleSelf(dpr, dpr));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, tileDev, devH);
      ctx.globalCompositeOperation = "multiply"; // upstream draws the SVG with mix-blend-mode: multiply
      ctx.drawImage(img, 0, 0, tileDev, devH);
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
    setPosition,
    setActive,
    /** CSS px moved per world unit. */
    scale: () => geometry?.scale ?? 0,
    dpr: () => geometry?.dpr ?? 1,
    stats: () => ({ ...stats, tiles: tiles.size, domTiles: strip.childElementCount, busy }),
  };
}
