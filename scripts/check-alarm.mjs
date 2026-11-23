// End-to-end check of the Rust phase-end alarm in the running Tauri app: starts a focus
// session at 60x speed (25 real seconds), listens for the Rust "alarm" event in the page
// and reports how close to the expected end it fired. Plays one chime and shows one toast.
// Setup as in scripts/lib/harness.mjs. Usage: node scripts/check-alarm.mjs
import { attach, openApp } from "./lib/harness.mjs";

const { browser, page } = await attach();
await openApp(page, "timescale=60&nopersist=1");

const result = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals) return reject(new Error("not running inside Tauri"));
      // expected real end: the alarm request uses the same conversion as main.js
      const remainingText = document.getElementById("time").textContent;
      const [m, s] = remainingText.split(":").map(Number);
      const expected = Date.now() + ((m * 60 + s) * 1000) / 60;
      const handler = internals.transformCallback((event) => {
        resolve({ firedAt: Date.now(), expected, payload: event.payload, phaseAfter: document.getElementById("phase").textContent });
      });
      internals.invoke("plugin:event|listen", { event: "alarm", target: { kind: "Any" }, handler }).catch(reject);
      setTimeout(() => reject(new Error("no alarm within 60 s")), 60_000);
    }),
);

// stop the run so no further chimes play
await page.evaluate(() => document.getElementById("btn-play").click());
await browser.disconnect();

const lateMs = result.firedAt - result.payload.endsAtMs;
console.log(
  JSON.stringify(
    {
      stale: result.payload.stale,
      firedMsAfterEnd: lateMs,
      expectedVsRequestedMs: Math.round(result.payload.endsAtMs - result.expected),
      phaseAfter: result.phaseAfter,
      ok: !result.payload.stale && lateMs >= 0 && lateMs < 1500,
    },
    null,
    2,
  ),
);
