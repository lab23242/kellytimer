# Shanshui

A small, frameless Pomodoro timer for Windows 11. Behind the time, an endless procedural shan-shui (山水) landscape from [shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) scrolls slowly while you focus. Each focus session travels exactly three landscape chunks. Each day has its own painting, and today's journey picks up where you left it.

End-user install instructions are in [INSTALL.md](INSTALL.md). Every judgement call made while building it is in [DECISIONS.md](DECISIONS.md).

## Architecture

```
index.html, src/styles.css      the window: painting, inscription (time + seals), controls
src/main.js                     app controller: state, loop, wiring
src/core/                       pure logic, unit-tested
  timer.js                        Pomodoro state machine (timestamp based, never counts ticks)
  journey.js                      scroll position derived from the timer (no frame accumulation)
  settings.js                     defaults, validation, size presets
  clock.js                        time source (+ debug time scale), day key, daily seed
src/shanshui/
  upstream.js                     GENERATED: upstream generator, verbatim, wrapped in a factory
  engine.js                       clean API: createLandscape({seed}).renderRange(x0, x1)
src/render/
  tile-worker.js                  generates tile SVG off the main thread
  scroller.js                     rasterises tiles to canvases, moves the strip, drops old tiles
src/platform/bridge.js          Tauri commands/plugins, with browser fallbacks
src/ui/                         settings sheet, mouse handling, icons
src-tauri/src/
  lib.rs                          setup, commands, window events, single instance
  alarm.rs                        phase-end alarm in Rust: toast + chime even if the webview sleeps
  sound.rs                        chimes via rodio (WAVs embedded in the binary)
  layout.rs                       presets, work-area placement, corner snapping, anchored resize
  tray.rs                         tray icon and menu
```

**Data flow.** The timer is a pure state machine: `{phase, status, endsAt, remainingMs, …}`. Remaining time is always `endsAt - now`. The scroll position is `journey.anchor + speed(phase) × elapsed`, so it is also derived, never accumulated. Every transition re-anchors the journey (`carry`), so skip, reset, phase change and speed change never make the painting jump. State is saved to the store file (`shanshui.json` in the app data folder) on every transition.

**Timing.** When a phase starts, the frontend asks Rust to `schedule_alarm` at the real wall-clock end time. Rust waits in 5-second slices against the system clock. At the end it shows the toast, plays the chime and emits `alarm`. If the end is more than 90 s in the past (the laptop slept), it stays silent and the UI just shows the phase as finished. While the window is visible, the frontend wakes only when the displayed second changes or the painting moves one device pixel. While it is hidden it does no work at all.

**Rendering.** See DECISIONS.md for the benchmark. In short: the worker generates a tile's SVG, the main thread decodes it as an image and, in idle time, draws it once onto an opaque canvas with the paper texture multiplied underneath. The strip of canvases moves with `translate3d`, snapped to whole device pixels. At most 12 tiles exist, and the worker caches at most 12 chunks.

## The shan-shui wrapper

- `vendor/shan-shui-inf/` is the untouched upstream repo (MIT, commit in `UPSTREAM_COMMIT`).
- `scripts/extract-upstream.mjs` (`npm run extract`) copies the generator `<script>` blocks verbatim into `src/shanshui/upstream.js`, inside `createUpstream(Math, window, console)`. It's deterministic: re-running it gives byte-identical output.
- **What changed from upstream:**
  1. Only the generator is kept. Dropped: URL `?seed=` parsing, the SVG download button, the settings/scroll UI, the mouse tracking and `update()`/`viewupdate()` DOM code.
  2. One added line declares upstream's implicit globals (`MEM, reso, vtxlist, vtxlist0, vtxlist1`) so the code runs as a strict ES module.
  3. `Math`, `window` and `console` are factory parameters. Upstream's `Math.random = Prng.next` override lands on a private object, `console.log` is silenced, and nothing leaks.
  4. `engine.js` reseeds upstream's PRNG at the start of every chunk from `seed#chunkIndex`, and resets `MEM.planmtx` per chunk. This makes any chunk reproducible on its own (resume mid-day, drop and regenerate). The Perlin table is seeded once per landscape, so terrain is continuous across chunks. As a result a given seed draws a different (but equally valid) landscape than upstream's `?seed=` page.
  5. The paper texture (upstream's trailing `<canvas id="bgcanv">` script) is ported to `engine.paintPaper(ctx)`.

## Developing on Linux

Prerequisites: Node 20+, Rust stable and Tauri's Linux deps:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libasound2-dev
```

Then:

```bash
npm install
```

```bash
npm run tauri dev
```

`npm run dev` alone runs the frontend in a browser at http://localhost:1420. Tauri-only features become no-ops there, and the chime plays through `<audio>`.

Useful debug flags (URL query, or `VITE_SHANSHUI_DEBUG` for `tauri dev`), see `src/debug.js`:

```bash
VITE_SHANSHUI_DEBUG="timescale=60&autostart=1&soaklog=30000" npm run tauri dev
```

`timescale=60` makes one minute pass per second and disables saving. `quiet=1` silences chimes and toasts. `render=svg` switches to live-SVG tiles for comparison.

Checks:

```bash
npm run lint && npm test && npm run build
```

```bash
cd src-tauri && cargo check && cargo clippy -- -D warnings
```

Benchmark and soak (attach to the app over the DevTools protocol; on Windows start the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`; on Linux run `npm run dev` and open it in Chrome started with `--remote-debugging-port=9222`):

```bash
npm run bench
```

```bash
npm run soak
```

Results go to `bench/`. Other scripts: `npm run sounds` regenerates the chimes; `node scripts/measure-reach.mjs` measures how far landscape elements spill past chunk edges; `npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons` regenerates the icon set.

## Cutting a release

1. Bump `version` in `package.json` and in `src-tauri/Cargo.toml` (`tauri.conf.json` reads it from `package.json`).
2. Commit, then tag and push:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

3. The **Release** workflow builds on `windows-latest` and creates a **draft** GitHub release with `Shanshui_<version>_x64-setup.exe` attached. Check it, then click **Publish**. Send people the release page link plus INSTALL.md.

The installer is unsigned on purpose. It installs per-user (`installMode: currentUser`, no UAC prompt) and downloads the WebView2 bootstrapper only if WebView2 is missing (Windows 11 always has it).

## Manual Windows test checklist (about 5 minutes)

Things that can't be verified on Linux. Items marked ✓ were checked on Windows 10 during development (see DECISIONS.md), but should still be confirmed on Windows 11.

1. **Install:** run the `-setup.exe`. Expect SmartScreen's **More info → Run anyway**, no UAC/admin prompt, and the install folder under `%LOCALAPPDATA%\Shanshui`.
2. **First placement:** the timer appears bottom-right, 16 px above the taskbar. Repeat at 125% and 150% display scaling (Settings → Display → Scale); it should still sit 16 px from the edges and be the same physical size relative to text. ✓ (100%)
3. **Window looks:** rounded corners with nothing showing outside them, no 1 px border, no shadow, no taskbar button. ✓ (Win10)
4. **Drag** the painting to move it. Click the time: it starts and pauses. Double-click: compact time-only view, and double-click again to return. Hover: controls fade in. ✓ (in browser)
5. **Position memory:** move it, Quit from the tray, start again. It reopens where you left it. Unplug or turn off a second monitor it was on: it comes back bottom-right on the main screen.
6. **Size presets / corners:** Settings → Size Medium/Large: it grows away from its corner and stays on screen. "Move to a corner": all four corners land 16 px from the work area.
7. **Tray:** the red seal icon is behind the ^ arrow ✓ (Win10). × hides it, and the first time a toast says it's still running. The tray icon (via ^) left-click toggles the window. The menu items Start/Pause, Skip, Settings and Quit all work. Quit really exits (check Task Manager).
8. **Single instance:** with it hidden, launch it again from the Start menu. The existing window comes back, with no second copy.
9. **Toast + chime:** set Focus length to 1 min, start, hide the window. After a minute a toast appears and the chime plays. With Focus Assist / Do Not Disturb on, the chime still plays.
10. **Sleep:** start a 1-minute focus, put the laptop to sleep for 3+ minutes, wake it. The timer shows "Focus done…", with no burst of toasts or chimes.
11. **Always on top / opacity / start with Windows:** toggle each in Settings. For "Open when Windows starts", sign out and back in.
12. **Uninstall** from Settings → Apps → Installed apps. It goes away cleanly.
13. **CPU:** leave it running a focus session and check Task Manager. Shanshui plus its "Microsoft Edge WebView2" children should average well under 3%.
