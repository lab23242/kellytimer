# Decisions

Judgement calls made while building kellytimer, grouped by area. Numbers come from the runs described at the end.

## Environment

- **Built and verified on Windows 10 (x64), not Linux.** The machine available for this pass was Windows, so `tauri dev` was run natively on Windows (WebView2), the target platform. **The Linux `tauri dev` loop (webkit2gtk) has not been run.** The code avoids the APIs WebKitGTK lacks (`requestIdleCallback` has a fallback, no OffscreenCanvas). CI runs `cargo check`/`clippy` on Ubuntu with the Linux dependencies, so the Linux build is compiled on every push, but not launched.
- **Plain JavaScript with JSDoc, no TypeScript.** The brief allowed either. Skipping the TypeScript build step keeps the toolchain to Vite only, and the core modules are small and fully unit-tested.

## Landscape engine

- **Wrap, don't rewrite.** `scripts/extract-upstream.mjs` copies upstream's generator verbatim into a factory function. The only textual addition is a `var` line for 5 implicit globals (found with ESLint `no-undef`), needed because ES modules are strict. Upstream's `Math.random` override and `console.log` calls hit private objects passed as parameters. Re-running the extraction gives byte-identical output.
- **Per-chunk reseeding.** Upstream draws everything from one PRNG in left-to-right order, so chunk N depends on all earlier chunks. To resume mid-day and drop/regenerate chunks freely, the wrapper reseeds upstream's own PRNG with `seed#k` at the start of chunk k. The Perlin table is seeded once from the day seed, so the terrain stays continuous. Upstream's `MEM.planmtx` entries ahead of the current chunk are always `NaN` and then reset to 0 in upstream itself, so resetting it per chunk is equivalent. Trade-off: a given seed draws a different landscape than upstream's `?seed=` page.
- **Upstream's chunkloader is reused verbatim** by setting `MEM.xmin = -Infinity` and `MEM.xmax = k·512`, so it plans exactly one chunk.
- **Determinism is per JavaScript engine.** `Math.sin/cos/atan2/pow` are not bit-exact across engines by spec, so V8 (Windows, WebView2) and JavaScriptCore (Linux dev) can differ slightly for the same seed. Within one engine, output is byte-identical (tested).
- **World units.** Chunk width 512 (upstream `MEM.cwid`). Visible height 700.5 (upstream's `viewBox` height, `800 / 1.142`), scaled to the window height.
- **Reach margins.** Elements generated for a chunk spill past its edges (mountains are offset ±500, distant ranges are up to 1500 long). `scripts/measure-reach.mjs` measured at most 1040 units left and 1503 right over 400 chunks. The engine uses 1300 left / 1800 right and picks elements by their measured polyline extents, so tile edges are seamless.
- **Paper texture** is upstream's own (`bgcanv` script, ported to `paintPaper(ctx)`), with a fixed seed so the paper is the same every day.

## Rendering and performance

- **Generation in a Web Worker** rather than `requestIdleCallback` on the main thread. A chunk takes 108 ms on average and up to 957 ms (Node, i9-10900F), and a synchronous 100–400 ms task inside an idle callback still blocks the main thread. The worker keeps it off the UI thread entirely. If a worker can't be created, generation falls back to idle callbacks (`setTimeout` where `requestIdleCallback` is missing). Rasterisation (drawing the decoded SVG onto the canvas) runs in an idle callback, never in an animation frame.
- **Rasterised canvas tiles vs live SVG: kept canvas.** Measured in the real app (WebView2 157, debug Rust build, 340×200 window at 100% scaling, i9-10900F with 20 logical cores) as CPU time of the whole process tree (kellytimer.exe + 6 WebView2 processes) while a focus session runs:

  | run (60 s unless noted) | % of one core | % of machine |
  |---|---|---|
  | paused (baseline) | 0.13 | 0.01 |
  | canvas, real speed | 1.41; 0.25 and 0.39 (120 s) | 0.01–0.07 |
  | live SVG, real speed | 0.41; 1.06 and 0.31 (120 s) | 0.02–0.05 |
  | canvas, 10× speed | 4.30 | 0.21 |
  | live SVG, 10× speed | 5.24 | 0.26 |

  At real speed the two are within measurement noise of each other (0.25–1.41% of one core), and both are far under the 3% target. With more motion and generation (10×), canvas is about 18% cheaper. The deciding factor is the DOM: a live-SVG strip keeps about 62,000 `<polyline>` nodes (18 MB of markup for 7 tiles), against 7 canvases. Raw data: `bench/bench-5runs.json`, `bench/bench-alternating.json`. A mid-range 4–8 core laptop will show a larger per-machine share than this desktop, but the per-core figure is the one to compare against.
- **The paper is baked into each tile with `multiply`.** Upstream draws its SVG with `mix-blend-mode: multiply` because mountains use white fills to hide what's behind them. Multiplying onto the paper reproduces that, and opaque tiles are cheaper to composite. The paper pattern is aligned to the whole strip, so tile edges don't show.
- **Scroll speed: 48 chunks per focus session** (changed from the brief's example of 3 after the first look: 3 chunks moved under 0.3 px/s, which nobody could see). 48 chunks in 25 minutes is about 4.7 px/s in the small window: a calm pan you can see. The Settings speed slider (0.25×–4×) scales it. Breaks still drift at 4% of focus speed.
- **Smooth motion paced by speed.** A timer moves the strip with a sub-pixel `translate3d` (no re-rasterising) at most 0.4 CSS px per update, so the frame rate follows the speed. That is about 12 updates/s by default, between 2 and 30. When the strip stops, it snaps to whole device pixels so the painting is crisp. Tiles overlap by 2 device px so no seam shows at sub-pixel offsets. Measured in the real app (WebView2, 120 s runs, same machine as below):

  | motion method at default speed | % of one core |
  |---|---|
  | continuous 60 fps Web Animation (compositor) | 15.9 |
  | Web Animation with `steps()` capped at 6 / 12 / 20 / 30 fps | 5.4 / 8.1 / 5.1 / 5.9 |
  | JS timer at fixed 10 / 15 / 24 fps | 3.1 / 5.5 / 7.0 |
  | **chosen: JS timer paced by speed (≈12 fps)** | **3.7, 3.4** |
  | same at 10× speed (30 fps cap, plus heavy tile generation) | 6.8 |
  | paused | 0.25 |

  A compositor animation ticks on every vsync even when its stepped value doesn't change, so capping its frame rate saved little. A plain timer does no work between updates, and the cost tracks the update rate (about 0.3% of a core per update per second). On this 20-thread desktop the chosen version is under 0.2% of the machine. On a 4-core/8-thread laptop expect roughly 1–2% in Task Manager, still under the 3% target. Raw data: `bench/bench-motion.json`. The original pixel-stepping numbers below are from the first, much slower speed.
- **Bounded memory:** at most 12 tiles in the DOM (1 behind, 1.25 viewports ahead), and at most 12 chunks cached in the worker. Chunks that can no longer reach the view are dropped as it advances. Canvas backing stores are released (`width = 0`) when a tile is removed.
- **Hidden means idle:** on `visibilitychange` or the Rust `visibility` event (tray hide/show), the loop stops and no tiles are generated. Rust's alarm wakes the page at the phase end.

## Timer

- **Everything derives from timestamps.** `endsAt` is stored, remaining time is `endsAt - now`, and the scroll position is `anchor + speed × elapsed`.
- **Rust schedules the phase end too.** It waits in ≤5 s slices against the wall clock (a single long monotonic sleep may not count suspended time), so a laptop that slept is noticed within 5 s of waking.
- **Stale threshold: 90 s.** A phase that ended more than 90 s before it was noticed (sleep, app closed) is shown as finished: no toast, no chime, no pulse, and auto-start does not chain off it. Exactly one end event per phase (tested).
- **Alarms that are already due are never cancelled** (1.5 s grace). The page sometimes notices the end a few ms before Rust and reschedules for the next phase, and the chime must still play. Rescheduling the same end time is de-duplicated.
- **Auto-start chains from the exact end time**, not from when the tick happened, so the cadence doesn't drift.
- **Without auto-start, a finished phase waits.** It shows "Focus done. Click for a short break." The seal is stamped when the focus session ends, not when the next one starts.
- **Skip** moves to the next phase (and keeps running if it was running). A skipped focus session advances the long-break cadence but earns no seal: you get the break that was due, but the seal only marks finished work.
- **Reset** ("start this part again") puts the current phase back to full length. The scroll does not jump backwards; it continues from where it is.
- **Changing durations** applies to a phase that hasn't started. A running or paused phase keeps its length.
- **New day at local midnight:** new seed, journey restarts at x = 0, seals and the long-break cycle reset. A session running across midnight carries on.
- **Seed** = `shanshui:YYYY-MM-DD` (local date).

## Window and OS integration

- **No `data-tauri-drag-region`.** That attribute starts the OS drag on mousedown, which swallows clicks on the time, and maps double-click to maximise. Instead, a drag starts after the mouse moves 4 px with the button down (`startDragging()`), so click (start/pause) and double-click (compact mode) both work. A single click on the time waits 260 ms to make sure it isn't a double-click.
- **Window operations live in Rust commands** (`set_window_size`, `snap_to_corner`, `set_always_on_top`, `hide_to_tray`, …). App commands need no capability entries, and doing the maths with the real monitor work area in Rust is simpler. The capability file still grants the window permissions the brief listed (`start-dragging`, `set-position`, `set-size`, `set-always-on-top`, `hide`, `show`, `set-focus`) plus each plugin's. Only `start-dragging`, the store and autostart are actually called from JS.
- **The window starts hidden.** Rust reads the size preset from the store, restores the saved position (window-state, position only) or, on first launch or if the saved spot is off every screen, places it bottom-right of the primary monitor's work area with a 16 logical px margin. Then it shows the window, so nothing flashes in the wrong place.
- **Resizing keeps the nearest corner fixed**, so a timer in the bottom-right grows up and to the left. The result is clamped to the work area.
- **Position is saved** 800 ms after a drag ends, on hide and on quit.
- **Size presets:** Small 340×200, Medium 420×248, Large 520×306 (logical px, same 1.7:1 shape). Compact 156×60. Compact mode is remembered.
- **× and "tuck away" both hide to the tray.** With `skipTaskbar` there is no taskbar button to return to, so both lead to the tray. × also shows a one-time toast ("kellytimer is still running…"). A tooltip can't be shown from a hidden window, so the notice is a toast. Alt+F4 does the same. **Quit** (tray menu or the bottom of Settings) really exits.
- **The tray icon's left click toggles the window.** Right click opens the menu: Show / hide, Start/Pause (label follows the state), Skip to next, Settings, Quit. The tooltip shows the phase and its end time, which only changes on transitions, so it is never refreshed per second.
- **Chimes are played by Rust (rodio)**, not the webview, so they sound on time even if WebView2 is throttled. The WAVs are embedded in the binary. Linux needs `libasound2-dev` to build. The toast is marked silent so the chime is the only sound. When "Silent" is on there is no sound at all.
- **Sounds are self-synthesised** (`scripts/make-sounds.mjs`, CC0): singing bowl (inharmonic beating partials), plucked string (qin-like, with a pluck-position notch and slight vibrato) and small bell. Peaks are normalised to −6 dBFS so nothing startles.
- **Phase-end pulse:** two slow breaths of cinnabar at the paper's edge over 2.6 s. It doesn't flash the window or move it.
- **Single store file** `kellytimer.json` (app data folder), shared by Rust and JS.
- **Content Security Policy** is restrictive: self-hosted scripts and fonts, `blob:` images for tile rasterising, no remote origins.

## Look and feel

- **Concept: the time is the painting's inscription.** It sits top-left in the sky, where painters leave paper bare for a poem, on a soft paper wash for legibility. Each finished focus session is a small cinnabar seal stamped after it, the way inscriptions are signed. The painting's paper texture is the window background.
- **Palette** from the painting and its pigments, darkened after the first look for contrast: old-scroll paper (upstream's texture multiplied by `rgb(247 229 184)`, about `#E8CD93`), ink `#1C1916`, wash `#4F483E`, cinnabar `#A92F24` (focus progress, seals, toggles), and indigo wash `#2F3D4A` (huaqing, the blue-grey used for distance) for the time during breaks. Breaks also raise a mist of paper colour over the painting. The scroll edge has a browned inner vignette instead of a border.
- **Darker landscape lines:** when a tile is rasterised, the ink layer is multiplied over the paper twice instead of once. Upstream's light grey strokes get darker (value → value²), while its white occluding fills stay white, so the paper still shows through them. This costs nothing at run time because each tile is drawn once.
- **Type:** Cormorant Garamond 600 (lining, tabular figures; 600 rather than 500 for contrast on the yellow paper) for the time; EB Garamond for labels and settings, in sentence case and italic for secondary text. Both are bundled (SIL OFL).
- **Settings toggles are seals:** an empty frame when off, stamped cinnabar when on.
- **Plain English everywhere:** "See-through" (not opacity), "Stay in front of other windows", "Start the next part by itself", "Start today's journey again" (asks for a second click before acting).
- **Settings scroll inside the window** rather than growing it, so the timer never jumps around the screen.
- **Icon:** an ink mountain and water lines carved into a vermilion seal, drawn as SVG and converted with `tauri icon`. The SVG's turbulence filter was dropped because the icon rasteriser (resvg) renders it as noise.

## Build and release

- **Name: kellytimer** (lowercase, as requested; renamed from the working title "Shanshui"). It applies to the product name, window title, tray, toasts, installer, `.exe` (`kellytimer.exe`, Cargo package `kellytimer`), store file (`kellytimer.json`) and identifier (`app.kellytimer`, so its data lives in `%APPDATA%pp.kellytimer`). Internal names that nobody sees (the landscape seed prefix `shanshui:`, log prefixes, the `src/shanshui/` folder) were kept, so each day's painting is unchanged.
- **Desktop shortcut:** Tauri's NSIS installer already ends with a "Create desktop shortcut" checkbox (ticked by default) next to "Run kellytimer". A Start menu shortcut is always created. No custom installer script was needed.

- **Version is single-sourced** from `package.json` (`tauri.conf.json` has `"version": "../package.json"`). `Cargo.toml` still needs a manual bump; it doesn't affect the installer name.
- **Bundle targets** are `"all"` in the config, so local Linux builds still produce .deb/.AppImage. The release workflow passes `--bundles nsis`, so the release gets only the per-user NSIS installer.
- **Release workflow** runs the unit tests before building, caches npm (`setup-node`) and Rust (`Swatinem/rust-cache`), and creates a draft release.
- **CI uses Node 24 (npm 11).** The lockfile is written by npm 11, and npm 10 (Node 22) rejects it as out of sync over optional `@emnapi` packages. The first tagged run failed on exactly that.
- **CI** runs lint + tests + build, plus `cargo check` and `cargo clippy -D warnings`, on Ubuntu (cheaper and faster than Windows runners). The Rust job uses a placeholder `dist/` because `generate_context!` needs it to exist.
- **Vendored upstream has no nested `.git`** (it would become a broken submodule). The upstream commit is recorded in `vendor/shan-shui-inf/UPSTREAM_COMMIT`.
- **Licence note:** upstream's Perlin noise is adapted from p5.js, which is LGPL-2.1. Shipping it as readable JavaScript inside the app satisfies the usual reading of the LGPL for interpreted code, but it's flagged here in case that matters for distribution.

## Verification runs

All run on Windows 10 22H2 (x64), WebView2 157, on 2026-11-23.

- `npm run lint`, `npm test` (29 tests: timer state machine, journey maths, engine determinism), `npm run build`, `cargo check`, `cargo clippy -- -D warnings`: all pass.
- **`tauri dev` on Windows:** the window opens bottom-right of the work area, 16 px above the taskbar, with transparent rounded corners and no border (checked with a screen capture). The landscape renders and the timer runs. The store file is written.
- **Rust alarm end to end** (`scripts/check-alarm.mjs`): fired 99 ms after the phase end, not stale, with no notification or sound errors.
- **Soak** (`scripts/soak.mjs`, in the real app over CDP): 10 real minutes at 60× speed, i.e. 10 hours of app time, with auto-start: about 18 focus sessions (4.6 full cycles with long breaks) and 63 tiles generated. Sampled every 30 s after a forced GC:

  | | first | last | max |
  |---|---|---|---|
  | DOM tiles | 0 (loading) | 7 | 7 |
  | worker chunk cache | 8 | 12 | 12 |
  | page JS heap | 7.5 MB (startup) | 2.83 MB | 7.5 MB |
  | worker JS heap | 11.8 MB | 20.6 MB | 29.1 MB |

  The page heap is flat at 2.8 MB from the second sample onwards. The worker heap moves between 14 and 29 MB with the size of the 12 cached chunks (about 2 MB of SVG each), with no upward trend. Raw data: `bench/soak-results.json`.
- **NSIS bundle:** `npx tauri build --bundles nsis` built `kellytimer_0.1.0_x64-setup.exe` (3.3 MB). The generated `installer.nsi` has `INSTALLMODE "currentUser"`, so `RequestExecutionLevel user` (no UAC prompt), installs to `$LOCALAPPDATA\kellytimer`, and has `INSTALLWEBVIEW2MODE "downloadBootstrapper"`. The release `kellytimer.exe` (6.3 MB) was launched: it loads under the production CSP with no console errors or CSP violations, the worker and both fonts load, tiles render, and the tray icon appears. The installer itself was not run, to avoid installing onto the development machine.
- **Workflow YAML** parses (PyYAML), and every step has exactly one of `uses`/`run`. It has not run on GitHub yet: there is no repository/remote in this folder.
- **Code review pass** (independent reviewer agent) found 5 issues; all fixed and re-verified (lint, tests, build, clippy):
  1. `loop()` called from the alarm event could leave an orphaned wake-up timer behind, so chains piled up with each phase end. It now clears the pending timer first.
  2. Rust ignored compact mode when placing the window at startup, so saved positions drifted. It now sizes from the `compact` flag.
  3. An emptied number field silently saved the minimum. It is now restored, and clamped values are shown.
  4. Pause/skip/reset in the last 1.5 s still chimed. `cancel_alarm` now aborts everything; only rescheduling keeps the grace period.
  5. A slow double-click (slower than 260 ms but within the OS limit) also toggled the timer. The toggle is now undone.
- **Not verified here:** the Linux `tauri dev` loop, Windows 11 specifics, display scaling above 100%, multi-monitor, sleep/resume on a real laptop, Focus Assist. See the manual checklist at the end of README.md.
