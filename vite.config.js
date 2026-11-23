import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Tauri expects a fixed dev port and wants to see Rust errors in the terminal.
export default defineConfig({
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/vendor/**"] },
  },
  build: {
    target: ["chrome105", "safari16"],
    outDir: "dist",
    emptyOutDir: true,
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["tests/**/*.test.js"],
    testTimeout: 30_000,
  },
});
