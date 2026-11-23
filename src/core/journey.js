// Where along today's scroll we are. The position is derived from the timer, never
// accumulated frame by frame: during focus the scroll covers FOCUS_CHUNKS chunks over the
// whole session; during breaks it creeps at a small fraction of that speed.
import { CHUNK_WIDTH } from "../shanshui/engine.js";
import { elapsedMs } from "./timer.js";
import { phaseDurations } from "./settings.js";

/** World distance travelled per focus session, in landscape chunks (x speed setting).
 *  48 chunks in 25 minutes is about 4.7 px/s in the small window: a slow, visible pan. */
export const FOCUS_CHUNKS = 48;
/** Break drift as a fraction of focus speed: a near-stop. */
export const BREAK_SPEED_RATIO = 0.04;

/** @typedef {{ day: string, anchor: number }} Journey  anchor = position at elapsed 0 */

/** @returns {Journey} */
export function createJourney(day) {
  return { day, anchor: 0 };
}

export function focusDistance(settings) {
  return FOCUS_CHUNKS * CHUNK_WIDTH * settings.scrollSpeed;
}

/** Scroll speed in world units per millisecond for a phase. */
export function phaseSpeed(phase, settings) {
  const focusSpeed = focusDistance(settings) / phaseDurations(settings).focus;
  return phase === "focus" ? focusSpeed : focusSpeed * BREAK_SPEED_RATIO;
}

/** Current world x of the left edge of the view. */
export function position(journey, timer, settings, now) {
  return journey.anchor + phaseSpeed(timer.phase, settings) * elapsedMs(timer, now);
}

/**
 * Re-anchor across a timer or settings change so the scroll continues from exactly where
 * it was (no jumps on skip, reset, phase change or a new speed).
 * @returns {Journey}
 */
export function carry(journey, before, after, now) {
  const here = position(journey, before.timer, before.settings, now);
  const anchor = here - phaseSpeed(after.timer.phase, after.settings) * elapsedMs(after.timer, now);
  return anchor === journey.anchor ? journey : { ...journey, anchor };
}
