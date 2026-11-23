// Developer flags, from the URL query (?timescale=60&autostart=1) or, for `tauri dev`,
// the VITE_SHANSHUI_DEBUG env var in the same query format. Never used by normal users.
//
//   timescale=N   app time runs N times faster (60: one minute per second). Disables saving.
//   autostart=1   force "start the next part automatically" on
//   soaklog=MS    log tile/chunk counts and JS heap every MS milliseconds
//   render=svg    draw tiles as live SVG instead of canvases (for benchmarking)
//   nopersist=1   don't read or write saved state
//   quiet=1       no chimes, toasts or Rust alarms (for long accelerated runs)

function parse(query) {
  const p = new URLSearchParams(query);
  const num = (k) => (p.has(k) ? Number(p.get(k)) : undefined);
  return {
    timescale: num("timescale"),
    autostart: p.get("autostart") === "1",
    soaklog: num("soaklog"),
    render: p.get("render") === "svg" ? "svg" : "canvas",
    nopersist: p.get("nopersist") === "1",
    quiet: p.get("quiet") === "1",
  };
}

const fromEnv = parse(import.meta.env.VITE_SHANSHUI_DEBUG || "");
const fromUrl = parse(typeof location === "undefined" ? "" : location.search);

export const debug = {
  timescale: fromUrl.timescale || fromEnv.timescale || 1,
  autostart: fromUrl.autostart || fromEnv.autostart,
  soaklog: fromUrl.soaklog || fromEnv.soaklog || 0,
  render: fromUrl.render === "svg" || fromEnv.render === "svg" ? "svg" : "canvas",
  nopersist: fromUrl.nopersist || fromEnv.nopersist,
  quiet: fromUrl.quiet || fromEnv.quiet,
};
debug.persist = !debug.nopersist && debug.timescale === 1;

/** Periodic soak-test log of chunk counts and memory. */
export function startSoakLog(getStats) {
  if (!debug.soaklog) return;
  const t0 = performance.now();
  const samples = [];
  window.__shanshuiSoak = samples;
  setInterval(() => {
    const mem = performance.memory;
    const sample = {
      t: Math.round((performance.now() - t0) / 1000),
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      ...getStats(),
    };
    samples.push(sample);
    console.info("shanshui-soak", JSON.stringify(sample));
  }, debug.soaklog);
}
