// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The edit as the panel holds it, RawTherapee's RetinexParams it stands for,
// and everything the passes read, worked out on the CPU: each iteration's
// scales and constants (rt-plan.ts), the gamma constants, the curves as
// samples and RawTherapee's own 501-entry transmission and gain tables, and
// the draw counts of the fixed-slot schedule (schedule.ts).

import { DCT, FCT, diagonalLut, hueCurve, transmissionLut } from "./curves";
import { calcGamma, iterationPlans, type RetinexParams } from "./rt-plan";
import { MAX_SCALES, iterationSlots, type IterationShape } from "./schedule";

export const METHODS = ["low", "uniform", "high", "highlight", "highlightsPlus"] as const;
export type Method = (typeof METHODS)[number];
export const SPACES = ["lab", "hslLog", "hslLinear"] as const;
export type Space = (typeof SPACES)[number];
export const GAMMAS = ["none", "low", "middle", "high", "free"] as const;
export type Gamma = (typeof GAMMAS)[number];
export const MASKS = ["none", "gaussian", "partial", "total"] as const;
export type MaskMethod = (typeof MASKS)[number];
export const VIEWS = ["standard", "unsharp", "mask", "transmissionAuto", "transmissionFixed"] as const;
export type View = (typeof VIEWS)[number];

export interface Params {
  on: boolean;
  advanced: boolean;
  method: Method;
  space: Space;
  strength: number;
  radius: number;
  contrast: number;
  highlightThreshold: number;
  protectFrom: number;
  protectSoftness: number;
  protectAmount: number;
  maskMethod: MaskMethod;
  maskHighlights: number;
  maskHighlightsWidth: number;
  maskShadows: number;
  maskShadowsWidth: number;
  maskRadius: number;
  gamma: Gamma;
  gammaValue: number;
  gammaSlope: number;
  iterations: number;
  scaleGradient: number;
  transmissionGradient: number;
  strengthGradient: number;
  scales: number;
  threshold: number;
  median: boolean;
  offset: number;
  /** Curves in RawTherapee's profile layout (first number the type). */
  lightnessCurve: number[];
  lightnessCurveHsl: number[];
  maskCurve: number[];
  hueCurve: number[];
  transmissionCurve: number[];
  gainCurve: number[];
}

export type NumericKey = {
  [K in keyof Params]: Params[K] extends number ? K : never;
}[keyof Params];

export type CurveKey = "lightnessCurve" | "lightnessCurveHsl" | "maskCurve" | "hueCurve" | "transmissionCurve" | "gainCurve";
export const DIAGONAL_CURVES: readonly CurveKey[] = ["lightnessCurve", "lightnessCurveHsl", "maskCurve"];
export const FLAT_CURVES: readonly CurveKey[] = ["hueCurve", "transmissionCurve", "gainCurve"];

/** retinex.cc 86-106, 184-207, 335-343, 366-388, 426-436, 481 (RawTherapee's
 *  ranges), plus Highlights+ (docs/SPEC.md §1.12). */
export const RANGES: Record<NumericKey, { min: number; max: number; step: number }> = {
  strength: { min: 0, max: 100, step: 1 },
  radius: { min: 6, max: 100, step: 1 },
  contrast: { min: 50, max: 500, step: 1 },
  highlightThreshold: { min: 1, max: 20, step: 1 },
  protectFrom: { min: 0, max: 100, step: 1 },
  protectSoftness: { min: 1, max: 50, step: 1 },
  protectAmount: { min: 0, max: 100, step: 1 },
  maskHighlights: { min: 0, max: 100, step: 1 },
  maskHighlightsWidth: { min: 10, max: 100, step: 1 },
  maskShadows: { min: 0, max: 100, step: 1 },
  maskShadowsWidth: { min: 10, max: 100, step: 1 },
  maskRadius: { min: 5, max: 100, step: 1 },
  gammaValue: { min: 0.6, max: 3, step: 0.01 },
  gammaSlope: { min: 1, max: 20, step: 0.1 },
  iterations: { min: 1, max: 5, step: 1 },
  scaleGradient: { min: -1, max: 6, step: 1 },
  transmissionGradient: { min: -2, max: 2, step: 1 },
  strengthGradient: { min: -2, max: 2, step: 1 },
  scales: { min: 1, max: 8, step: 1 },
  threshold: { min: 2, max: 100, step: 1 },
  offset: { min: -1000, max: 5000, step: 1 },
};

/** procparams.cc 674-748. */
export const DEFAULT_TRANSMISSION = [FCT.controlPoints, 0, 0.5, 0.35, 0.35, 0.6, 0.75, 0.35, 0.35, 1, 0.5, 0.35, 0.35];
export const DEFAULT_GAIN = [FCT.controlPoints, 0, 0.1, 0.35, 0, 0.25, 0.25, 0.35, 0.35, 0.7, 0.25, 0.35, 0.35, 1, 0.1, 0, 0];

export const DEFAULT_PARAMS: Params = {
  on: false,
  advanced: false,
  method: "high",
  space: "lab",
  strength: 20,
  radius: 80,
  contrast: 200,
  highlightThreshold: 4,
  protectFrom: 70,
  protectSoftness: 20,
  protectAmount: 100,
  maskMethod: "none",
  maskHighlights: 0,
  maskHighlightsWidth: 80,
  maskShadows: 0,
  maskShadowsWidth: 80,
  maskRadius: 40,
  gamma: "none",
  gammaValue: 1.3,
  gammaSlope: 3,
  iterations: 1,
  scaleGradient: 3,
  transmissionGradient: 1,
  strengthGradient: 1,
  scales: 3,
  threshold: 8,
  median: false,
  offset: 0,
  lightnessCurve: [DCT.linear],
  lightnessCurveHsl: [DCT.linear],
  maskCurve: [DCT.linear],
  hueCurve: [FCT.linear],
  transmissionCurve: DEFAULT_TRANSMISSION,
  gainCurve: DEFAULT_GAIN,
};

const RT_METHOD: Record<Method, RetinexParams["retinexMethod"]> = { low: "low", uniform: "uni", high: "high", highlight: "highli", highlightsPlus: "highliplus" };
const RT_SPACE: Record<Space, RetinexParams["retinexcolorspace"]> = { lab: "Lab", hslLog: "HSLLOG", hslLinear: "HSLLIN" };
const RT_GAMMA: Record<Gamma, RetinexParams["gammaretinex"]> = { none: "none", low: "low", middle: "mid", high: "hig", free: "fre" };
const RT_MASK: Record<MaskMethod, RetinexParams["mapMethod"]> = { none: "none", gaussian: "gaus", partial: "map", total: "mapT" };
const RT_VIEW: Record<View, RetinexParams["viewMethod"]> = { standard: "none", unsharp: "unsharp", mask: "mask", transmissionAuto: "tran", transmissionFixed: "tran2" };

/** RawTherapee's RetinexParams for this edit and view. */
export function rtParams(p: Params, view: View = "standard"): RetinexParams {
  return {
    cdcurve: p.lightnessCurve,
    cdHcurve: p.lightnessCurveHsl,
    lhcurve: p.hueCurve,
    transmissionCurve: p.transmissionCurve,
    gaintransmissionCurve: p.gainCurve,
    mapcurve: p.maskCurve,
    str: p.strength,
    scal: p.scaleGradient,
    iter: p.iterations,
    grad: p.transmissionGradient,
    grads: p.strengthGradient,
    gam: p.gammaValue,
    slope: p.gammaSlope,
    neigh: p.radius,
    offs: p.offset,
    highlights: p.maskHighlights,
    htonalwidth: p.maskHighlightsWidth,
    shadows: p.maskShadows,
    stonalwidth: p.maskShadowsWidth,
    radius: p.maskRadius,
    retinexMethod: RT_METHOD[p.method],
    retinexcolorspace: RT_SPACE[p.space],
    gammaretinex: RT_GAMMA[p.gamma],
    mapMethod: RT_MASK[p.maskMethod],
    viewMethod: RT_VIEW[view],
    vart: p.contrast,
    limd: p.threshold,
    highl: p.highlightThreshold,
    skal: p.scales,
    medianmap: p.median,
    protectFrom: p.protectFrom,
    protectSoftness: p.protectSoftness,
    protectAmount: p.protectAmount,
  };
}

const mapMet = (p: Params): number => ({ none: 0, gaussian: 4, partial: 2, total: 3 })[p.maskMethod];

/** The schedule's view of each iteration. */
export function shapes(p: Params): IterationShape[] {
  const rt = rtParams(p);
  const met = mapMet(p);
  const hasTransmission = transmissionLut(p.transmissionCurve) !== null;
  return iterationPlans(rt).map((plan) => ({
    n: plan.scal,
    sigma: plan.scales,
    maskAt: (s: number) => plan.it === 1 && (met === 3 || met === 4 || (met === 2 && s > 2)),
    hasTransmission,
    median: plan.it === 1 && p.median,
  }));
}

export interface DrawCounts {
  p1Draws: number;
  p2Draws: number;
  p3Draws: number;
}

/** P1 runs iteration 1 through its statistics, P2 the later iterations, P3
 *  the final draw; all 0 while off. */
export function drawCounts(p: Params): DrawCounts {
  if (!p.on) return { p1Draws: 0, p2Draws: 0, p3Draws: 0 };
  const all = shapes(p);
  return {
    p1Draws: iterationSlots(all[0]),
    p2Draws: all.slice(1).reduce((n, s) => n + iterationSlots(s), 0),
    p3Draws: 1,
  };
}

// ── what the passes read ─────────────────────────────────────────────────────

/** Samples a diagonal curve's table carries for the GPU. */
export const DIAGONAL_SAMPLES = 256;
export const HUE_SAMPLES = 256;

/** The gamma constants of one direction: [form, γ, start, slope], [mul, add, clip, on].
 *  Form 0 is gammareti (x ≤ start ? x·slope : x^(1/γ)·mul − add), 1 igammareti. */
export function gammaConstants(p: Params, inverse: boolean): number[] {
  const on = p.gamma !== "none" && p.strength !== 0 ? 1 : 0;
  const fixed: Record<"low" | "middle" | "high", [number, number, number, number, number]> = {
    low: [1.15, 0.001692, 2, 1.000508, 0.000508],
    middle: [1.3, 0.016613, 2, 1.009968, 0.009968],
    high: [1.45, 0.009115, 3, 1.012305, 0.012305],
  };
  if (p.gamma === "none") return [0, 1, 0, 1, 1, 0, 0, 0];
  if (p.gamma !== "free") {
    const [g, start, slope, mul, add] = fixed[p.gamma];
    return [inverse ? 1 : 0, g, start, slope, mul, add, 0, on];
  }
  let pwr = 1 / p.gammaValue;
  let gamm = p.gammaValue;
  const low = p.gammaValue < 1;
  if (low) [pwr, gamm] = [gamm, pwr];
  const g = calcGamma(pwr, p.gammaSlope);
  const mul = 1 + g[4];
  let start: number;
  let add: number;
  if (!inverse) {
    start = low ? g[2] : g[3];
    add = g[4];
  } else if (low) {
    start = g[3];
    add = g[3];
  } else {
    start = g[2];
    add = g[4];
  }
  const form = inverse ? (low ? 0 : 1) : low ? 1 : 0;
  return [form, gamm, start, p.gammaSlope, mul, add, 1, on];
}

/** A 65536-entry diagonal table as samples (÷65535) and its two end lines. */
function diagonalData(points: readonly number[]): { samples: number[]; ends: number[]; on: boolean } {
  const lut = diagonalLut(points);
  if (!lut) return { samples: new Array<number>(DIAGONAL_SAMPLES).fill(0), ends: [0, 0, 0, 0], on: false };
  const samples: number[] = [];
  for (let k = 0; k < DIAGONAL_SAMPLES; k++) {
    const x = (k * 65535) / (DIAGONAL_SAMPLES - 1);
    const i = Math.min(Math.floor(x), 65534);
    samples.push((lut[i] + (lut[i + 1] - lut[i]) * (x - i)) / 65535);
  }
  return { samples, ends: [lut[0] / 65535, (lut[1] - lut[0]) / 65535, lut[65534] / 65535, (lut[65535] - lut[65534]) / 65535], on: true };
}

function table501(points: readonly number[]): { values: number[]; on: boolean } {
  const lut = transmissionLut(points);
  const values = new Array<number>(504).fill(0);
  if (lut) for (let i = 0; i < 501; i++) values[i] = lut[i];
  return { values, on: lut !== null };
}

function hueSamples(points: readonly number[]): { samples: number[]; on: boolean } {
  const curve = hueCurve(points);
  const samples: number[] = [];
  for (let k = 0; k < HUE_SAMPLES; k++) samples.push(curve ? curve.getVal(k / HUE_SAMPLES) : 0.5);
  return { samples, on: curve !== null };
}

/** A marker every pass checks in each of its plan arrays, so a bag without
 *  its derived values (an edit from elsewhere, a preset applied a frame ago)
 *  or with another version's draws nothing. 1000 + the layout's version. */
export const DERIVED_MARK = 1001;

export type Derived = Record<string, number[]>;

/** Every pass uniform's value, by key. */
export function derive(p: Params): Derived {
  const rt = rtParams(p);
  const plans = iterationPlans(rt);
  const logMode = p.space === "hslLinear" ? 0 : 1;
  const trans = table501(p.transmissionCurve);
  const gain = table501(p.gainCurve);
  const hue = hueSamples(p.hueCurve);
  const cd = diagonalData(p.space === "lab" ? p.lightnessCurve : p.lightnessCurveHsl);
  const map = diagonalData(p.maskCurve);
  const sigmas = (k: number): number[] => {
    const s = new Array<number>(MAX_SCALES).fill(0);
    plans[k]?.scales.forEach((v, i) => (s[i] = v));
    return s;
  };
  const it1 = plans[0];
  const iters: number[] = [];
  for (let k = 0; k < 5; k++) {
    const plan = plans[k];
    iters.push(...sigmas(k));
    iters.push(plan?.scal ?? 0, plan?.pond ?? 0, plan?.limdx ?? 1, plan?.ilimdx ?? 1);
    iters.push(plan?.varx ?? 0, plan?.strengthx ?? 0, 0, k === 0 ? DERIVED_MARK : 0);
  }
  const method = METHODS.indexOf(p.method);
  return {
    rtIt1: [...sigmas(0), it1.scal, it1.pond, it1.limdx, it1.ilimdx, logMode, trans.on ? 1 : 0, p.median ? 1 : 0, p.iterations],
    rtMask: [mapMet(p), map.on ? 1 : 0, p.maskHighlights, p.maskHighlightsWidth, p.maskShadows, p.maskShadowsWidth, p.maskMethod === "gaussian" ? p.maskRadius : 40, DERIVED_MARK],
    rtIters: iters,
    rtFlags: [p.iterations, trans.on ? 1 : 0, gain.on ? 1 : 0, hue.on ? 1 : 0, logMode, method, p.offset, p.method === "highlight" && hue.on ? 1 : 0, p.median ? 1 : 0, 0, 0, DERIVED_MARK],
    rtProtect: [p.protectFrom, p.protectSoftness, p.protectAmount / 100, p.method === "highlightsPlus" ? 1 : 0],
    rtConv: [SPACES.indexOf(p.space), cd.on ? 1 : 0, p.gamma !== "none" && p.strength !== 0 ? 1 : 0, 0, DERIVED_MARK, 0, 0, 0],
    rtGammaIn: gammaConstants(p, false),
    rtGammaOut: gammaConstants(p, true),
    rtCd: cd.samples,
    rtCdEnds: cd.ends,
    rtMap: map.samples,
    rtMapEnds: map.ends,
    rtTransA: trans.values.slice(0, 252),
    rtTransB: trans.values.slice(252),
    rtGainA: gain.values.slice(0, 252),
    rtGainB: gain.values.slice(252),
    rtHue: hue.samples,
  };
}

/** Each derived key's vec4 count. */
export const DERIVED_SIZES: Record<string, number> = {
  rtIt1: 4,
  rtMask: 2,
  rtIters: 20,
  rtFlags: 3,
  rtProtect: 1,
  rtConv: 2,
  rtGammaIn: 2,
  rtGammaOut: 2,
  rtCd: DIAGONAL_SAMPLES / 4,
  rtCdEnds: 1,
  rtMap: DIAGONAL_SAMPLES / 4,
  rtMapEnds: 1,
  rtTransA: 63,
  rtTransB: 63,
  rtGainA: 63,
  rtGainB: 63,
  rtHue: HUE_SAMPLES / 4,
};
