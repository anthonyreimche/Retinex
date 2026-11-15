// @vitest-environment node
//
// The passes' blur chain (test/reference/gpu-chain.ts, a float64 model of
// src/glsl.ts CHAIN on schedule.ts's levels and read back) against
// RawTherapee's exact iterated boxes, through the whole of Retinex: a scene
// with a fine texture, Radius up to 80 on frames only a few σ wide, where the
// truncated boxes leave kinks and slopes at the frame's edges that coarse
// cells must follow. HSL linear is the most sensitive (its map sums ratios).

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, rtParams, type Params } from "../../src/model";
import { chainModel } from "./gpu-chain";
import { SAFELIGHT, XYZ_FROM_SRGB, retinex, rgb2lab, toHalf } from "./rtref";

function scene(w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      const base = 0.03 + 0.55 * u * u + 0.12 * Math.sin(7 * v) * (0.5 + u) + 0.01 * Math.sin(x * 0.7) * Math.cos(y * 0.9);
      let rgb = [base * (0.8 + 0.3 * v), base, base * (1.1 - 0.4 * u)];
      if (x > w * 0.6 && y > h * 0.45 && y < h * 0.8) rgb = [0.5, 0.17, 0.05];
      if (x < w * 0.22 && y < h * 0.3) rgb = [0.03, 0.1, 0.33];
      for (let c = 0; c < 3; c++) out[3 * (y * w + x) + c] = toHalf(Math.max(0.001, rgb[c])) * 65535;
    }
  return out;
}

function lightnessError(got: Float32Array, want: Float32Array): { p99: number; max: number } {
  const e: number[] = [];
  for (let k = 0; k < want.length / 3; k++) {
    if (Math.max(want[3 * k], want[3 * k + 1], want[3 * k + 2]) >= 0.97 * 65535) continue;
    const a = rgb2lab(Math.max(got[3 * k], 0), Math.max(got[3 * k + 1], 0), Math.max(got[3 * k + 2], 0), XYZ_FROM_SRGB)[0];
    const b = rgb2lab(Math.max(want[3 * k], 0), Math.max(want[3 * k + 1], 0), Math.max(want[3 * k + 2], 0), XYZ_FROM_SRGB)[0];
    e.push(Math.abs(a - b) / 327.68);
  }
  e.sort((p, q) => p - q);
  return { p99: e[Math.floor(0.99 * (e.length - 1))], max: e[e.length - 1] };
}

const CASES: [number, number, Params["space"], number][] = [
  [640, 400, "hslLinear", 10],
  [640, 400, "hslLinear", 30],
  [640, 400, "hslLinear", 80],
  [640, 400, "lab", 10],
  [640, 400, "lab", 30],
  [640, 400, "lab", 80],
  [1600, 1000, "hslLinear", 80],
];

describe("the passes' blur chain", () => {
  const images = new Map<string, Float32Array>();
  it.each(CASES)("follows the exact boxes at %i × %i, %s, Radius %i", (W, H, space, radius) => {
    const key = `${W}x${H}`;
    const img = images.get(key) ?? scene(W, H);
    images.set(key, img);
    const p = rtParams({ ...DEFAULT_PARAMS, strength: 100, space, radius, on: true });
    const want = retinex(img, W, H, p, SAFELIGHT).rgb;
    const got = retinex(img, W, H, p, { ...SAFELIGHT, chain: chainModel() }).rgb;
    const e = lightnessError(got, want);
    expect(e.p99).toBeLessThan(0.05);
    expect(e.max).toBeLessThan(0.75);
  }, 120_000);
});
