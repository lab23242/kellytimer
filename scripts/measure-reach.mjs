// Measures how far elements generated for a chunk extend beyond the chunk's own
// [k*W, (k+1)*W) span, and how long chunk generation takes. Used to pick REACH_LEFT /
// REACH_RIGHT in src/shanshui/engine.js. Usage: node scripts/measure-reach.mjs [chunks]
import { createLandscape, CHUNK_WIDTH } from "../src/shanshui/engine.js";

const n = Number(process.argv[2] || 400);
let left = 0;
let right = 0;
let totalMs = 0;
let worstMs = 0;
let totalBytes = 0;
const seeds = ["2026-11-23", "2026-11-24", "2027-01-01", "shanshui"];
const perSeed = Math.ceil(n / seeds.length);

for (const seed of seeds) {
  const land = createLandscape({ seed, cacheLimit: 4 });
  for (let k = 0; k < perSeed; k++) {
    const t0 = performance.now();
    const { elements } = land.getChunk(k);
    const dt = performance.now() - t0;
    totalMs += dt;
    worstMs = Math.max(worstMs, dt);
    for (const e of elements) {
      left = Math.max(left, k * CHUNK_WIDTH - e.x0);
      right = Math.max(right, e.x1 - (k + 1) * CHUNK_WIDTH);
      totalBytes += e.canv.length;
    }
  }
}

console.log(
  JSON.stringify(
    {
      chunks: perSeed * seeds.length,
      maxReachLeft: Math.round(left),
      maxReachRight: Math.round(right),
      avgChunkMs: +(totalMs / (perSeed * seeds.length)).toFixed(1),
      worstChunkMs: +worstMs.toFixed(1),
      avgChunkKB: +(totalBytes / 1024 / (perSeed * seeds.length)).toFixed(0),
    },
    null,
    2,
  ),
);
