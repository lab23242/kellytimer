// Everything that talks to the OS. Inside Tauri it calls the Rust commands and plugins;
// in a plain browser (vite dev, benchmarks, soak tests) it falls back to web APIs so the
// app still runs.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import * as autostart from "@tauri-apps/plugin-autostart";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Shared with the Rust side (STORE_FILE in src-tauri/src/lib.rs). */
const STORE_FILE = "shanshui.json";
const LOCAL_PREFIX = "shanshui:";

function reportError(what, err) {
  console.error(`shanshui: ${what}`, err);
}

async function call(cmd, args) {
  if (!isTauri) return undefined;
  try {
    return await invoke(cmd, args);
  } catch (err) {
    reportError(`${cmd} failed`, err);
    return undefined;
  }
}

/** Key-value persistence: the Tauri store file, or localStorage in a browser. */
export async function openStore({ persist = true } = {}) {
  if (isTauri && persist) {
    const store = await load(STORE_FILE, { autoSave: 300, defaults: {} });
    return {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
    };
  }
  const memory = new Map();
  return {
    async get(key) {
      if (!persist) return memory.get(key);
      try {
        const raw = localStorage.getItem(LOCAL_PREFIX + key);
        return raw == null ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      if (!persist) return void memory.set(key, value);
      try {
        localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
      } catch (err) {
        reportError("could not save to localStorage", err);
      }
    },
  };
}

// --- phase-end alarm -------------------------------------------------------------------

/**
 * Ask the Rust side to notify + chime at real time `endsAtMs`, even if the webview is
 * throttled by then. In a browser there is no such helper: the page plays the chime
 * itself when it notices the end.
 */
export function scheduleAlarm({ endsAtMs, title, body, sound, volume }) {
  return call("schedule_alarm", { request: { endsAtMs, title, body, sound, volume } });
}

export function cancelAlarm() {
  return call("cancel_alarm");
}

export function playSound(name, volume) {
  if (isTauri) return call("play_sound", { name, volume });
  const audio = new Audio(`/sounds/${name}.wav`);
  audio.volume = volume;
  audio.play().catch((err) => reportError("could not play sound", err));
  return undefined;
}

// --- window and tray -------------------------------------------------------------------

export const setWindowSize = (width, height) => call("set_window_size", { width, height });
export const snapToCorner = (corner) => call("snap_to_corner", { corner });
export const setAlwaysOnTop = (on) => call("set_always_on_top", { on });
export const hideToTray = (notice) => call("hide_to_tray", { notice });
export const quitApp = () => (isTauri ? call("quit_app") : undefined);
export const updateTray = (tooltip, running) => call("update_tray", { tooltip, running });

export function startDragging() {
  if (!isTauri) return;
  getCurrentWindow()
    .startDragging()
    .catch((err) => reportError("could not start dragging", err));
}

/** Subscribe to a Rust event; returns an unsubscribe function (no-op in a browser). */
export async function onEvent(name, handler) {
  if (!isTauri) return () => {};
  return listen(name, (e) => handler(e.payload));
}

// --- start with Windows ----------------------------------------------------------------

export async function getAutostart() {
  if (!isTauri) return false;
  try {
    return await autostart.isEnabled();
  } catch (err) {
    reportError("could not read autostart", err);
    return false;
  }
}

export async function setAutostart(on) {
  if (!isTauri) return;
  try {
    await (on ? autostart.enable() : autostart.disable());
  } catch (err) {
    reportError("could not change autostart", err);
  }
}
