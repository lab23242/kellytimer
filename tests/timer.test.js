import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/core/settings.js";
import {
  applySettings,
  createTimer,
  pause,
  progress,
  remainingMs,
  reset,
  rollDay,
  skip,
  start,
  tick,
  toggle,
} from "../src/core/timer.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);
const settings = normalizeSettings(DEFAULT_SETTINGS);
const auto = { ...settings, autoStart: true };

/** Run the current phase to its end (ticking right on time) and return the result. */
function finishPhase(state, cfg, now) {
  const running = state.status === "running" ? state : start(state, cfg, now);
  return tick(running, cfg, running.endsAt);
}

describe("remaining-time maths", () => {
  test("remaining time is derived from endsAt, not from ticks", () => {
    const s = start(createTimer(settings, "d"), settings, T0);
    expect(s.endsAt).toBe(T0 + 25 * MIN);
    expect(remainingMs(s, T0)).toBe(25 * MIN);
    expect(remainingMs(s, T0 + 10 * MIN + 500)).toBe(15 * MIN - 500);
    expect(remainingMs(s, T0 + 99 * MIN)).toBe(0);
  });

  test("progress goes 0 -> 1 and clamps", () => {
    const s = start(createTimer(settings, "d"), settings, T0);
    expect(progress(s, T0)).toBe(0);
    expect(progress(s, T0 + 12.5 * MIN)).toBeCloseTo(0.5);
    expect(progress(s, T0 + 60 * MIN)).toBe(1);
  });

  test("pause freezes the remaining time and resume continues from it", () => {
    let s = start(createTimer(settings, "d"), settings, T0);
    s = pause(s, T0 + 5 * MIN);
    expect(s.status).toBe("paused");
    expect(remainingMs(s, T0 + 50 * MIN)).toBe(20 * MIN);
    s = start(s, settings, T0 + 60 * MIN);
    expect(s.endsAt).toBe(T0 + 80 * MIN);
  });

  test("toggle alternates running and paused", () => {
    let s = createTimer(settings, "d");
    s = toggle(s, settings, T0);
    expect(s.status).toBe("running");
    s = toggle(s, settings, T0 + MIN);
    expect(s.status).toBe("paused");
    expect(remainingMs(s, T0 + 5 * MIN)).toBe(24 * MIN);
  });

  test("tick before the end changes nothing", () => {
    const s = start(createTimer(settings, "d"), settings, T0);
    const r = tick(s, settings, T0 + 24 * MIN);
    expect(r.ended).toBeNull();
    expect(r.state).toBe(s);
  });
});

describe("phase transitions", () => {
  test("focus end without auto-start shows 'finished' and counts a seal", () => {
    const { state, ended } = finishPhase(createTimer(settings, "d"), settings, T0);
    expect(ended).toMatchObject({ phase: "focus", next: "shortBreak", stale: false });
    expect(state.status).toBe("finished");
    expect(state.phase).toBe("focus");
    expect(remainingMs(state, T0 + 30 * MIN)).toBe(0);
    expect(state.todayCount).toBe(1);
    expect(state.cycle).toBe(1);
  });

  test("starting from 'finished' begins the next phase without counting twice", () => {
    const { state } = finishPhase(createTimer(settings, "d"), settings, T0);
    const next = start(state, settings, T0 + 30 * MIN);
    expect(next.phase).toBe("shortBreak");
    expect(next.status).toBe("running");
    expect(next.endsAt).toBe(T0 + 35 * MIN);
    expect(next.todayCount).toBe(1);
    expect(next.cycle).toBe(1);
  });

  test("auto-start chains the next phase from the exact end time", () => {
    const s = start(createTimer(auto, "d"), auto, T0);
    const late = T0 + 25 * MIN + 2000; // ticked 2 s late
    const { state, ended } = tick(s, auto, late);
    expect(ended.phase).toBe("focus");
    expect(state.phase).toBe("shortBreak");
    expect(state.status).toBe("running");
    expect(state.endsAt).toBe(T0 + 30 * MIN);
  });

  test("long break comes after every 4th focus session, then the cycle restarts", () => {
    let s = createTimer(auto, "d");
    let now = T0;
    const phases = [];
    for (let i = 0; i < 10; i++) {
      const r = finishPhase(s, auto, now);
      phases.push(r.ended.next);
      s = r.state;
      now = r.ended.endedAt;
    }
    expect(phases).toEqual([
      "shortBreak", "focus", "shortBreak", "focus", "shortBreak", "focus", "longBreak", "focus",
      "shortBreak", "focus",
    ]);
    expect(s.todayCount).toBe(5);
    expect(s.cycle).toBe(1);
  });

  test("long-break interval is configurable", () => {
    const every2 = { ...auto, longBreakEvery: 2 };
    let s = createTimer(every2, "d");
    const nexts = [];
    for (let i = 0; i < 4; i++) {
      const r = finishPhase(s, every2, T0);
      nexts.push(r.ended.next);
      s = r.state;
    }
    expect(nexts).toEqual(["shortBreak", "focus", "longBreak", "focus"]);
  });

  test("skip moves on without earning a seal and keeps running", () => {
    let s = start(createTimer(settings, "d"), settings, T0);
    s = skip(s, settings, T0 + MIN);
    expect(s.phase).toBe("shortBreak");
    expect(s.status).toBe("running");
    expect(s.endsAt).toBe(T0 + 6 * MIN);
    expect(s.todayCount).toBe(0);
  });

  test("skip from 'finished' goes to the next phase, idle", () => {
    const { state } = finishPhase(createTimer(settings, "d"), settings, T0);
    const s = skip(state, settings, T0 + 30 * MIN);
    expect(s).toMatchObject({ phase: "shortBreak", status: "idle", todayCount: 1, cycle: 1 });
  });

  test("reset restores the full phase length and stops", () => {
    let s = start(createTimer(settings, "d"), settings, T0);
    s = reset(s, settings);
    expect(s).toMatchObject({ status: "idle", endsAt: null, remainingMs: 25 * MIN });
  });

  test("new durations apply only to a phase that has not started", () => {
    const longer = { ...settings, focusMinutes: 50 };
    const idle = createTimer(settings, "d");
    expect(applySettings(idle, longer).remainingMs).toBe(50 * MIN);
    const running = start(idle, settings, T0);
    expect(applySettings(running, longer)).toBe(running);
  });

  test("a new day resets today's seals", () => {
    const { state } = finishPhase(createTimer(settings, "2026-11-23"), settings, T0);
    const next = rollDay(state, "2026-11-24");
    expect(next.todayCount).toBe(0);
    expect(next.cycle).toBe(0);
    expect(rollDay(next, "2026-11-24")).toBe(next);
  });
});

describe("sleeping past the end", () => {
  test("waking long after the end shows 'finished' and flags the end as stale", () => {
    const s = start(createTimer(auto, "d"), auto, T0);
    const wake = T0 + 3 * 60 * MIN; // laptop slept for hours
    const { state, ended } = tick(s, auto, wake);
    expect(ended.stale).toBe(true);
    expect(state.status).toBe("finished"); // no auto-start into a stale chain
    expect(state.todayCount).toBe(1);
  });

  test("one stale end produces exactly one event, no burst", () => {
    const s = start(createTimer(auto, "d"), auto, T0);
    const wake = T0 + 3 * 60 * MIN;
    const first = tick(s, auto, wake);
    const second = tick(first.state, auto, wake + 1000);
    const third = tick(second.state, auto, wake + 2000);
    expect([first.ended, second.ended, third.ended].filter(Boolean)).toHaveLength(1);
  });

  test("a short delay (within the stale window) still counts as on time", () => {
    const s = start(createTimer(settings, "d"), settings, T0);
    const { ended } = tick(s, settings, T0 + 25 * MIN + 30_000);
    expect(ended.stale).toBe(false);
  });
});
