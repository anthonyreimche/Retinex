// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// A float32 transcription of RawTherapee 5.13's Retinex: rtengine/ipretinex.cc
// (retinex_scales, mean_stddv2, MSR), rtengine/rawimagesource.cc
// (retinexPrepareBuffers, retinexPrepareCurves, retinex), the iterated box blur
// of rtengine/gauss.cc and rtengine/boxblur.cc, SHMap::updateL of
// rtengine/shmap.cc, the median of rtengine/median.h and the colour helpers of
// rtengine/color.cc/.h. Loops, borders, LUT indexing and quirks are
// RawTherapee's; the SSE paths the x86 CLI runs are written out in scalar form.
//
// ipretinex.cc: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>;
//   adaptation 2015 Jacques Desmis <jdesmis@gmail.com>, 2015 Ingo Weyrich
//   <heckflosse67@gmx.de>
// rawimagesource.cc, gauss.cc, shmap.cc, color.cc, color.h, median.h,
//   curves.cc: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// boxblur.cc: Copyright (C) 2010 Emil Martinec <ejmartin@uchicago.edu>;
//   Copyright (C) 2019 Ingo Weyrich <heckflosse67@gmx.de>
// LUT.h: Copyright (c) 2011 Jan Rinze Peterzon (janrinze@gmail.com)
//
// `Options.safelight` switches on Safelight's stated deviations (docs/SPEC.md
// §0): the cd ceiling at the original lightness, views at the final iteration
// only, the working Highlights+, the HSL and ratio guards. Off, this is
// RawTherapee.

import { diagonalLut, hueCurve, lutAt, transmissionLut, type FlatCurve } from "../../src/curves";
import {
  REC2020_FROM_XYZ,
  XYZ_FROM_SRGB,
  boxRadii,
  calcGamma,
  invert3,
  iterationPlans,
  protection,
  type IterationPlan,
  type Mat3,
  type RetinexParams,
} from "../../src/rt-plan";

export * from "../../src/rt-plan";

const f = Math.fround;

export interface Options {
  /** The working profile's matrix, RGB → XYZ (D50), as rgbxyz applies it. */
  working: Mat3;
  /** The inverse matrix the gamut control tests RGB with. */
  gamutInverse: Mat3;
  /** The inverse matrix the result is converted back with. */
  backInverse: Mat3;
  /** ToneCurveParams::hrenabled, the gamut control's "highlight" flag. */
  highlight: boolean;
  /** Safelight's deviations (docs/SPEC.md §0). */
  safelight: boolean;
  /** Rounds the log map, the source and each scale's blur to half floats
   *  where the passes store them, to measure that storage's share of the GPU's
   *  error (L* units, as the passes keep them). */
  half?: { map?: boolean; source?: boolean; blur?: boolean; stats?: boolean | "extremes" | "moments" };
  /** Each scale's blur of an iteration's source, by RawTherapee's scale index,
   *  in place of the exact iterated boxes: a model of the passes' chain. */
  chain?: (src: Float32Array, W: number, H: number, scales: readonly number[]) => Float32Array[];
}

/** The nearest half float (11 significant bits, ties to even). */
export function toHalf(x: number): number {
  const a = Math.abs(x);
  if (a === 0 || !Number.isFinite(a)) return x;
  const step = a < 2 ** -14 ? 2 ** -24 : 2 ** (Math.floor(Math.log2(a)) - 10);
  const q = x / step;
  const r = Math.round(q);
  return (Math.abs(q - Math.trunc(q)) === 0.5 && r % 2 !== 0 ? r - Math.sign(q) : r) * step;
}

export const RT_SRGB: Options = {
  working: XYZ_FROM_SRGB,
  gamutInverse: invert3(XYZ_FROM_SRGB),
  backInverse: invert3(XYZ_FROM_SRGB),
  highlight: false,
  safelight: false,
};

/** What Safelight's stage computes: Lab from Rec.709, the gamut tested in
 *  Rec.2020, highlight flag on, the deviations on. */
export const SAFELIGHT: Options = {
  working: XYZ_FROM_SRGB,
  gamutInverse: REC2020_FROM_XYZ,
  backInverse: invert3(XYZ_FROM_SRGB),
  highlight: true,
  safelight: true,
};

// ── colour helpers (color.cc / color.h) ──────────────────────────────────────

const D50X = f(0.9642);
const D50Z = f(0.8249);
const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;
const MAXVALF = 65535;

let cachef: Float32Array | null = null;
let cachefy: Float32Array | null = null;

/** color.cc 200-233. */
function tables(): [Float32Array, Float32Array] {
  if (!cachef || !cachefy) {
    cachef = new Float32Array(65536);
    cachefy = new Float32Array(65536);
    const epsmaxint = Math.trunc(MAXVALF * EPSILON);
    for (let i = 0; i < 65536; i++) {
      cachef[i] = i <= epsmaxint ? 327.68 * ((KAPPA * i) / MAXVALF + 16) / 116 : 327.68 * Math.cbrt(i / MAXVALF);
      cachefy[i] = i <= epsmaxint ? 327.68 * ((KAPPA * i) / MAXVALF) : 327.68 * (116 * Math.cbrt(i / MAXVALF) - 16);
    }
  }
  return [cachef, cachefy];
}

/** Color::computeXYZ2Lab (color.cc:1715-1724). */
function xyz2labF(v: number): number {
  if (v < 0) return f(327.68 * ((KAPPA * v) / MAXVALF + 16) / 116);
  if (v > 65535) return f(327.68 * Math.cbrt(v / MAXVALF));
  return lutAt(tables()[0], v, false);
}

/** Color::computeXYZ2LabY (color.h:177-186). */
function xyz2labY(v: number): number {
  if (v < 0) return f(327.68 * ((KAPPA * v) / MAXVALF));
  if (v > 65535) return f(327.68 * (116 * Math.cbrt(v / MAXVALF) - 16));
  return lutAt(tables()[1], v, false);
}

/** Color::rgbxyz then Color::XYZ2Lab (color.cc:1035-1040, 1874-1889). */
export function rgb2lab(r: number, g: number, b: number, m: Mat3): [number, number, number] {
  const wp = m.map((row) => row.map(f));
  const X = f(f(f(wp[0][0] * r) + f(wp[0][1] * g)) + f(wp[0][2] * b));
  const Y = f(f(f(wp[1][0] * r) + f(wp[1][1] * g)) + f(wp[1][2] * b));
  const Z = f(f(f(wp[2][0] * r) + f(wp[2][1] * g)) + f(wp[2][2] * b));
  const fx = xyz2labF(f(X / D50X));
  const fy = xyz2labF(Y);
  const fz = xyz2labF(f(Z / D50Z));
  return [xyz2labY(Y), f(500 * (fx - fy)), f(200 * (fy - fz))];
}

const C1BY116 = f(1 / 116);
const C16BY116 = f(16 / 116);
const KAPPA_INVF = f(27 / 24389);
const EPS_INV3F = f(6 / 29);

/** Color::f2xyz, in float (color.h:754-770). */
const f2xyz = (v: number): number => (v > EPS_INV3F ? f(f(v * v) * v) : f(f(f(116 * v) - 16) * KAPPA_INVF));

/** Color::Lab2XYZ, the SSE form (color.h:642-660), then xyz2rgb with `inv`
 *  as floats (color.h:590-597). */
export function lab2rgb(L: number, a: number, b: number, inv: Mat3): [number, number, number] {
  const c327 = f(327.68);
  const LL = f(L / c327);
  const aa = f(a / c327);
  const bb = f(b / c327);
  const fy = f(f(C1BY116 * LL) + C16BY116);
  const fx = f(f(f(0.002) * aa) + fy);
  const fz = f(fy - f(f(0.005) * bb));
  const x = f(f(65535 * f2xyz(fx)) * D50X);
  const z = f(f(65535 * f2xyz(fz)) * D50Z);
  const y = f(65535 * (LL > 8 ? f(f(fy * fy) * fy) : f(LL / f(KAPPA))));
  const w = inv.map((row) => row.map(f));
  const row = (k: number): number => f(f(f(w[k][0] * x) + f(w[k][1] * y)) + f(w[k][2] * z));
  return [row(0), row(1), row(2)];
}

/** Color::rgb2hslfloat (color.h:273-306). */
export function rgb2hsl(r: number, g: number, b: number, guard: boolean): [number, number, number] {
  const minVal = Math.min(r, g, b);
  const maxVal = Math.max(r, g, b);
  const C = f(maxVal - minVal);
  const sum = f(maxVal + minVal);
  const l = f(sum * f(7.6295109e-6));
  if (C < f(0.65535)) return [0, 0, l];
  let s: number;
  if (l <= 0.5) s = f(C / sum);
  else s = guard && sum >= 131070 ? 0 : f(C / f(131070 - sum));
  let h: number;
  if (r === maxVal) h = f(g - b);
  else if (g === maxVal) h = f(f(2 * C) + f(b - r));
  else h = f(f(4 * C) + f(r - g));
  h = f(h / f(6 * C));
  if (h < 0) h = f(h + 1);
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let v = t;
  if (v < 0) v += 6;
  else if (v > 6) v -= 6;
  if (v < 1) return p + (q - p) * v;
  if (v < 3) return q;
  if (v < 4) return p + (q - p) * (4 - v);
  return p;
}

/** Color::hsl2rgbfloat (color.h:324-344). */
export function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [f(65535 * l), f(65535 * l), f(65535 * l)];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  return [f(65535 * hue2rgb(m1, m2, h * 6 + 2)), f(65535 * hue2rgb(m1, m2, h * 6)), f(65535 * hue2rgb(m1, m2, h * 6 - 2))];
}

/** Color::huelab_to_huehsv2 (color.h:1914-1947). */
export function huelabToHsv(HH: number): number {
  let hr = 0;
  const H = f(HH);
  if (H >= 0 && H < f(0.6)) hr = 0.11666 * H + 0.93;
  else if (H >= f(0.6) && H < f(1.4)) hr = 0.1125 * H - 0.0675;
  else if (H >= f(1.4) && H < 2) hr = 0.2666 * H - 0.2833;
  else if (H >= 2 && H < f(3.14159)) hr = 0.1489 * H - 0.04785;
  else if (H >= f(-3.14159) && H < f(-2.8)) hr = 0.23419 * H + 1.1557;
  else if (H >= f(-2.8) && H < f(-2.3)) hr = 0.16 * H + 0.948;
  else if (H >= f(-2.3) && H < f(-0.9)) hr = 0.12143 * H + 0.85928;
  else if (H >= f(-0.9) && H < f(-0.1)) hr = 0.2125 * H + 0.94125;
  else if (H >= f(-0.1) && H < 0) hr = 0.1 * H + 0.93;
  if (hr < 0) hr += 1;
  else if (hr > 1) hr -= 1;
  return hr;
}

/** Color::gamutLchonly with sincos (color.cc:2916-3008). Returns L*, C and
 *  the rounds it took. */
export function gamutLch(HH: number, sy: number, sx: number, L0: number, C0: number, inv: Mat3, highlight: boolean): [number, number, number] {
  let L = L0;
  let C = C0;
  let H = HH;
  let rounds = 0;
  for (;;) {
    const a = f(C * sy);
    const b = f(C * sx);
    const fy = f(f(C1BY116 * L) + C16BY116);
    const fx = f(f(f(0.002) * a) + fy);
    const fz = f(fy - f(f(0.005) * b));
    const x = f(f(65535 * f2xyz(fx)) * D50X);
    const z = f(f(65535 * f2xyz(fz)) * D50Z);
    const y = f(L > 8 ? f(f(f(65535 * fy) * fy) * fy) : f(65535 * L) / KAPPA);
    const R = inv[0][0] * x + inv[0][1] * y + inv[0][2] * z;
    const G = inv[1][0] * x + inv[1][1] * y + inv[1][2] * z;
    const B = inv[2][0] * x + inv[2][1] * y + inv[2][2] * z;
    if (R < 0 || G < 0 || B < 0) {
      if (Number.isNaN(H)) H = Math.atan2(C0 * sx * 327.68, C0 * sy * 327.68);
      if (L < 0.1) L = f(0.1);
      if (H < -0.9 && H > -1.55) {
        if (C > 160 && L < 5) L = 5;
        if (C > 140 && L < 3.5) L = f(3.5);
        if (C > 120 && L < 2) L = 2;
        if (C > 105 && L < 1) L = 1;
        if (C > 90 && L < 0.7) L = f(0.7);
        if (C > 50 && L < 0.5) L = 0.5;
        if (C > 20 && L < 0.4) L = f(0.4);
      }
      C = f(C * f(0.96));
      if (C <= 3) L = f(L + f(0.15));
    } else if (!highlight && Math.max(R, G, B) > 65535 && Math.min(R, G, B) <= 65535) {
      if (L > f(99.999)) L = f(99.98);
      C = f(C * f(0.96));
      if (C <= 3) L = f(L - f(0.15));
    } else {
      return [L, C, rounds];
    }
    rounds++;
    if (rounds > 100000) return [L, C, rounds];
  }
}

// ── gamma (rawimagesource.cc 1945-2055, 2216-2263; color.h 1254-1291) ───────

export interface GammaValues {
  g: number[];
}


const gammareti = (x: number, gamma: number, start: number, slope: number, mul: number, add: number): number =>
  x <= start ? x * slope : Math.exp(Math.log(x) / gamma) * mul - add;
const igammareti = (x: number, gamma: number, start: number, slope: number, mul: number, add: number): number =>
  x <= start * slope ? x / slope : Math.exp(Math.log((x + add) / mul) * gamma);

const FIXED: Record<"low" | "mid" | "hig", [(x: number) => number, (x: number) => number]> = {
  low: [
    (x) => (x <= 0.001692 ? x * 2 : 1.000508 * Math.exp(Math.log(x) / 1.15) - 0.000508),
    (x) => (x <= 0.003384 ? x / 2 : Math.exp(Math.log((x + 0.000508) / 1.000508) * 1.15)),
  ],
  mid: [
    (x) => (x <= 0.016613 ? x * 2 : 1.009968 * Math.exp(Math.log(x) / 1.3) - 0.009968),
    (x) => (x <= 0.033226 ? x / 2 : Math.exp(Math.log((x + 0.009968) / 1.009968) * 1.3)),
  ],
  hig: [
    (x) => (x <= 0.009115 ? x * 3 : 1.012305 * Math.exp(Math.log(x) / 1.45) - 0.012305),
    (x) => (x <= 0.027345 ? x / 3 : Math.exp(Math.log((x + 0.012305) / 1.012305) * 1.45)),
  ],
};

export interface GammaTable {
  lut: Float32Array;
  clip: boolean;
}

/** The forward (`inverse` false) or inverse table, or null for "none". */
export function gammaTable(p: RetinexParams, inverse: boolean): GammaTable | null {
  if (p.gammaretinex === "none") return null;
  const lut = new Float32Array(65536);
  if (p.gammaretinex !== "fre") {
    const fn = FIXED[p.gammaretinex][inverse ? 1 : 0];
    for (let i = 0; i < 65536; i++) lut[i] = 65535 * fn(i / 65535);
    return { lut, clip: false };
  }
  let pwr = 1 / p.gam;
  let gamm = p.gam;
  const lowGamma = p.gam < 1;
  if (lowGamma) [pwr, gamm] = [gamm, pwr];
  const g = calcGamma(pwr, p.slope);
  const mul = 1 + g[4];
  let start: number;
  let add: number;
  if (!inverse) {
    start = lowGamma ? g[2] : g[3];
    add = g[4];
  } else if (lowGamma) {
    start = g[3];
    add = g[3];
  } else {
    start = g[2];
    add = g[4];
  }
  const fwd = inverse ? lowGamma : !lowGamma;
  for (let i = 0; i < 65536; i++) {
    const x = fwd ? gammareti(i / 65535, gamm, start, p.slope, mul, add) : igammareti(i / 65535, gamm, start, p.slope, mul, add);
    lut[i] = Math.min(Math.max(x * 65535, 0), 65535);
  }
  return { lut, clip: true };
}

// ── blurs (gauss.cc 1379-1418, boxblur.cc 505-745) ───────────────────────────


/** boxblur(src, dst, radius, W, H): horizontal running mean (divides), then
 *  vertical (the SSE path: multiplies by 1/len in the middle rows). */
export function boxblur(src: Float32Array, W: number, H: number, radius: number): Float32Array {
  const r = Math.min(radius, W - 1, H - 1);
  if (r === 0) return Float32Array.from(src);
  if (2 * r + 1 > Math.min(W, H)) return truncatedBox(src, W, H, r);
  const dst = new Float32Array(W * H);
  for (let row = 0; row < H; row++) {
    const s = row * W;
    let len = f(r + 1);
    let temp = src[s];
    for (let j = 1; j <= r; j++) temp = f(temp + src[s + j]);
    temp = f(temp / len);
    dst[s] = temp;
    for (let col = 1; col <= r; col++) {
      temp = f(f(f(temp * len) + src[s + col + r]) / f(len + 1));
      dst[s + col] = temp;
      len = f(len + 1);
    }
    for (let col = r + 1; col < W - r; col++) {
      temp = f(temp + f(f(src[s + col + r] - src[s + col - r - 1]) / len));
      dst[s + col] = temp;
    }
    for (let col = W - r; col < W; col++) {
      temp = f(f(f(temp * len) - src[s + col - r - 1]) / f(len - 1));
      dst[s + col] = temp;
      len = f(len - 1);
    }
  }
  const out = new Float32Array(W * H);
  for (let col = 0; col < W; col++) {
    let len = f(r + 1);
    let temp = dst[col];
    for (let i = 1; i <= r; i++) temp = f(temp + dst[i * W + col]);
    temp = f(temp / len);
    out[col] = temp;
    for (let row = 1; row <= r; row++) {
      temp = f(f(f(temp * len) + dst[(row + r) * W + col]) / f(len + 1));
      out[row * W + col] = temp;
      len = f(len + 1);
    }
    const rlen = f(1 / len);
    for (let row = r + 1; row < H - r; row++) {
      temp = f(temp + f(f(dst[(row + r) * W + col] - dst[(row - r - 1) * W + col]) * rlen));
      out[row * W + col] = temp;
    }
    for (let row = H - r; row < H; row++) {
      temp = f(f(f(temp * len) - dst[(row - r - 1) * W + col]) / f(len - 1));
      out[row * W + col] = temp;
      len = f(len - 1);
    }
  }
  return out;
}

/** The truncated mean boxblur computes, for windows wider than the image,
 *  where RawTherapee's running sums would read outside it. */
function truncatedBox(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const pass = (a: Float32Array, n: number, m: number, at: (i: number, j: number) => number): Float32Array => {
    const out = new Float32Array(a.length);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        const lo = Math.max(0, i - r);
        const hi = Math.min(n - 1, i + r);
        for (let k = lo; k <= hi; k++) sum += a[at(k, j)];
        out[at(i, j)] = sum / (hi - lo + 1);
      }
    }
    return out;
  };
  const h = pass(src, W, H, (i, j) => j * W + i);
  return pass(h, H, W, (i, j) => i * W + j);
}

export function gaussianBox(src: Float32Array, W: number, H: number, sigma: number): Float32Array {
  let out = src;
  for (const r of boxRadii(sigma, W, H)) out = boxblur(out, W, H, r);
  return out;
}

// ── MSR helpers (ipretinex.cc 103-181) ───────────────────────────────────────


export interface Stats {
  mean: number;
  std: number;
  min: number;
  max: number;
}

export function meanStd(v: Float32Array): Stats {
  let sum = 0;
  let sq = 0;
  let min = f(999999);
  let max = f(-999999);
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    sq += v[i] * v[i];
    if (v[i] > max) max = v[i];
    if (v[i] < min) min = v[i];
  }
  const mean = f(sum / v.length);
  const vs = sq / v.length;
  return { mean, std: f(Math.sqrt(f(vs - mean * mean))), min, max };
}





// ── SHMap (shmap.cc 207-330, 338-450), hq with levrad 2 ──────────────────────

export interface ShMap {
  map: Float32Array;
  max: number;
  min: number;
  avg: number;
}

function dirpyrLevel(fine: Float32Array, W: number, H: number, rangefn: Float32Array, scale: number): Float32Array {
  const coarse = new Float32Array(W * H);
  const scalewin = scale;
  const q = Math.max(0, Math.ceil((W - 2 * scalewin - 3) / 4));
  const sseEnd = scalewin + 4 * q;
  for (let i = 0; i < H; i++) {
    for (let j = 0; j < W; j++) {
      const truncated = j >= scalewin && j < sseEnd;
      const c = fine[i * W + j];
      let val = 0;
      let norm = 0;
      const r0 = Math.max(i - scalewin, i % scale);
      const r1 = Math.min(i + scalewin, H - 1);
      const c0 = j < scalewin ? j % scale : j - scalewin;
      const c1 = Math.min(j + scalewin, W - 1);
      for (let ii = r0; ii <= r1; ii += scale) {
        for (let jj = c0; jj <= c1; jj += scale) {
          const v = fine[ii * W + jj];
          const d = Math.abs(f(v - c));
          const w = truncated ? rangefn[Math.min(Math.max(Math.trunc(d), 0), rangefn.length - 1)] : lutAt(rangefn, d, true);
          val = f(val + f(w * v));
          norm = f(norm + w);
        }
      }
      coarse[i * W + j] = f(val / norm);
    }
  }
  return coarse;
}

export function shmapUpdate(L: Float32Array, W: number, H: number, radius: number): ShMap {
  let thresh = f(100 * radius);
  const lutSize = Math.trunc(Math.trunc(thresh) * f(Math.sqrt(10)) + 1);
  thresh = f(thresh * thresh);
  const rangefn = new Float32Array(lutSize);
  for (let i = 0; i < lutSize - 1; i++) rangefn[i] = Math.exp(-Math.min(10, f(f(i * i) / thresh)));
  rangefn[lutSize - 1] = f(1e-15);
  const filled = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = Math.max(L[i], 0);
  const level0 = dirpyrLevel(filled, W, H, rangefn, 1);
  const map = dirpyrLevel(level0, W, H, rangefn, 2);
  let avg = 0;
  let min = f(65535);
  let max = 0;
  for (let i = 0; i < W * H; i++) {
    min = Math.min(min, map[i]);
    max = Math.max(max, map[i]);
    avg += map[i];
  }
  return { map, max, min, avg: f(avg / (W * H)) };
}

/** median.h's 9-value median. */
export function median9(v: number[]): number {
  return [...v].sort((a, b) => a - b)[4];
}

// ── MSR (ipretinex.cc 189-779) ───────────────────────────────────────────────

export interface MsrDiagnostics {
  plans: IterationPlan[];
  stats: { stats1: Stats; stats2: Stats; mini: number; maxi: number }[];
}

export interface MsrInput {
  W: number;
  H: number;
  /** The working lightness (after L=f(L)), RawTherapee units. */
  luminance: Float32Array;
  /** The lightness before L=f(L). */
  original: Float32Array;
  /** The hue buffer: radians (Lab) or 0..1 (HSL). */
  hue: Float32Array;
}

export function msr(input: MsrInput, p: RetinexParams, opt: Options): { luminance: Float32Array; diag: MsrDiagnostics } {
  const { W, H } = input;
  const N = W * H;
  const eps = 2;
  const useHsl = p.retinexcolorspace === "HSLLOG";
  const useHslLin = p.retinexcolorspace === "HSLLIN";
  const offse = p.offs;
  const hig = f(p.highl / 100);
  const ours = opt.safelight;
  const shcurve: FlatCurve | null = hueCurve(p.lhcurve);
  const higplus = p.retinexMethod === "highliplus";
  const mapmet = p.mapMethod === "map" ? 2 : p.mapMethod === "mapT" ? 3 : p.mapMethod === "gaus" ? 4 : 0;
  const shradius = mapmet === 4 ? p.radius : 40;
  const viewIndex = { none: 0, mask: 1, tran: 2, tran2: 3, unsharp: 4 }[p.viewMethod];
  const mapLut = diagonalLut(p.mapcurve);
  const transLut = transmissionLut(p.transmissionCurve);
  const gainLut = transmissionLut(p.gaintransmissionCurve);
  const plans = iterationPlans(p);
  const diag: MsrDiagnostics = { plans, stats: [] };
  const statsOf = (v: Float32Array): Stats => {
    const st = meanStd(v);
    const h = opt.half?.stats;
    return h ? { mean: h === "extremes" ? st.mean : toHalf(st.mean), std: h === "extremes" ? st.std : toHalf(st.std), min: h === "moments" ? st.min : toHalf(st.min), max: h === "moments" ? st.max : toHalf(st.max) } : st;
  };
  const luminance = Float32Array.from(input.luminance);
  const original = input.original;
  const hue = input.hue;

  for (const plan of plans) {
    const { it, scal, scales, pond, varx, limdx, ilimdx, strengthx } = plan;
    const finalIt = it === p.iter;
    const viewmet = ours && !finalIt ? 0 : viewIndex;
    const src = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      src[i] = f(luminance[i] + eps);
      if (opt.half?.source && it > 1) src[i] = toHalf(src[i] / 327.68) * 327.68;
      luminance[i] = 0;
    }
    let out: Float32Array = src;
    let tran: Float32Array = new Float32Array(N);
    let prev: number | null = null;
    const modelled = opt.chain?.(src, W, H, scales.slice(0, scal));
    for (let scale = scal - 1; scale >= 0; --scale) {
      const sigma = prev === null ? scales[scale] : f(Math.sqrt(f(f(scales[scale] * scales[scale]) - f(scales[scale + 1] * scales[scale + 1]))));
      out = modelled ? modelled[scale] : gaussianBox(out, W, H, sigma);
      if (opt.half?.blur) out = out.map((v) => toHalf(v / 327.68) * 327.68);
      prev = scales[scale];
      let used = out;
      const sh = ((mapmet === 2 && scale > 2) || mapmet === 3 || mapmet === 4) && it === 1;
      let shm: ShMap | null = null;
      let hTh = 0;
      let sTh = 0;
      if (sh) {
        shm = shmapUpdate(out, W, H, shradius);
        hTh = Math.trunc(shm.max - (p.htonalwidth * (shm.max - shm.avg)) / 100);
        sTh = Math.trunc((p.stonalwidth * (shm.avg - shm.min)) / 100);
      }
      if (mapmet > 0 && mapLut && it === 1) {
        used = new Float32Array(N);
        for (let i = 0; i < N; i++) used[i] = f(0.5 * lutAt(mapLut, f(2 * out[i]), false));
      }
      if (sh && shm) {
        if (used === out) used = Float32Array.from(out);
        const hW = f((100 - p.highlights) / 100);
        const sW = f((100 - p.shadows) / 100);
        for (let i = 0; i < N; i++) {
          const mapval = f(1 + shm.map[i]);
          let factor: number;
          if (mapval > hTh) factor = f(f(hTh + f(hW * f(mapval - hTh))) / mapval);
          else if (mapval < sTh) factor = f(f(sTh - f(sW * f(sTh - mapval))) / mapval);
          else factor = 1;
          used[i] = f(used[i] * factor);
        }
      }
      for (let i = 0; i < N; i++) {
        let ratio = f(src[i] / used[i]);
        if (ours && !(ratio > 0)) ratio = src[i] > 0 && !(used[i] > 0) ? limdx : ilimdx;
        const c = Math.min(Math.max(ratio, ilimdx), limdx);
        luminance[i] = f(luminance[i] + f(pond * (useHslLin ? c : f(Math.log(c)))));
        if (opt.half?.map) luminance[i] = toHalf(luminance[i]);
      }
      tran = used;
    }

    let st = statsOf(luminance);
    const stats1 = st;
    let mean = st.mean;
    let stddv = st.std;
    let mintr = st.min;
    let maxtr = st.max;
    const tranView = tran;
    if (transLut && mean !== 0 && stddv !== 0) {
      const asig0 = f(f(0.166666) / stddv);
      const bsig = f(f(0.5 - f(asig0 * mean)) * 500);
      const amax0 = f(f(0.333333) / f(f(maxtr - mean) - stddv));
      const bmax = f(f(1 - f(amax0 * maxtr)) * 500);
      const amin0 = f(f(0.333333) / f(f(mean - stddv) - mintr));
      const bmin = f(f(-amin0 * mintr) * 500);
      const asig = f(asig0 * 500);
      const amax = f(amax0 * 500);
      const amin = f(amin0 * 500);
      const t = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const l = luminance[i];
        let absciss: number;
        if (Math.abs(f(l - mean)) < stddv) absciss = f(f(asig * l) + bsig);
        else if (l >= mean) absciss = f(f(amax * l) + bmax);
        else absciss = f(f(amin * l) + bmin);
        luminance[i] = f(l * f(-1 + f(4 * lutAt(transLut, absciss, true))));
        if (opt.half?.map) luminance[i] = toHalf(luminance[i]);
        t[i] = luminance[i];
      }
      if (viewmet === 3 || viewmet === 2) tran = t;
      if (p.medianmap && it === 1) {
        const tm = Float32Array.from(luminance);
        for (let i = 1; i < H - 1; i++) {
          for (let j = 1; j < W - 1; j++) {
            const k = i * W + j;
            tm[k] = median9([
              luminance[k], luminance[k - W], luminance[k + W], luminance[k + 1], luminance[k - 1],
              luminance[k - W - 1], luminance[k - W + 1], luminance[k + W - 1], luminance[k + W + 1],
            ]);
          }
        }
        luminance.set(tm);
      }
      st = statsOf(luminance);
      mean = st.mean;
      stddv = st.std;
      mintr = st.min;
      maxtr = st.max;
    } else if (viewmet === 3 || viewmet === 2) {
      tran = tranView;
    }
    const stats2 = st;
    const epsil = f(0.1);
    let mini = f(mean - f(varx * stddv));
    if (mini < mintr) mini = f(mintr + epsil);
    let maxi = f(mean + f(varx * stddv));
    if (maxi > maxtr) maxi = f(maxtr - epsil);
    let delta = f(maxi - mini);
    if (!delta) delta = 1;
    const aza = f(16300 / f(2 * stddv));
    const azb = f(-aza * f(mean - f(2 * stddv)));
    const bza = f(16300 / f(2 * stddv));
    const bzb = f(16300 - f(bza * mean));
    diag.stats.push({ stats1, stats2, mini, maxi });
    for (let i = 0; i < N; i++) luminance[i] = f(luminance[i] - mini);
    st = statsOf(luminance);
    mean = st.mean;
    stddv = st.std;
    mintr = st.min;
    maxtr = st.max;
    let asig = 0;
    let bsig = 0;
    let amax = 0;
    let bmax = 0;
    let amin = 0;
    let bmin = 0;
    const gain = gainLut && mean !== 0 && stddv !== 0;
    if (gain) {
      const asig0 = f(f(0.166666) / stddv);
      bsig = f(f(0.5 - f(asig0 * mean)) * 500);
      const amax0 = f(f(0.333333) / f(f(maxtr - mean) - stddv));
      bmax = f(f(1 - f(amax0 * maxtr)) * 500);
      const amin0 = f(f(0.333333) / f(f(mean - stddv) - mintr));
      bmin = f(f(-amin0 * mintr) * 500);
      asig = f(asig0 * 500);
      amax = f(amax0 * 500);
      amin = f(amin0 * 500);
    }
    const cdfactor = f(32768 / delta);
    for (let i = 0; i < N; i++) {
      const l = luminance[i];
      let gan: number;
      if (gain && gainLut) {
        let absciss: number;
        if (Math.abs(f(l - mean)) < stddv) absciss = f(f(asig * l) + bsig);
        else if (l >= mean) absciss = f(f(amax * l) + bmax);
        else absciss = f(f(amin * l) + bmin);
        gan = f(2 * lutAt(gainLut, absciss, true));
      } else gan = 0.5;
      const cd = f(f(f(gan * cdfactor) * l) + offse);
      let str = strengthx;
      if (shcurve && it === 1) {
        const HH = hue[i];
        const valparam = f((useHsl || useHslLin ? shcurve.getVal(HH) : shcurve.getVal(huelabToHsv(HH))) - 0.5);
        str = f(str * f(1 + f(2 * valparam)));
      }
      if (higplus) {
        if (ours) str = f(str * protection(original[i] / 327.68, p));
        else if (hue[i] > 65535 * hig) str = f(str * hig);
      }
      const orig = original[i];
      if (viewmet === 0) {
        const ceiling = ours ? Math.max(32768, orig) : 32768;
        luminance[i] = f(f(str * f(Math.min(Math.max(cd, 0), ceiling) - orig)) + orig);
      } else if (viewmet === 1) luminance[i] = tran[i];
      else if (viewmet === 4) luminance[i] = f(orig + f(str * f(orig - tran[i])));
      else if (viewmet === 2) luminance[i] = tran[i] <= mean ? f(azb + f(aza * tran[i])) : f(bzb + f(bza * tran[i]));
      else luminance[i] = f(1000 + f(tran[i] * 700));
    }
  }
  return { luminance, diag };
}


// ── the whole tool (rawimagesource.cc 1937-2586) ─────────────────────────────

export interface RetinexResult {
  rgb: Float32Array;
  luminance: Float32Array;
  original: Float32Array;
  diag: MsrDiagnostics;
  gamutRounds: Uint16Array;
}

/** `rgb` interleaved, three floats a pixel, RawTherapee's 0..65535 scale. */
export function retinex(rgbIn: Float32Array, W: number, H: number, p: RetinexParams, opt: Options): RetinexResult {
  const N = W * H;
  const rgb = Float32Array.from(rgbIn);
  const useHsl = p.retinexcolorspace !== "Lab";
  const gammaOn = p.gammaretinex !== "none" && p.str !== 0;
  const gin = gammaTable(p, false);
  if (gammaOn && gin) for (let i = 0; i < 3 * N; i++) rgb[i] = lutAt(gin.lut, rgb[i], gin.clip);

  const c0 = new Float32Array(N);
  const c1 = new Float32Array(N);
  const L = new Float32Array(N);
  const hue = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const r = rgb[3 * k];
    const g = rgb[3 * k + 1];
    const b = rgb[3 * k + 2];
    if (useHsl) {
      const [h, s, l] = rgb2hsl(r, g, b, opt.safelight);
      c0[k] = h;
      c1[k] = s;
      L[k] = f(l * 32768);
      hue[k] = h;
    } else {
      const [Ll, a, bb] = rgb2lab(r, g, b, opt.working);
      c0[k] = a;
      c1[k] = bb;
      L[k] = Ll;
      hue[k] = Math.atan2(bb, a);
    }
  }
  const cdLut = diagonalLut(useHsl ? p.cdHcurve : p.cdcurve);
  const work = new Float32Array(N);
  for (let k = 0; k < N; k++) work[k] = cdLut ? f(lutAt(cdLut, f(2 * L[k]), false) / 2) : L[k];

  const { luminance, diag } = msr({ W, H, luminance: work, original: L, hue }, p, opt);

  const chcurve = p.retinexMethod === "highli" ? hueCurve(p.lhcurve) : null;
  const out = new Float32Array(3 * N);
  const rounds = new Uint16Array(N);
  for (let k = 0; k < N; k++) {
    if (useHsl) {
      let s = c1[k];
      if (chcurve) s = f(s * f(1 + 2 * f(chcurve.getVal(c0[k]) - 0.5)));
      const [r, g, b] = hsl2rgb(c0[k], s, f(luminance[k] / 32768));
      out.set([r, g, b], 3 * k);
    } else {
      const aa = c0[k];
      const bb = c1[k];
      const chroma = f(Math.sqrt(f(f(aa * aa) + f(bb * bb))));
      let C = f(chroma / f(327.68));
      const HH = Math.atan2(bb, aa);
      const sy = chroma === 0 ? 1 : f(aa / chroma);
      const sx = chroma === 0 ? 0 : f(bb / chroma);
      if (chcurve) C = f(C * f(1 + 2 * f(chcurve.getVal(huelabToHsv(HH)) - 0.5)));
      const [Lg, Cg, n] = gamutLch(HH, sy, sx, f(luminance[k] / f(327.68)), C, opt.gamutInverse, opt.highlight);
      rounds[k] = Math.min(n, 65535);
      const [r, g, b] = lab2rgb(f(Lg * 327.68), f(f(327.68 * Cg) * sy), f(f(327.68 * Cg) * sx), opt.backInverse);
      out.set([r, g, b], 3 * k);
    }
  }
  const gout = gammaTable(p, true);
  if (gammaOn && gout) for (let i = 0; i < 3 * N; i++) out[i] = lutAt(gout.lut, out[i], gout.clip);
  return { rgb: out, luminance, original: L, diag, gamutRounds: rounds };
}
