// Mouse handling for the frameless window: drag anywhere to move it, click the time to
// start/pause, double-click to switch compact mode.
//
// We don't use Tauri's data-tauri-drag-region attribute: it starts the OS drag on
// mousedown (which swallows the click on the time) and maps double-click to maximise.
// Here dragging only starts once the mouse has moved a few pixels with the button down.
import { startDragging } from "../platform/bridge.js";

const DRAG_THRESHOLD_PX = 4;
const DOUBLE_CLICK_MS = 260;
/** Longest gap Windows accepts between double-click halves (its setting tops out ~900 ms). */
const SLOW_DOUBLE_CLICK_MS = 900;

/** Elements matching this never start a drag or toggle compact mode. */
const INTERACTIVE = "button, input, select, label, a, .settings, .controls";

export function attachPointer(root, { timeEl, onTimeClick, onDoubleClick }) {
  let down = null;
  let clickTimer = null;

  root.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
    down = { x: e.screenX, y: e.screenY };
  });

  window.addEventListener("mousemove", (e) => {
    if (!down || (e.buttons & 1) === 0) {
      down = null;
      return;
    }
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) >= DRAG_THRESHOLD_PX) {
      down = null;
      startDragging();
    }
  });

  window.addEventListener("mouseup", () => (down = null));

  // A single click on the time toggles the timer, but waits briefly so a double-click
  // (compact mode) doesn't also start and stop it. The OS double-click time can be longer
  // than our wait; if the toggle already happened, a double-click undoes it.
  let toggledAt = -Infinity;
  timeEl.addEventListener("click", (e) => {
    if (e.detail > 1) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      toggledAt = performance.now();
      onTimeClick();
    }, DOUBLE_CLICK_MS);
  });

  root.addEventListener("dblclick", (e) => {
    if (e.target.closest(INTERACTIVE)) return;
    clearTimeout(clickTimer);
    if (e.target === timeEl && performance.now() - toggledAt < SLOW_DOUBLE_CLICK_MS) onTimeClick();
    toggledAt = -Infinity;
    onDoubleClick();
  });

  timeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onTimeClick();
    }
  });
}
