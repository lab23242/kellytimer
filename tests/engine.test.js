import { describe, expect, test } from "vitest";
import { CHUNK_WIDTH, createLandscape, measureExtent } from "../src/shanshui/engine.js";

describe("landscape engine", () => {
  test("same seed and range give identical SVG", () => {
    const a = createLandscape({ seed: "shanshui:2026-11-23" });
    const b = createLandscape({ seed: "shanshui:2026-11-23" });
    const svgA = a.renderRange(0, 600);
    expect(svgA.length).toBeGreaterThan(10_000);
    expect(b.renderRange(0, 600)).toBe(svgA);
  });

  test("output does not depend on the order ranges are requested in", () => {
    const seq = createLandscape({ seed: "order" });
    seq.renderRange(0, 512);
    seq.renderRange(512, 1024);
    const sequential = seq.renderRange(1024, 1536);

    const jump = createLandscape({ seed: "order", cacheLimit: 2 });
    jump.renderRange(4096, 4608); // fill and evict the cache with unrelated chunks
    expect(jump.renderRange(1024, 1536)).toBe(sequential);
  });

  test("different seeds give different landscapes", () => {
    const a = createLandscape({ seed: "shanshui:2026-11-23" }).renderRange(0, 512);
    const b = createLandscape({ seed: "shanshui:2026-11-24" }).renderRange(0, 512);
    expect(a).not.toBe(b);
  });

  test("does not leak upstream's Math.random override", () => {
    const original = Math.random;
    createLandscape({ seed: 1 }).renderRange(0, 100);
    expect(Math.random).toBe(original);
    expect(Math.seed).toBeUndefined();
  });

  test("renders a clean viewBox for the requested span", () => {
    const svg = createLandscape({ seed: "vb" }).renderRange(1000, 1512, { width: 146, height: 200 });
    expect(svg).toMatch(/^<svg xmlns='http:\/\/www.w3.org\/2000\/svg' width='146' height='200' viewBox='1000 0 512 /);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("NaN");
  });

  test("drops cached chunks that are far behind", () => {
    const land = createLandscape({ seed: "drop" });
    land.renderRange(0, CHUNK_WIDTH);
    const before = land.cachedChunks();
    land.dropBefore(20 * CHUNK_WIDTH);
    expect(land.cachedChunks()).toBeLessThan(before);
    expect(land.cachedChunks()).toBe(0);
  });

  test("measureExtent reads polyline x coordinates", () => {
    const svg = "<polyline points=' 10.0,5.0 -3.5,2.0 40.2,1.0' style=''/><polyline points=' 7,1'/>";
    expect(measureExtent(svg, 0)).toEqual([-3.5, 40.2]);
  });
});
