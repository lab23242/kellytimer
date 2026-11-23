// The settings sheet that slides over the painting inside the same window.
// Changes apply immediately; there is no save button.
import { SIZE_PRESETS, SOUNDS } from "../core/settings.js";

const pct = (v) => `${Math.round(v * 100)}%`;

const SECTIONS = [
  {
    title: "Timer",
    rows: [
      { key: "focusMinutes", label: "Focus length", type: "number", min: 1, max: 180, unit: "min" },
      { key: "shortBreakMinutes", label: "Short break", type: "number", min: 1, max: 60, unit: "min" },
      { key: "longBreakMinutes", label: "Long break", type: "number", min: 1, max: 90, unit: "min" },
      { key: "longBreakEvery", label: "Long break after every", type: "number", min: 1, max: 12, unit: "focus sessions" },
      { key: "autoStart", label: "Start the next part by itself", type: "toggle" },
    ],
  },
  {
    title: "Sound",
    rows: [
      { key: "sound", label: "Chime", type: "select", options: SOUNDS, button: { label: "Listen", action: "preview-sound" } },
      { key: "volume", label: "Volume", type: "range", min: 0, max: 1, step: 0.05, format: pct },
      { key: "muted", label: "Silent, no chime", type: "toggle" },
    ],
  },
  {
    title: "Landscape",
    rows: [
      { key: "scrollSpeed", label: "Scroll speed", type: "range", min: 0.25, max: 4, step: 0.25, format: (v) => `${v}×` },
      { type: "action", label: "Start today’s journey again", action: "reset-journey", confirm: "Click again to start over" },
    ],
  },
  {
    title: "Window",
    rows: [
      {
        key: "windowSize",
        label: "Size",
        type: "choice",
        options: Object.fromEntries(Object.entries(SIZE_PRESETS).map(([k, v]) => [k, v.label])),
      },
      {
        key: "opacity",
        label: "See-through",
        type: "range",
        min: 0,
        max: 0.4,
        step: 0.05,
        // the slider shows how see-through the window is; the setting stores opacity
        toUi: (opacity) => +(1 - opacity).toFixed(2),
        fromUi: (v) => +(1 - v).toFixed(2),
        format: (v) => (v === 0 ? "Not at all" : pct(v)),
      },
      { key: "alwaysOnTop", label: "Stay in front of other windows", type: "toggle" },
      { key: "startWithWindows", label: "Open when Windows starts", type: "toggle" },
      { type: "corners", label: "Move to a corner" },
    ],
  },
];

const CORNERS = [
  ["top-left", "Top left"],
  ["top-right", "Top right"],
  ["bottom-left", "Bottom left"],
  ["bottom-right", "Bottom right"],
];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

let uid = 0;

/**
 * @param {{ onChange: (patch: object) => void, onAction: (name: string, arg?: string) => void,
 *           onClose: () => void, version: string }} handlers
 */
export function createSettingsPanel({ onChange, onAction, onClose, version }) {
  const controls = new Map(); // key -> { sync(value) }

  function row(def) {
    const id = `set-${++uid}`;
    if (def.type === "action") {
      const btn = el("button", { class: "link-button", type: "button" }, def.label);
      let armed = null;
      btn.addEventListener("click", () => {
        if (!armed) {
          btn.textContent = def.confirm;
          armed = setTimeout(() => {
            armed = null;
            btn.textContent = def.label;
          }, 4000);
          return;
        }
        clearTimeout(armed);
        armed = null;
        btn.textContent = def.label;
        onAction(def.action);
      });
      return el("div", { class: "row row-action" }, btn);
    }
    if (def.type === "corners") {
      const grid = el(
        "div",
        { class: "corners", role: "group", "aria-label": def.label },
        ...CORNERS.map(([corner, name]) =>
          el("button", { type: "button", class: `corner corner-${corner}`, title: name, "aria-label": name, onclick: () => onAction("snap", corner) }),
        ),
      );
      return el("div", { class: "row" }, el("span", { class: "label" }, def.label), grid);
    }

    const label = el("label", { class: "label", for: id }, def.label);
    let input;
    let sync;
    let extra = null;
    switch (def.type) {
      case "number": {
        input = el("input", { id, type: "number", min: def.min, max: def.max, step: 1, inputmode: "numeric" });
        let current = null;
        sync = (v) => {
          current = v;
          input.value = v;
        };
        input.addEventListener("change", () => {
          const v = Math.round(Number(input.value));
          if (input.value.trim() === "" || !Number.isFinite(v)) {
            sync(current); // emptied or garbage: put the saved value back
            return;
          }
          const clamped = Math.min(def.max, Math.max(def.min, v));
          sync(clamped); // show what was actually saved
          onChange({ [def.key]: clamped });
        });
        extra = el("span", { class: "unit" }, def.unit);
        break;
      }
      case "toggle": {
        input = el("input", { id, type: "checkbox", class: "seal-toggle" });
        input.addEventListener("change", () => onChange({ [def.key]: input.checked }));
        sync = (v) => (input.checked = v);
        break;
      }
      case "select": {
        input = el("select", { id }, ...Object.entries(def.options).map(([value, text]) => el("option", { value }, text)));
        input.addEventListener("change", () => onChange({ [def.key]: input.value }));
        sync = (v) => (input.value = v);
        extra = el("button", { type: "button", class: "link-button", onclick: () => onAction(def.button.action) }, def.button.label);
        break;
      }
      case "range": {
        const toUi = def.toUi || ((v) => v);
        const fromUi = def.fromUi || ((v) => v);
        input = el("input", { id, type: "range", min: def.min, max: def.max, step: def.step });
        const out = el("output", { for: id, class: "value" });
        input.addEventListener("input", () => {
          out.textContent = def.format(Number(input.value));
          onChange({ [def.key]: fromUi(Number(input.value)) });
        });
        sync = (v) => {
          input.value = toUi(v);
          out.textContent = def.format(toUi(v));
        };
        extra = out;
        break;
      }
      case "choice": {
        const buttons = Object.entries(def.options).map(([value, text]) =>
          el("button", { type: "button", class: "choice", "data-value": value, onclick: () => onChange({ [def.key]: value }) }, text),
        );
        input = el("div", { class: "choices", role: "group", "aria-label": def.label }, ...buttons);
        sync = (v) => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
        return (controls.set(def.key, { sync }), el("div", { class: "row" }, el("span", { class: "label" }, def.label), input));
      }
      default:
        throw new Error(`unknown setting type ${def.type}`);
    }
    controls.set(def.key, { sync });
    return el("div", { class: `row row-${def.type}` }, label, el("span", { class: "control" }, input, extra));
  }

  const root = el(
    "section",
    { class: "settings", "aria-label": "Settings", hidden: true },
    el(
      "header",
      { class: "settings-head" },
      el("h2", {}, "Settings"),
      el("button", { type: "button", class: "link-button", onclick: onClose }, "Done"),
    ),
    ...SECTIONS.map((s) => el("div", { class: "group" }, el("h3", {}, s.title), ...s.rows.map(row))),
    el(
      "footer",
      { class: "about" },
      el("p", {}, "Landscape generator: shan-shui-inf by Lingdong Huang, MIT"),
      el("p", {}, `Shanshui ${version}`),
      el("button", { type: "button", class: "link-button quit", onclick: () => onAction("quit") }, "Quit Shanshui"),
    ),
  );

  return {
    root,
    sync(settings) {
      for (const [key, c] of controls) c.sync(settings[key]);
    },
    open() {
      root.hidden = false;
      root.scrollTop = 0;
      requestAnimationFrame(() => root.classList.add("open"));
    },
    close() {
      root.classList.remove("open");
      setTimeout(() => {
        if (!root.classList.contains("open")) root.hidden = true;
      }, 250);
    },
    isOpen: () => !root.hidden,
  };
}
