// User settings: defaults, validation and the window size presets.

export const SIZE_PRESETS = {
  S: { width: 340, height: 200, label: "Small" },
  M: { width: 420, height: 248, label: "Medium" },
  L: { width: 520, height: 306, label: "Large" },
};
export const COMPACT_SIZE = { width: 156, height: 60 };

export const SOUNDS = {
  bowl: "Singing bowl",
  qin: "Plucked string",
  bell: "Small bell",
};

export const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStart: false,
  sound: "bowl",
  volume: 0.7,
  muted: false,
  scrollSpeed: 1,
  windowSize: "S",
  opacity: 1,
  alwaysOnTop: true,
  startWithWindows: false,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function num(value, fallback, lo, hi, { integer = false } = {}) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(integer ? Math.round(n) : n, lo, hi);
}

const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);

/** Returns a complete, valid settings object from untrusted (stored) input. */
export function normalizeSettings(input) {
  const s = input && typeof input === "object" ? input : {};
  const d = DEFAULT_SETTINGS;
  return {
    focusMinutes: num(s.focusMinutes, d.focusMinutes, 1, 180, { integer: true }),
    shortBreakMinutes: num(s.shortBreakMinutes, d.shortBreakMinutes, 1, 60, { integer: true }),
    longBreakMinutes: num(s.longBreakMinutes, d.longBreakMinutes, 1, 90, { integer: true }),
    longBreakEvery: num(s.longBreakEvery, d.longBreakEvery, 1, 12, { integer: true }),
    autoStart: bool(s.autoStart, d.autoStart),
    sound: Object.hasOwn(SOUNDS, s.sound) ? s.sound : d.sound,
    volume: num(s.volume, d.volume, 0, 1),
    muted: bool(s.muted, d.muted),
    scrollSpeed: num(s.scrollSpeed, d.scrollSpeed, 0.25, 4),
    windowSize: Object.hasOwn(SIZE_PRESETS, s.windowSize) ? s.windowSize : d.windowSize,
    opacity: num(s.opacity, d.opacity, 0.6, 1),
    alwaysOnTop: bool(s.alwaysOnTop, d.alwaysOnTop),
    startWithWindows: bool(s.startWithWindows, d.startWithWindows),
  };
}

const MINUTE = 60_000;

/** Phase lengths in milliseconds. */
export function phaseDurations(settings) {
  return {
    focus: settings.focusMinutes * MINUTE,
    shortBreak: settings.shortBreakMinutes * MINUTE,
    longBreak: settings.longBreakMinutes * MINUTE,
  };
}
