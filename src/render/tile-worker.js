// Generates landscape tiles off the main thread. Chunk generation is synchronous and can
// take a few hundred milliseconds, so it never runs on the UI thread.
//
// in:  {type:"init", seed} | {type:"render", id, x0, x1, width, height} | {type:"drop", before}
// out: {type:"tile", id, svg, ms, chunks} | {type:"error", id, message}
import { createLandscape } from "../shanshui/engine.js";

let land = null;

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      land = createLandscape({ seed: msg.seed });
    } else if (msg.type === "drop") {
      land?.dropBefore(msg.before);
    } else if (msg.type === "render") {
      if (!land) throw new Error("render before init");
      const t0 = performance.now();
      const svg = land.renderRange(msg.x0, msg.x1, { width: msg.width, height: msg.height });
      self.postMessage({ type: "tile", id: msg.id, svg, ms: performance.now() - t0, chunks: land.cachedChunks() });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, message: String(err?.stack || err) });
  }
};
