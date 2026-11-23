// App controller: owns the settings, timer and journey state, wires them to the view,
// the landscape scroller and the OS bridge.
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "./styles.css";

import { debug, startSoakLog } from "./debug.js";
import { createClock, seedForDay } from "./core/clock.js";
import { COMPACT_SIZE, SIZE_PRESETS, normalizeSettings } from "./core/settings.js";
import * as T from "./core/timer.js";
import { carry, createJourney, phaseSpeed, position } from "./core/journey.js";
import * as os from "./platform/bridge.js";
import { createScroller, makePaper } from "./render/scroller.js";
import { icons } from "./ui/icons.js";
import { attachPointer } from "./ui/pointer.js";
import { createSettingsPanel } from "./ui/settings-panel.js";

const HEARTBEAT_MS = 30_000;
const PULSE_MS = 2600;
const MAX_SEALS = 12;
const MIN_FRAME_MS = 16;

const clock = createClock({ scale: debug.timescale });
const $ = (id) => document.getElementById(id);
const frame = $("frame");
const timeEl = $("time");
const phaseEl = $("phase");
const sealsEl = $("seals");
const progressEl = $("progress-bar");
const playBtn = $("btn-play");

let store;
let settings;
let timer;
let journey;
let scroller;
let panel;
const ui = { compact: false, visible: !document.hidden };
let loopTimer = null;
let pulseTimer = null;
const shown = { time: "", phase: "", seals: -1, progress: -1, playing: null };

// --- helpers ---------------------------------------------------------------------------

function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${String(m).padStart(2, "0")}:${s}`;
}

function clockTime(appMs) {
  return new Date(clock.toReal(appMs)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const breakName = (phase) => T.PHASE_LABELS[phase].toLowerCase();

function statusText() {
  const label = T.PHASE_LABELS[timer.phase];
  switch (timer.status) {
    case "running":
      return label;
    case "paused":
      return `${label}, paused`;
    case "finished":
      return timer.phase === "focus"
        ? `Focus done. Click for a ${breakName(timer.pendingNext)}.`
        : "Break over. Click to focus again.";
    default:
      return `${label}. Click the time to start.`;
  }
}

function validTimer(t) {
  return (
    t &&
    Object.hasOwn(T.PHASE_LABELS, t.phase) &&
    ["idle", "running", "paused", "finished"].includes(t.status) &&
    [t.durationMs, t.remainingMs, t.cycle, t.todayCount].every(Number.isFinite) &&
    (t.status !== "running" || Number.isFinite(t.endsAt))
  );
}

// --- state changes ---------------------------------------------------------------------

function persistToday() {
  store.set("today", { day: timer.day, timer, journey });
}

/** Apply a timer transition, keeping the scroll continuous. */
function apply(fn, { userAction = true } = {}) {
  const now = clock.now();
  const next = fn(timer, now);
  if (next === timer) return;
  journey = carry(journey, { timer, settings }, { timer: next, settings }, now);
  timer = next;
  afterTimerChange(userAction);
}

function afterTimerChange(userAction) {
  persistToday();
  syncAlarm(userAction);
  syncTray();
  render();
  schedule();
}

function alarmText() {
  if (timer.phase === "focus") {
    const next = T.nextPhase("focus", timer.cycle + 1, settings);
    return {
      title: "Focus session complete",
      body: next === "longBreak" ? "Time for a long break. Well done." : "Time for a short break.",
    };
  }
  return {
    title: "Break’s over",
    body: settings.autoStart ? "The next focus session has started." : "Ready to focus again when you are.",
  };
}

function syncAlarm(userAction) {
  if (debug.quiet) return;
  if (timer.status === "running") {
    os.scheduleAlarm({
      endsAtMs: clock.toReal(timer.endsAt),
      ...alarmText(),
      sound: settings.muted ? null : settings.sound,
      volume: settings.volume,
    });
  } else if (userAction) {
    // A natural phase end leaves the alarm alone: it is about to fire (or just did).
    os.cancelAlarm();
  }
}

function syncTray() {
  const label = T.PHASE_LABELS[timer.phase];
  let tip = "Shanshui";
  if (timer.status === "running") tip = `Shanshui: ${label} until ${clockTime(timer.endsAt)}`;
  else if (timer.status === "paused") tip = `Shanshui: ${label} paused, ${formatTime(timer.remainingMs)} left`;
  else if (timer.status === "finished") tip = `Shanshui: ${label} done`;
  os.updateTray(tip, timer.status === "running");
}

function onPhaseEnded(ended) {
  if (ended.stale) return; // slept past the end: just show it as finished, no fanfare
  pulse();
  // Inside Tauri the Rust alarm plays the chime and shows the toast.
  if (!os.isTauri && !settings.muted && !debug.quiet) os.playSound(settings.sound, settings.volume);
}

function pulse() {
  clearTimeout(pulseTimer);
  frame.classList.remove("pulse");
  void frame.offsetWidth; // restart the animation
  frame.classList.add("pulse");
  pulseTimer = setTimeout(() => frame.classList.remove("pulse"), PULSE_MS);
}

function rollover(now) {
  const day = clock.day();
  if (day === timer.day) return;
  const elapsed = T.elapsedMs(timer, now);
  timer = T.rollDay(timer, day);
  // new day, new landscape: start it at x = 0 from this moment
  journey = { ...createJourney(day), anchor: -phaseSpeed(timer.phase, settings) * elapsed };
  scroller.setSeed(seedForDay(day));
  persistToday();
}

// --- loop ------------------------------------------------------------------------------

function loop() {
  // loop() is also called directly (alarm event, becoming visible, boot): drop any
  // pending wake-up so there is only ever one chain.
  clearTimeout(loopTimer);
  loopTimer = null;
  const now = clock.now();
  rollover(now);
  const { state, ended } = T.tick(timer, settings, now);
  if (ended) {
    journey = carry(journey, { timer, settings }, { timer: state, settings }, now);
    timer = state;
    onPhaseEnded(ended);
    afterTimerChange(false);
    return;
  }
  render(now);
  schedule();
}

/** Next wake-up: when the shown second changes (the compositor animates the scroll). */
function schedule() {
  clearTimeout(loopTimer);
  loopTimer = null;
  if (!ui.visible) return; // the Rust alarm (or becoming visible) wakes us
  if (timer.status !== "running") {
    loopTimer = setTimeout(loop, HEARTBEAT_MS);
    return;
  }
  const now = clock.now();
  const remaining = T.remainingMs(timer, now);
  const wait = Math.min(((remaining - 1) % 1000) + 1, remaining); // until the displayed second changes
  loopTimer = setTimeout(loop, Math.max(MIN_FRAME_MS, wait / clock.scale));
}

// --- view ------------------------------------------------------------------------------

function render(now = clock.now()) {
  const time = formatTime(T.remainingMs(timer, now));
  if (time !== shown.time) timeEl.textContent = shown.time = time;
  const phase = statusText();
  if (phase !== shown.phase) phaseEl.textContent = shown.phase = phase;

  frame.dataset.phase = timer.phase === "focus" ? "focus" : "break";
  frame.dataset.status = timer.status;

  const p = Math.round(T.progress(timer, now) * 1000) / 1000;
  if (p !== shown.progress) {
    shown.progress = p;
    progressEl.style.transform = `scaleX(${p})`;
  }

  if (timer.todayCount !== shown.seals) {
    shown.seals = timer.todayCount;
    const n = Math.min(timer.todayCount, MAX_SEALS);
    sealsEl.replaceChildren(...Array.from({ length: n }, () => Object.assign(document.createElement("i"), { className: "seal" })));
    if (timer.todayCount > MAX_SEALS) sealsEl.append(Object.assign(document.createElement("span"), { textContent: `×${timer.todayCount}` }));
    const word = timer.todayCount === 1 ? "session" : "sessions";
    sealsEl.setAttribute("aria-label", `${timer.todayCount} focus ${word} today`);
    sealsEl.title = `${timer.todayCount} focus ${word} today`;
  }

  const playing = timer.status === "running";
  if (playing !== shown.playing) {
    shown.playing = playing;
    playBtn.innerHTML = playing ? icons.pause : icons.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Start");
    playBtn.title = playing ? "Pause" : "Start";
  }

  // world units per real millisecond (app time may run faster in debug mode)
  const speed = timer.status === "running" ? phaseSpeed(timer.phase, settings) * clock.scale : 0;
  scroller.setMotion(position(journey, timer, settings, now), speed);
}

function applyWindowSize() {
  const size = ui.compact ? COMPACT_SIZE : SIZE_PRESETS[settings.windowSize];
  frame.style.setProperty("--win-w", `${size.width}px`);
  frame.style.setProperty("--win-h", `${size.height}px`);
  os.setWindowSize(size.width, size.height);
}

function setCompact(on) {
  ui.compact = on;
  frame.classList.toggle("compact", on);
  if (on) panel.close();
  scroller.setActive(ui.visible && !on);
  store.set("compact", on);
  applyWindowSize();
  render();
  schedule();
}

function setVisible(visible) {
  if (ui.visible === visible) return;
  ui.visible = visible;
  scroller.setActive(visible && !ui.compact);
  if (visible) loop();
  else {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}

function toggleSettings(force) {
  const open = force ?? !panel.isOpen();
  if (open) {
    if (ui.compact) setCompact(false);
    panel.sync(settings);
    panel.open();
  } else panel.close();
}

async function changeSettings(patch) {
  const now = clock.now();
  const next = normalizeSettings({ ...settings, ...patch });
  const nextTimer = T.applySettings(timer, next);
  journey = carry(journey, { timer, settings }, { timer: nextTimer, settings: next }, now);
  settings = next;
  timer = nextTimer;
  store.set("settings", settings);
  if ("windowSize" in patch && !ui.compact) applyWindowSize();
  if ("alwaysOnTop" in patch) os.setAlwaysOnTop(settings.alwaysOnTop);
  if ("startWithWindows" in patch) await os.setAutostart(settings.startWithWindows);
  if ("opacity" in patch) frame.style.opacity = settings.opacity;
  afterTimerChange(false);
}

function onAction(name, arg) {
  switch (name) {
    case "preview-sound":
      os.playSound(settings.sound, settings.volume);
      break;
    case "reset-journey":
      timer = T.createTimer(settings, clock.day());
      journey = createJourney(timer.day);
      afterTimerChange(true);
      break;
    case "snap":
      os.snapToCorner(arg);
      break;
    case "quit":
      persistToday();
      os.quitApp();
      break;
    default:
      console.warn(`shanshui: unknown action ${name}`);
  }
}

// --- boot ------------------------------------------------------------------------------

async function boot() {
  store = await os.openStore({ persist: debug.persist });
  settings = normalizeSettings(await store.get("settings"));
  if (debug.autostart) settings = { ...settings, autoStart: true };
  const autostartOn = await os.getAutostart();
  if (os.isTauri && autostartOn !== settings.startWithWindows) settings = { ...settings, startWithWindows: autostartOn };

  const day = clock.day();
  const today = await store.get("today");
  if (today?.day === day && validTimer(today.timer)) {
    timer = today.timer;
    journey = { day, anchor: Number.isFinite(today.journey?.anchor) ? today.journey.anchor : 0 };
  } else {
    timer = T.createTimer(settings, day);
    journey = createJourney(day);
  }
  ui.compact = (await store.get("compact")) === true;

  if (!os.isTauri) document.body.classList.add("browser");
  frame.style.opacity = settings.opacity;
  for (const [id, icon] of Object.entries({ "btn-skip": icons.skip, "btn-reset": icons.reset, "btn-settings": icons.settings, "btn-hide": icons.hide, "btn-close": icons.close })) {
    $(id).innerHTML = icon;
  }

  const paper = makePaper();
  document.documentElement.style.setProperty("--paper", `url(${paper.toDataURL()})`);
  scroller = createScroller({ host: $("landscape"), paper, mode: debug.render, fps: debug.fps });
  scroller.setSeed(seedForDay(day));
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) {
      scroller.setViewport(width, height);
      render();
      schedule();
    }
  }).observe($("landscape"));

  panel = createSettingsPanel({ onChange: changeSettings, onAction, onClose: () => toggleSettings(false), version: __APP_VERSION__ });
  frame.append(panel.root);

  attachPointer(frame, {
    timeEl,
    onTimeClick: () => apply((t, now) => T.toggle(t, settings, now)),
    onDoubleClick: () => setCompact(!ui.compact),
  });
  playBtn.addEventListener("click", () => apply((t, now) => T.toggle(t, settings, now)));
  $("btn-skip").addEventListener("click", () => apply((t, now) => T.skip(t, settings, now)));
  $("btn-reset").addEventListener("click", () => apply((t) => T.reset(t, settings)));
  $("btn-settings").addEventListener("click", () => toggleSettings());
  $("btn-hide").addEventListener("click", () => os.hideToTray(false));
  $("btn-close").addEventListener("click", () => os.hideToTray(true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.isOpen()) toggleSettings(false);
  });

  document.addEventListener("visibilitychange", () => setVisible(!document.hidden));
  await os.onEvent("visibility", (visible) => setVisible(Boolean(visible)));
  await os.onEvent("alarm", () => loop());
  await os.onEvent("tray", (action) => {
    if (action === "start-pause") apply((t, now) => T.toggle(t, settings, now));
    else if (action === "skip") apply((t, now) => T.skip(t, settings, now));
    else if (action === "settings") toggleSettings(true);
  });

  frame.classList.toggle("compact", ui.compact);
  scroller.setActive(ui.visible && !ui.compact);
  applyWindowSize();
  syncAlarm(false);
  syncTray();
  loop(); // also handles a phase that ended while the app was closed

  startSoakLog(() => ({ ...scroller.stats(), x: Math.round(position(journey, timer, settings, clock.now())), todayCount: timer.todayCount }));
  if (debug.timescale !== 1 || debug.soaklog) {
    window.__shanshui = { stats: scroller.stats, toggle: () => apply((t, now) => T.toggle(t, settings, now)) };
  }
  requestAnimationFrame(() => document.body.classList.add("ready"));
}

boot().catch((err) => {
  console.error("shanshui: failed to start", err);
  phaseEl.textContent = "Something went wrong while starting. Please restart Shanshui.";
});
