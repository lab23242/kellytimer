// CPU benchmark: rasterised canvas tiles vs live SVG tiles, measured as CPU time of the
// whole app process tree while the timer runs. See scripts/lib/harness.mjs for setup.
// Usage: node scripts/bench.mjs [secondsPerRun=60] [processName=shanshui.exe] [runs=0,1,2,3,4]
//   runs: comma-separated indexes into RUNS, repeats allowed (e.g. 1,2,1,2 to alternate)
import { writeFileSync, mkdirSync } from "node:fs";
import { attach, cores, cpuModel, heapAfterGc, openApp, processTreeCpuMs, sleep } from "./lib/harness.mjs";

const seconds = Number(process.argv[2] || 60);
const proc = process.argv[3] || "shanshui.exe";
const WARMUP_MS = 25_000;

const RUNS = [
  { name: "paused (baseline)", query: "nopersist=1&quiet=1", pause: true },
  { name: "canvas, real speed", query: "render=canvas&nopersist=1&quiet=1" },
  { name: "svg, real speed", query: "render=svg&nopersist=1&quiet=1" },
  { name: "canvas, 10x speed", query: "render=canvas&timescale=10&quiet=1" },
  { name: "svg, 10x speed", query: "render=svg&timescale=10&quiet=1" },
  { name: "canvas, real speed, fixed 30 fps", query: "fps=30&nopersist=1&quiet=1" },
];

const order = (process.argv[4] || RUNS.map((_, i) => i).join(",")).split(",").map(Number);

const { browser, page } = await attach();
const results = [];
for (const run of order.map((i) => RUNS[i])) {
  await openApp(page, run.query);
  if (run.pause) await page.evaluate(() => document.getElementById("btn-play").click());
  await sleep(WARMUP_MS);
  const c0 = processTreeCpuMs(proc);
  const t0 = Date.now();
  await sleep(seconds * 1000);
  const c1 = processTreeCpuMs(proc);
  const wall = Date.now() - t0;
  const heap = await heapAfterGc(page);
  const stats = await page.evaluate(() => window.__shanshui?.stats?.() ?? null);
  const oneCore = ((c1.ms - c0.ms) / wall) * 100;
  const result = {
    run: run.name,
    cpuPctOfOneCore: +oneCore.toFixed(2),
    cpuPctOfMachine: +(oneCore / cores).toFixed(2),
    processes: c1.processes,
    ...heap,
    tiles: stats?.tiles ?? null,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await browser.disconnect();

mkdirSync("bench", { recursive: true });
const report = { date: new Date().toISOString(), cpuModel, cores, secondsPerRun: seconds, results };
writeFileSync("bench/bench-results.json", JSON.stringify(report, null, 2));
console.table(results);
