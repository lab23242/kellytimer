import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "src-tauri/**", "vendor/**", "node_modules/**", "src/shanshui/upstream.js"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, __APP_VERSION__: "readonly" },
    },
  },
  {
    files: ["src/render/tile-worker.js"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
