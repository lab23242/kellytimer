// Time source. Normally just Date.now(); with a debug time scale (e.g. 60, so one minute
// passes per real second) app time runs faster from the moment the clock is created.

/** Local calendar day as YYYY-MM-DD; always based on real time. */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Landscape seed for a day: the same all day, different tomorrow. */
export function seedForDay(day) {
  return `shanshui:${day}`;
}

export function createClock({ scale = 1, realNow = () => Date.now() } = {}) {
  const origin = realNow();
  return {
    scale,
    now: () => origin + (realNow() - origin) * scale,
    /** Real wall-clock time at which app time `appMs` occurs. */
    toReal: (appMs) => origin + (appMs - origin) / scale,
    /** Real milliseconds until app time `appMs`. */
    realDelay: (appMs) => Math.max(0, (appMs - (origin + (realNow() - origin) * scale)) / scale),
    day: () => dayKey(realNow()),
  };
}
