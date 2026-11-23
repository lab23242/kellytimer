// Soak test: run the app with accelerated time (1 min = 1 s) and auto-start for a while,
// sampling tile/chunk counts and JS heap (after forced GC) every 30 s.
// See scripts/lib/harness.mjs for setup.
// Usage: node scripts/soak.mjs [minutes=10] [sampleSeconds=30]
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, heapAfterGc, openApp, sleep } from "./lib/harness.mjs";

const minutes = Number(process.argv[2] || 10);
const every = Number(process.argv[3] || 30);

const { browser, page } = await attach();
await openApp(page, "timescale=60&autostart=1&quiet=1");
const t0 = Date.now();
const samples = [];

async function sample() {
  const stats = await page.evaluate(() => {
    const s = window.__shanshui.stats();
    return {
      tiles: s.tiles,
      domTiles: s.domTiles,
      workerChunks: s.workerChunks,
      generated: s.generated,
      sessions: document.querySelectorAll("#seals .seal").length,
      time: document.getElementById("time").textContent,
      phase: document.getElementById("phase").textContent,
    };
  });
  const heap = await heapAfterGc(page);
  const row = { t: Math.round((Date.now() - t0) / 1000), ...stats, ...heap };
  samples.push(row);
  console.log(JSON.stringify(row));
}

await sample();
while (Date.now() - t0 < minutes * 60_000) {
  await sleep(every * 1000 - ((Date.now() - t0) % (every * 1000)));
  await sample();
}
await browser.disconnect();

const max = (k) => Math.max(...samples.map((s) => s[k] ?? 0));
const summary = {
  minutes,
  appHoursSimulated: +((minutes * 60) / 60).toFixed(1),
  tilesGenerated: samples.at(-1).generated,
  maxDomTiles: max("domTiles"),
  maxWorkerChunks: max("workerChunks"),
  pageHeapMB: { first: samples[0].pageMB, last: samples.at(-1).pageMB, max: max("pageMB") },
  workerHeapMB: { first: samples[0].workerMB, last: samples.at(-1).workerMB, max: max("workerMB") },
};
mkdirSync("bench", { recursive: true });
writeFileSync("bench/soak-results.json", JSON.stringify({ date: new Date().toISOString(), summary, samples }, null, 2));
console.log(JSON.stringify(summary, null, 2));
