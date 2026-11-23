// Pomodoro state machine. Pure functions: every transition takes the current state and a
// timestamp and returns a new state; nothing here reads the clock or counts ticks.
// Remaining time is always derived from `endsAt - now`.
import { phaseDurations } from "./settings.js";

export const PHASE_LABELS = {
  focus: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

/** A phase that ended more than this long ago (e.g. the laptop was asleep) is "stale". */
export const STALE_AFTER_MS = 90_000;

/**
 * @typedef {"focus"|"shortBreak"|"longBreak"} Phase
 * @typedef {"idle"|"running"|"paused"|"finished"} Status
 * @typedef {{
 *   phase: Phase, status: Status, durationMs: number,
 *   endsAt: number|null, remainingMs: number,
 *   cycle: number, todayCount: number, day: string, pendingNext: Phase|null
 * }} TimerState
 * `cycle` = focus sessions since the last long break; `todayCount` = completed today;
 * `pendingNext` = the phase that follows a "finished" one.
 */

/** @returns {TimerState} */
export function createTimer(settings, day) {
  const durationMs = phaseDurations(settings).focus;
  return {
    phase: "focus",
    status: "idle",
    durationMs,
    endsAt: null,
    remainingMs: durationMs,
    cycle: 0,
    todayCount: 0,
    day,
    pendingNext: null,
  };
}

export function remainingMs(state, now) {
  if (state.status === "running") return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

export function elapsedMs(state, now) {
  return state.durationMs - remainingMs(state, now);
}

/** 0 at the start of a phase, 1 at its end. */
export function progress(state, now) {
  if (state.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs(state, now) / state.durationMs));
}

/** Which phase follows `phase`, given the cycle count *after* the phase completed. */
export function nextPhase(phase, cycle, settings) {
  if (phase !== "focus") return "focus";
  return cycle >= settings.longBreakEvery ? "longBreak" : "shortBreak";
}

/** Enter `phase`, idle and full length. */
function enterPhase(state, phase, settings) {
  const durationMs = phaseDurations(settings)[phase];
  return { ...state, phase, status: "idle", durationMs, endsAt: null, remainingMs: durationMs, pendingNext: null };
}

/** Counters after the current phase completes, and the phase that follows it. */
function complete(state, settings, { countFocus }) {
  let { cycle, todayCount } = state;
  if (state.phase === "focus") {
    cycle += 1;
    if (countFocus) todayCount += 1;
  }
  const next = nextPhase(state.phase, cycle, settings);
  if (state.phase === "longBreak") cycle = 0;
  return { cycle, todayCount, next };
}

/** Move to the following phase (idle). From "finished" the counters are already updated. */
function advance(state, settings, { countFocus }) {
  if (state.status === "finished") return enterPhase(state, state.pendingNext, settings);
  const { cycle, todayCount, next } = complete(state, settings, { countFocus });
  return enterPhase({ ...state, cycle, todayCount }, next, settings);
}

function run(state, now) {
  return { ...state, status: "running", endsAt: now + state.remainingMs };
}

/** Start or resume. From "finished", moves on to the next phase and starts it. */
export function start(state, settings, now) {
  if (state.status === "running") return state;
  if (state.status === "finished") return run(advance(state, settings, { countFocus: false }), now);
  return run(state, now);
}

export function pause(state, now) {
  if (state.status !== "running") return state;
  return { ...state, status: "paused", endsAt: null, remainingMs: remainingMs(state, now) };
}

export function toggle(state, settings, now) {
  return state.status === "running" ? pause(state, now) : start(state, settings, now);
}

/** Put the current phase back to its full length, not running. */
export function reset(state, settings) {
  const durationMs = phaseDurations(settings)[state.phase];
  return { ...state, status: "idle", durationMs, endsAt: null, remainingMs: durationMs };
}

/**
 * Skip to the next phase. A skipped focus session moves the break cadence on but does
 * not earn a seal. Keeps running if the timer was running.
 */
export function skip(state, settings, now) {
  const wasRunning = state.status === "running";
  const next = advance(state, settings, { countFocus: false });
  return wasRunning ? run(next, now) : next;
}

/** Apply changed durations to a phase that hasn't started yet. */
export function applySettings(state, settings) {
  if (state.status !== "idle" || state.remainingMs !== state.durationMs) return state;
  const durationMs = phaseDurations(settings)[state.phase];
  return { ...state, durationMs, remainingMs: durationMs };
}

/** New calendar day: today's seal count and the long-break cycle start again. */
export function rollDay(state, day) {
  if (state.day === day) return state;
  return { ...state, day, todayCount: 0, cycle: state.status === "running" ? state.cycle : 0 };
}

/**
 * Check for the end of the running phase.
 * @returns {{state: TimerState, ended: null | {phase: Phase, endedAt: number, stale: boolean, next: Phase}}}
 */
export function tick(state, settings, now, { staleAfterMs = STALE_AFTER_MS } = {}) {
  if (state.status !== "running" || now < state.endsAt) return { state, ended: null };

  const endedAt = state.endsAt;
  const stale = now - endedAt > staleAfterMs;
  const completed = state.phase;

  const { cycle, todayCount, next } = complete(state, settings, { countFocus: true });
  const ended = { phase: completed, endedAt, stale, next };

  if (settings.autoStart && !stale) {
    // Chain from the exact end time so the cadence doesn't drift with timer jitter.
    const nextState = enterPhase({ ...state, cycle, todayCount }, next, settings);
    return { state: run(nextState, endedAt), ended };
  }
  // Show the finished phase until the user moves on. The seal is already counted.
  const finished = { ...state, status: "finished", endsAt: null, remainingMs: 0, cycle, todayCount, pendingNext: next };
  return { state: finished, ended };
}
