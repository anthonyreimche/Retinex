// The stage on the real renderer. Run via `npm run test:gpu` (run.cjs copies
// this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//  • the three passes compile with the host's namespacing and run the bag's
//    draw counts, slot by slot;
//  • an untouched photo, and a switched-off edit, leave the frame as it was;
//  • on half-float targets, the decimated blur chain, the statistics trees and
//    the final draw land on RawTherapee's result, here the transcription
//    test/reference/rtref.ts, which rtref.test.ts holds to RawTherapee
//    compiled from its own source;
//  • the RAW baseline is undone and put back around the change;
//  • a draw count that doesn't fit the params, derived values of another
//    version and a later-iterations pass that didn't run leave the frame alone;
//  • black pixels and a flat frame stay finite in every view.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, VIEWS, rtParams, type Params, type View } from "@rx/model";
import { bagPatch, qualified, resetPatch, VIEW_KEY, VIEW_P1_KEY } from "@rx/params";
import { retinexStage } from "@rx/stage";
import { SAFELIGHT, XYZ_FROM_SRGB, retinex, rgb2lab } from "@rx-test/reference/rtref";
import { CURRENT_PROCESS_VERSION } from "@/catalog/process-version";
import type { ResolvedPipeline } from "@/rendering/webgl/resolved-pipeline";
import {
  OPEN_PROBE,
  builtinStages,
  floatImage,
  identityParams,
  rendererBuildError,
  toHalf,
  withRenderer,
  type FloatImage,
} from "@/rendering/webgl/webgl.test-support";

const BASE_PROBE: ResolvedPipeline = { ...OPEN_PROBE, id: "test.base-probe", sig: "test.base-probe", skipBaseCurve: false };

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Soft gradients, colour patches, hard edges, highlights, deep shadows and noise. */
function scene(w: number, h: number): FloatImage {
  const rand = lcg(4242);
  return floatImage(w, h, (x, y) => {
    const u = x / (w - 1);
    const v = y / (h - 1);
    const base = 0.03 + 0.55 * u * u + 0.12 * Math.sin(7 * v) * (0.5 + u);
    let rgb: [number, number, number] = [base * (0.8 + 0.3 * v), base, base * (1.1 - 0.4 * u)];
    if (x > w * 0.6 && y > h * 0.45 && y < h * 0.8) rgb = [0.5, 0.17, 0.05];
    if (x < w * 0.22 && y < h * 0.3) rgb = [0.03, 0.1, 0.33];
    if (Math.hypot(x - w * 0.3, y - h * 0.7) < h * 0.08) rgb = [0.85, 0.82, 0.7];
    if ((x >> 3) % 6 === 0 && y > h * 0.85) rgb = [0.75, 0.75, 0.75];
    const n = 0.004 * (rand() - 0.5);
    return [toHalf(Math.max(0.001, rgb[0] + n)), toHalf(Math.max(0.001, rgb[1] + n)), toHalf(Math.max(0.001, rgb[2] + n))];
  });
}

/** Gradients and patches under a fine texture, without noise: what large
 *  radii on a small frame get wrong when the chain's cells can't follow the
 *  truncated boxes (docs/SPEC.md §5). */
function texture(w: number, h: number): FloatImage {
  return floatImage(w, h, (x, y) => {
    const u = x / (w - 1);
    const v = y / (h - 1);
    const base = 0.03 + 0.55 * u * u + 0.12 * Math.sin(7 * v) * (0.5 + u) + 0.01 * Math.sin(x * 0.7) * Math.cos(y * 0.9);
    let rgb: [number, number, number] = [base * (0.8 + 0.3 * v), base, base * (1.1 - 0.4 * u)];
    if (x > w * 0.6 && y > h * 0.45 && y < h * 0.8) rgb = [0.5, 0.17, 0.05];
    if (x < w * 0.22 && y < h * 0.3) rgb = [0.03, 0.1, 0.33];
    return [toHalf(Math.max(0.001, rgb[0])), toHalf(Math.max(0.001, rgb[1])), toHalf(Math.max(0.001, rgb[2]))];
  });
}

const W = 320;
const H = 200;

function render(img: FloatImage, bags: Record<string, Record<string, unknown>>, pipeline: ResolvedPipeline = OPEN_PROBE, stages = [retinexStage()]): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  withRenderer({ stages: [...builtinStages(), ...stages], pipeline }, (renderer) => {
    renderer.setImage(img);
    renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION }));
    for (const [name, bag] of Object.entries(bags)) {
      renderer.setContributedParams(bag);
      const frame = renderer.captureFloatFrame();
      if (!frame) throw new Error(`no frame for ${name}`);
      out[name] = frame.data;
    }
  });
  return out;
}

const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p, on: true });

/** rtref's result for `img`, as Safelight's stage computes it. */
function reference(img: FloatImage, p: Params, view: View = "standard"): Float32Array {
  const n = img.width * img.height;
  const rgb = new Float32Array(3 * n);
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) rgb[3 * k + c] = img.data[4 * k + c] * 65535;
  const out = retinex(rgb, img.width, img.height, rtParams(p, view), SAFELIGHT).rgb;
  return out.map((v) => v / 65535);
}

interface Stats {
  p50: number;
  p99: number;
  max: number;
  /** Pixels more than 1 L* off. */
  over: number;
  /** The worst pixel. */
  at: number;
}
function stats(errors: number[], index: number[] = []): Stats {
  let at = -1;
  errors.forEach((v, i) => {
    if (at < 0 || v > errors[at]) at = i;
  });
  const worst = index[at] ?? at;
  const e = [...errors].sort((a, b) => a - b);
  return { p50: e[Math.floor(0.5 * (e.length - 1))], p99: e[Math.floor(0.99 * (e.length - 1))], max: e[e.length - 1], over: e.filter((v) => v > 1).length, at: worst };
}

/** |ΔL*| per pixel between a frame (RGBA) and a reference (RGB), both linear
 *  Rec.709. Pixels the reference puts at or above 0.97 are left out: core
 *  rebuilds such channels after the decode stages (reconstructClipped), and
 *  core holds negative channels at 0 after them, so both sides are compared
 *  from 0 up. */
const pos = (r: number, g: number, b: number): [number, number, number] => [Math.max(r, 0) * 65535, Math.max(g, 0) * 65535, Math.max(b, 0) * 65535];
function lightnessError(frame: Float32Array, want: Float32Array): Stats {
  const e: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < want.length / 3; k++) {
    if (Math.max(want[3 * k], want[3 * k + 1], want[3 * k + 2]) >= 0.97) continue;
    const a = rgb2lab(...pos(frame[4 * k], frame[4 * k + 1], frame[4 * k + 2]), XYZ_FROM_SRGB);
    const b = rgb2lab(...pos(want[3 * k], want[3 * k + 1], want[3 * k + 2]), XYZ_FROM_SRGB);
    e.push(Math.abs(a[0] - b[0]) / 327.68);
    index.push(k);
  }
  return stats(e, index);
}

function moved(img: FloatImage, want: Float32Array): number {
  let worst = 0;
  for (let k = 0; k < want.length / 3; k++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(want[3 * k + c] - img.data[4 * k + c]));
  return worst;
}

const CASES: [string, Partial<Params>, View?][] = [
  ["high, radius 6, strength 100", { radius: 6, strength: 100 }],
  ["low, radius 20, strength 80", { method: "low", radius: 20, strength: 80 }],
  ["uniform, radius 12, scale 5", { method: "uniform", radius: 12, scales: 5, strength: 80 }],
  ["whole σ, box size ties (uniform, radius 20, scale 4)", { method: "uniform", radius: 20, scales: 4, strength: 80 }],
  ["HSL logarithmic", { space: "hslLog", radius: 10, strength: 80 }],
  ["HSL linear", { space: "hslLinear", radius: 10, strength: 80 }],
  ["gamma middle", { gamma: "middle", radius: 10, strength: 60 }],
  ["Gaussian mask", { maskMethod: "gaussian", maskHighlights: 60, maskShadows: 40, radius: 10, strength: 80 }],
  ["3 iterations", { iterations: 3, scaleGradient: 2, transmissionGradient: 2, strengthGradient: -1, radius: 12, strength: 60 }],
  ["median, no gain curve", { median: true, gainCurve: [0], radius: 10, strength: 70 }],
  ["highlights plus", { method: "highlightsPlus", radius: 6, strength: 90 }],
  ["highlight, strength by hue", { method: "highlight", radius: 6, strength: 90, hueCurve: [1, 0, 0.5, 0.35, 0.35, 0.25, 0.85, 0.35, 0.35, 0.6, 0.25, 0.35, 0.35] }],
  ["free gamma 0.8/5, L=f(L)", { gamma: "free", gammaValue: 0.8, gammaSlope: 5, lightnessCurve: [1, 0, 0, 0.3, 0.42, 0.7, 0.8, 1, 1], radius: 10, strength: 70 }],
  ["sharp mask total, mask curve", { maskMethod: "total", maskCurve: [1, 0, 0, 0.4, 0.55, 1, 1], maskHighlights: 30, maskShadows: 70, radius: 10, strength: 80 }],
  ["sharp mask partial, uniform 6 scales", { maskMethod: "partial", method: "uniform", scales: 6, maskHighlights: 50, maskShadows: 50, radius: 14, strength: 80 }],
  ["no transmission, offset, contrast, threshold", { transmissionCurve: [0], offset: 2000, contrast: 60, threshold: 30, radius: 10, strength: 70 }],
  ["5 iterations, low, scale 8, gradient 6", { iterations: 5, scaleGradient: 6, scales: 8, method: "low", radius: 20, strength: 50 }],
  ["view mask", { radius: 10 }, "mask"],
  ["view unsharp", { radius: 10, strength: 50 }, "unsharp"],
  ["view transmission auto", { radius: 10 }, "transmissionAuto"],
  ["view transmission fixed, median", { radius: 10, median: true }, "transmissionFixed"],
  ["view transmission fixed", { radius: 10 }, "transmissionFixed"],
  ["view transmission auto, median", { radius: 10, median: true }, "transmissionAuto"],
  ["view transmission auto, 3 iterations", { iterations: 3, scaleGradient: 2, radius: 10 }, "transmissionAuto"],
  ["view unsharp, 2 iterations", { iterations: 2, radius: 10, strength: 50 }, "unsharp"],
];

/** The view values view.ts sets for `view` at `p`'s iteration count. */
function viewValues(p: Params, view: View | undefined): Record<string, number> {
  if (!view || view === "standard") return {};
  const index = VIEWS.indexOf(view);
  return { [qualified(VIEW_KEY)]: index, [qualified(VIEW_P1_KEY)]: p.iterations === 1 ? index : 0 };
}

function worstChange(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe("Retinex on the GPU", () => {
  it("matches the reference at 640 × 400 with the default radius", () => {
    const big = scene(640, 400);
    const p = full({ strength: 100 });
    const frame = render(big, { on: bagPatch(p) }).on;
    const e = lightnessError(frame, reference(big, p));
    console.log(`defaults at 640×400: |ΔL*| p50 ${e.p50.toExponential(2)} p99 ${e.p99.toExponential(2)} max ${e.max.toExponential(2)}`);
    expect(e.p99).toBeLessThan(0.3);
  });

  it("undoes and puts back the RAW baseline around the change", () => {
    const p = full({ radius: 10, strength: 80 });
    const on = render(img, { on: bagPatch(p) }, BASE_PROBE).on;
    const want = reference(img, p);
    const wantImage = floatImage(W, H, (x, y) => {
      const k = 3 * (y * W + x);
      return [want[k], want[k + 1], want[k + 2]];
    });
    const expected = render(wantImage, { off: resetPatch() }, BASE_PROBE).off;
    const e: number[] = [];
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) e.push(Math.abs(on[4 * i + c] - expected[4 * i + c]) / Math.max(0.01, Math.abs(expected[4 * i + c])));
    const st = stats(e);
    console.log(`baseline round trip: relative p99 ${st.p99.toExponential(2)} max ${st.max.toExponential(2)}`);
    expect(st.p99).toBeLessThan(0.02);
  });

  it("leaves the frame alone when the draw counts don't fit the params", () => {
    const p = full({ radius: 10, strength: 80 });
    const frames = render(img, { off: resetPatch(), short: { ...bagPatch(p), [qualified("p1Draws")]: Number(bagPatch(p)[qualified("p1Draws")]) - 1 } });
    expect(worstChange(frames.short, frames.off)).toBe(0);
  });

  it("leaves the frame alone with another version's derived values, or when the later iterations didn't run", () => {
    const one = bagPatch(full({ radius: 10, strength: 80 }));
    const conv = [...(one[qualified("rtConv")] as number[])];
    conv[4] = 2.5;
    const three = bagPatch(full({ iterations: 3, radius: 10, strength: 80 }));
    const frames = render(img, {
      off: resetPatch(),
      stale: { ...one, [qualified("rtConv")]: conv },
      skipped: { ...three, [qualified("p2Draws")]: 0 },
      ran: three,
    });
    expect(worstChange(frames.stale, frames.off)).toBe(0);
    expect(worstChange(frames.skipped, frames.off)).toBe(0);
    expect(worstChange(frames.ran, frames.off)).toBeGreaterThan(0.005);
  });

  it("keeps black pixels and a flat frame finite in every view", () => {
    const flat = floatImage(64, 48, () => [0.4, 0.4, 0.4]);
    const halves = floatImage(64, 48, (x) => (x < 32 ? [0, 0, 0] : [0.4, 0.3, 0.2]));
    for (const space of ["lab", "hslLog", "hslLinear"] as const) {
      for (const view of VIEWS) {
        const p = full({ space, radius: 10, strength: 80 });
        const bag = { ...bagPatch(p), ...viewValues(p, view) };
        for (const [name, image] of [["flat", flat], ["black and grey", halves]] as const) {
          const frame = render(image, { [view]: bag })[view];
          expect(frame.every(Number.isFinite), `${name}, ${space}, ${view}`).toBe(true);
        }
      }
    }
  });

  const img = scene(W, H);

  it.each([
    ["HSL linear", "hslLinear", 80],
    ["HSL linear", "hslLinear", 30],
    ["HSL linear", "hslLinear", 10],
    ["L*a*b*", "lab", 80],
  ] as const)("follows large radii on a small frame: %s (%s), Radius %i", (_name, space, radius) => {
    const big = texture(640, 400);
    const p = full({ space, radius, strength: 100 });
    const frame = render(big, { on: bagPatch(p) }).on;
    const e = lightnessError(frame, reference(big, p));
    console.log(`texture 640×400 ${space} Radius ${radius}: |ΔL*| p50 ${e.p50.toExponential(2)} p99 ${e.p99.toExponential(2)} max ${e.max.toExponential(2)}`);
    expect(e.p99).toBeLessThan(0.05);
    expect(e.max).toBeLessThan(1);
  });

  it("compiles every pass and the inline", () => {
    expect(rendererBuildError({ stages: [...builtinStages(), retinexStage()], pipeline: OPEN_PROBE })).toBeNull();
  });

  it("leaves the frame as it was while off", () => {
    const frames = render(img, { off: resetPatch(), none: {} });
    const plain = render(img, { plain: {} }, OPEN_PROBE, []).plain;
    let worst = 0;
    for (let i = 0; i < plain.length; i++) worst = Math.max(worst, Math.abs(frames.off[i] - plain[i]), Math.abs(frames.none[i] - plain[i]));
    expect(worst).toBe(0);
  });

  const bags: Record<string, Record<string, unknown>> = {};
  for (const [name, p, view] of CASES) bags[name] = { ...bagPatch(full(p)), ...viewValues(full(p), view) };

  it.each(CASES)("matches the reference: %s", (name, p, view) => {
    const frames = render(img, { [name]: bags[name] });
    const want = reference(img, full(p), view);
    const e = lightnessError(frames[name], want);
    const k = e.at;
    console.log(`${name}: |ΔL*| p50 ${e.p50.toExponential(2)} p99 ${e.p99.toExponential(2)} max ${e.max.toExponential(2)}, ${e.over} over 1 L*, worst at (${k % W}, ${Math.floor(k / W)}): got ${[0, 1, 2].map((c) => frames[name][4 * k + c].toFixed(4))} want ${[0, 1, 2].map((c) => want[3 * k + c].toFixed(4))}`);
    expect(moved(img, want), "the case changes the image").toBeGreaterThan(0.005);
    expect(e.p99).toBeLessThan(0.25);
    // Five iterations of small scales amplify the half-float storage of the
    // source and the blurs at the rim of a flat region at the floor, where the
    // reference itself flips between two outcomes (docs/SPEC.md §5).
    if (name.startsWith("5 iterations")) {
      expect(e.over).toBeLessThan(5);
      expect(e.max).toBeLessThan(2);
    } else expect(e.max).toBeLessThan(1);
  });
});
