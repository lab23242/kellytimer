// Shared helpers for scripts/bench.mjs and scripts/soak.mjs.
//
// Both attach to a running app over the Chrome DevTools Protocol:
//   Windows (the real app):  set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//                            then `npm run tauri dev`
//   Any OS (browser only):   start Chrome/Edge with --remote-debugging-port=9222 and open
//                            http://localhost:1420 (`npm run dev`)
import { execFileSync } from "node:child_process";
import os from "node:os";
import puppeteer from "puppeteer-core";

export const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
export const APP_URL = process.env.APP_URL || "http://localhost:1420/";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function attach() {
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().startsWith(APP_URL)) || pages[0];
  if (!page) throw new Error(`no page found at ${CDP_URL}`);
  return { browser, page };
}

/** Load the app with debug flags and start the timer. */
export async function openApp(page, query) {
  await page.goto(`${APP_URL}?${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.classList.contains("ready"), { timeout: 15_000 });
  await page.evaluate(() => document.getElementById("time").click());
  await sleep(600);
}

/**
 * Total CPU time (ms) of the process named `rootName` and all its descendants
 * (for Tauri: shanshui.exe plus its WebView2 browser, renderer and GPU processes).
 */
export function processTreeCpuMs(rootName) {
  if (process.platform === "win32") {
    const json = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const procs = JSON.parse(json).map((p) => ({
      pid: p.ProcessId,
      ppid: p.ParentProcessId,
      name: String(p.Name).toLowerCase(),
      ms: (Number(p.KernelModeTime) + Number(p.UserModeTime)) / 10_000,
    }));
    return sumTree(procs, rootName.toLowerCase());
  }
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,comm="], { encoding: "utf8" });
  const procs = out
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, ppid, time, ...name] = line.trim().split(/\s+/);
      const parts = time.replace("-", ":").split(":").map(Number);
      const secs = parts.reduce((acc, v) => acc * 60 + v, 0);
      return { pid: +pid, ppid: +ppid, name: name.join(" ").toLowerCase(), ms: secs * 1000 };
    });
  return sumTree(procs, rootName.toLowerCase().replace(/\.exe$/, ""));
}

function sumTree(procs, rootName) {
  const roots = procs.filter((p) => p.name === rootName);
  if (roots.length === 0) throw new Error(`process ${rootName} not running`);
  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  let total = 0;
  let count = 0;
  const stack = [...roots];
  const seen = new Set();
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    total += p.ms;
    count++;
    stack.push(...(children.get(p.pid) || []));
  }
  return { ms: total, processes: count };
}

export const cores = os.cpus().length;
export const cpuModel = os.cpus()[0]?.model?.trim();

/** JS heap of the page and of its landscape worker, after a forced GC. */
export async function heapAfterGc(page) {
  const session = await page.createCDPSession();
  await session.send("HeapProfiler.collectGarbage");
  const pageHeap = await session.send("Runtime.getHeapUsage");
  const metrics = await session.send("Performance.getMetrics").catch(() => ({ metrics: [] }));
  await session.detach();
  let workerMB = null;
  for (const worker of page.workers()) {
    try {
      await worker.client.send("HeapProfiler.collectGarbage");
      const h = await worker.client.send("Runtime.getHeapUsage");
      workerMB = (workerMB || 0) + h.usedSize / 1048576;
    } catch {
      // worker may be restarting; report null for this sample
    }
  }
  const nodes = metrics.metrics.find((m) => m.name === "Nodes")?.value ?? null;
  return { pageMB: +(pageHeap.usedSize / 1048576).toFixed(2), workerMB: workerMB && +workerMB.toFixed(2), domNodes: nodes };
}
