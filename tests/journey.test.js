import { describe, expect, test } from "vitest";
import { CHUNK_WIDTH } from "../src/shanshui/engine.js";
import { BREAK_SPEED_RATIO, carry, createJourney, position } from "../src/core/journey.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/core/settings.js";
import { createTimer, pause, reset, skip, start, tick } from "../src/core/timer.js";

const MIN = 60_000;
const T0 = 1_800_000_000_000;
const settings = normalizeSettings(DEFAULT_SETTINGS);

describe("journey position", () => {
  test("a focus session covers exactly three chunks", () => {
    const j = createJourney("d");
    const t = start(createTimer(settings, "d"), settings, T0);
    expect(position(j, t, settings, T0)).toBe(0);
    expect(position(j, t, settings, T0 + 12.5 * MIN)).toBeCloseTo(1.5 * CHUNK_WIDTH);
    expect(position(j, t, settings, T0 + 25 * MIN)).toBeCloseTo(3 * CHUNK_WIDTH);
    expect(position(j, t, settings, T0 + 90 * MIN)).toBeCloseTo(3 * CHUNK_WIDTH);
  });

  test("paused scroll stays put", () => {
    const j = createJourney("d");
    const t = pause(start(createTimer(settings, "d"), settings, T0), T0 + 5 * MIN);
    expect(position(j, t, settings, T0 + 5 * MIN)).toBe(position(j, t, settings, T0 + 40 * MIN));
  });

  test("phase change, skip and reset never make the scroll jump", () => {
    let j = createJourney("d");
    let t = start(createTimer(settings, "d"), settings, T0);
    const step = (fn, now) => {
      const before = { timer: t, settings };
      const next = fn(t, now);
      j = carry(j, before, { timer: next, settings }, now);
      t = next;
    };
    const at = T0 + 25 * MIN;
    const xEnd = position(j, t, settings, at);
    step((s, now) => tick(s, settings, now).state, at);
    expect(position(j, t, settings, at)).toBeCloseTo(xEnd);
    step((s, now) => start(s, settings, now), at); // into the break
    const xBreak = position(j, t, settings, at + 5 * MIN);
    expect(xBreak - xEnd).toBeCloseTo(3 * CHUNK_WIDTH * BREAK_SPEED_RATIO * (5 / 25));
    const xSkip = position(j, t, settings, at + MIN);
    step((s, now) => skip(s, settings, now), at + MIN);
    expect(position(j, t, settings, at + MIN)).toBeCloseTo(xSkip);
    step((s, now) => start(s, settings, now), at + MIN);
    const xReset = position(j, t, settings, at + 3 * MIN);
    step((s) => reset(s, settings), at + 3 * MIN);
    expect(position(j, t, settings, at + 3 * MIN)).toBeCloseTo(xReset);
  });

  test("changing the speed mid-session keeps the current position", () => {
    let j = createJourney("d");
    const t = start(createTimer(settings, "d"), settings, T0);
    const now = T0 + 10 * MIN;
    const x = position(j, t, settings, now);
    const faster = { ...settings, scrollSpeed: 2 };
    j = carry(j, { timer: t, settings }, { timer: t, settings: faster }, now);
    expect(position(j, t, faster, now)).toBeCloseTo(x);
    expect(position(j, t, faster, now + MIN)).toBeGreaterThan(position(j, t, settings, now + MIN));
  });
});
