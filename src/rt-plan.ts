// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// RawTherapee 5.13's Retinex parameters and the per-iteration plan MSR derives
// from them (rtengine/ipretinex.cc 103-141, 197-370), the iterated box sizes
// of gaussianBlur (rtengine/gauss.cc 1379-1418), Color::calcGamma
// (rtengine/color.cc 1578-1622) and the working-space matrices
// (rtengine/iccmatrices.h). Float arithmetic as RawTherapee does it; the
// compiled-source fixture (test/reference/vectors.json) pins it.
//
// ipretinex.cc: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>;
//   adaptation 2015 Jacques Desmis <jdesmis@gmail.com>, 2015 Ingo Weyrich
//   <heckflosse67@gmx.de>
// gauss.cc, color.cc, iccmatrices.h, procparams.cc: Copyright (c) 2004-2010
//   Gabor Horvath <hgabor@rawtherapee.com>

const f = Math.fround;

export type Mat3 = readonly (readonly number[])[];

export interface RetinexParams {
  cdcurve: readonly number[];
  cdHcurve: readonly number[];
  lhcurve: readonly number[];
  transmissionCurve: readonly number[];
  gaintransmissionCurve: readonly number[];
  mapcurve: readonly number[];
  str: number;
  scal: number;
  iter: number;
  grad: number;
  grads: number;
  gam: number;
  slope: number;
  neigh: number;
  offs: number;
  highlights: number;
  htonalwidth: number;
  shadows: number;
  stonalwidth: number;
  radius: number;
  retinexMethod: "low" | "uni" | "high" | "highli" | "highliplus";
  retinexcolorspace: "Lab" | "HSLLOG" | "HSLLIN";
  gammaretinex: "none" | "low" | "mid" | "hig" | "fre";
  mapMethod: "none" | "curv" | "gaus" | "map" | "mapT";
  viewMethod: "none" | "unsharp" | "mask" | "tran" | "tran2";
  vart: number;
  limd: number;
  highl: number;
  skal: number;
  medianmap: boolean;
  /** Safelight's Highlights+ (docs/SPEC.md §1.12), used only with `safelight`. */
  protectFrom: number;
  protectSoftness: number;
  protectAmount: number;
}

/** procparams.cc 674-748, plus Highlights+'s defaults. */
export const RT_DEFAULTS: RetinexParams = {
  cdcurve: [0],
  cdHcurve: [0],
  lhcurve: [0],
  transmissionCurve: [1, 0, 0.5, 0.35, 0.35, 0.6, 0.75, 0.35, 0.35, 1, 0.5, 0.35, 0.35],
  gaintransmissionCurve: [1, 0, 0.1, 0.35, 0, 0.25, 0.25, 0.35, 0.35, 0.7, 0.25, 0.35, 0.35, 1, 0.1, 0, 0],
  mapcurve: [0],
  str: 20,
  scal: 3,
  iter: 1,
  grad: 1,
  grads: 1,
  gam: 1.3,
  slope: 3,
  neigh: 80,
  offs: 0,
  highlights: 0,
  htonalwidth: 80,
  shadows: 0,
  stonalwidth: 80,
  radius: 40,
  retinexMethod: "high",
  retinexcolorspace: "Lab",
  gammaretinex: "none",
  mapMethod: "none",
  viewMethod: "none",
  vart: 200,
  limd: 8,
  highl: 4,
  skal: 3,
  medianmap: false,
  protectFrom: 70,
  protectSoftness: 20,
  protectAmount: 100,
};

/** iccmatrices.h:75-79, xyz_sRGB (D50, Bradford). */
export const XYZ_FROM_SRGB: Mat3 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
/** iccmatrices.h:199-209, xyz_rec2020 / rec2020_xyz (D50). */
export const XYZ_FROM_REC2020: Mat3 = [
  [0.6734241, 0.1656411, 0.1251286],
  [0.2790177, 0.6753402, 0.0456377],
  [-0.00193, 0.0299784, 0.797333],
];
export const REC2020_FROM_XYZ: Mat3 = [
  [1.6473376, -0.3935675, -0.2359961],
  [-0.6826036, 1.6475887, 0.012819],
  [0.0296524, -0.0628993, 1.2531279],
];

export function invert3(m: Mat3): number[][] {
  const [a, b, c] = m;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  return [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
}

/** Color::calcGamma (color.cc:1578-1622), dcraw's. */
export function calcGamma(pwr: number, ts: number): number[] {
  const g = [pwr, ts, 0, 0, 0, 0];
  const bnd = [0, 0];
  bnd[g[1] >= 1 ? 1 : 0] = 1;
  if (g[1] && (g[1] - 1) * (g[0] - 1) <= 0) {
    for (let i = 0; i < 99; i++) {
      g[2] = (bnd[0] + bnd[1]) / 2;
      if (g[0]) bnd[(Math.pow(g[2] / g[1], -g[0]) - 1) / g[0] - 1 / g[2] > -1 ? 1 : 0] = g[2];
      else bnd[g[2] / Math.exp(1 - 1 / g[2]) < g[1] ? 1 : 0] = g[2];
    }
    g[3] = g[2] / g[1];
    if (g[0]) g[4] = g[2] * (1 / g[0] - 1);
  }
  return g;
}

/** gaussianBlur's iterated-box radii for sigma on a W × H image. */
export function boxRadii(sigma: number, W: number, H: number): number[] {
  let n = 1;
  let wIdeal = Math.sqrt(12 * sigma * sigma + 1);
  while (wIdeal > W || wIdeal > H) {
    n++;
    wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  }
  if (n < 3) {
    n = 3;
    wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  } else if (n > 6) {
    n = 6;
  }
  let wl = Math.trunc(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}

export function retinexScales(nscales: number, mode: number, sIn: number, high: number): number[] {
  const s = Math.max(sIn, 3);
  const scales = new Array<number>(nscales).fill(0);
  if (nscales === 1) scales[0] = f(s / 2);
  else if (nscales === 2) {
    scales[1] = f(s / 2);
    scales[0] = s;
  } else {
    let step = f(s / nscales);
    if (mode === 0) {
      for (let i = 0; i < nscales; ++i) scales[nscales - i - 1] = f(2 + f(i * step));
    } else if (mode === 1) {
      step = f(Math.log(s - 2) / nscales);
      for (let i = 0; i < nscales; ++i) scales[nscales - i - 1] = f(2 + f(Math.pow(10, f(f(i * step) / Math.log(10)))));
    } else if (mode === 2) {
      step = f(Math.log(s - 2) / nscales);
      for (let i = 0; i < nscales; ++i) scales[i] = f(s - f(Math.pow(10, f(f(i * step) / Math.log(10)))));
    } else if (mode === 3) {
      step = f(Math.log(s - 2) / nscales);
      for (let i = 0; i < nscales; ++i) scales[i] = f(f(high * s) - f(Math.pow(10, f(f(i * step) / Math.log(10)))));
    }
  }
  return scales;
}

/** The constants MSR derives per iteration (ipretinex.cc 251-370). */
export interface IterationPlan {
  it: number;
  scal: number;
  scales: number[];
  pond: number;
  varx: number;
  limdx: number;
  ilimdx: number;
  strengthx: number;
}

export function methodMode(p: RetinexParams): number {
  if (p.retinexMethod === "uni") return 0;
  if (p.retinexMethod === "low") return 1;
  return 3;
}

/** `nei = 2.8f * deh.neigh`, truncated. */
export const neighbours = (neigh: number): number => Math.trunc(f(f(2.8) * neigh));

export function iterationPlans(p: RetinexParams): IterationPlan[] {
  const useHslLin = p.retinexcolorspace === "HSLLIN";
  const moderetinex = methodMode(p);
  const nei = neighbours(p.neigh);
  const vart = f(p.vart / 100);
  const strength = f(p.str / 100);
  let limD = f(Math.pow(p.limd, f(1.7)));
  if (useHslLin) limD = f(limD * 10);
  const ilimD = f(1 / limD);
  const aahi = f(49 / 99);
  const bbhi = f(1 - aahi);
  const high = f(bbhi + f(aahi * p.highl));
  const gradient = p.scal;
  let scal = p.skal;
  const plans: IterationPlan[] = [];
  for (let it = 1; it < p.iter + 1; it++) {
    let grad = 1;
    let sc = scal;
    if (gradient === 0) {
      grad = 1;
      sc = 3;
    } else if (gradient === 1) {
      grad = f(f(0.25 * it) + 0.75);
      sc = f(f(-0.5 * it) + 4.5);
    } else if (gradient === 2) {
      grad = f(f(0.5 * it) + 0.5);
      sc = f(f(-0.75 * it) + 5.75);
    } else if (gradient === 3) {
      grad = f(f(f(0.666) * it) + f(0.333));
      sc = f(f(-0.75 * it) + 5.75);
    } else if (gradient === 4) {
      grad = f(f(f(0.8) * it) + f(0.2));
      sc = f(f(-0.75 * it) + 5.75);
    } else if (gradient === 5) {
      if (moderetinex !== 3) grad = f(f(2.5 * it) - 1.5);
      else {
        const aa = f(f(f(11 * high) - 1) / 4);
        grad = f(f(aa * it) + f(1 - aa));
      }
      sc = f(f(-0.75 * it) + 5.75);
    } else if (gradient === 6) {
      if (moderetinex !== 3) grad = f(f(5 * it) - 4);
      else {
        const aa = f(f(f(21 * high) - 1) / 4);
        grad = f(f(aa * it) + f(1 - aa));
      }
      sc = f(f(-0.75 * it) + 5.75);
    } else if (gradient === -1) {
      grad = f(f(-0.125 * it) + 1.125);
      sc = 3;
    }
    if (p.iter === 1) sc = scal;
    else if (scal < 3) {
      sc -= 1;
      if (sc < 1) sc = 1;
    } else if (scal > 4) sc += 1;
    let varx = vart;
    let limdx = limD;
    let ilimdx = ilimD;
    const g = p.grad;
    const k =
      g === 1 ? f(f(-0.125 * it) + 1.125) : g === 2 ? f(f(-0.2 * it) + f(1.2)) : g === -1 ? f(f(0.125 * it) + 0.875) : g === -2 ? f(f(0.4 * it) + f(0.6)) : 0;
    if (g !== 0 && k !== 0) {
      varx = f(vart * k);
      limdx = f(limD * k);
      ilimdx = f(1 / limdx);
    }
    scal = Math.round(sc);
    let ks = 1;
    const gs = p.grads;
    if (gs === 1) ks = it <= 3 ? f(f(f(-0.3) * it) + f(1.6)) : 0.5;
    else if (gs === 2) ks = it <= 3 ? f(f(f(-0.6) * it) + f(2.2)) : f(0.3);
    else if (gs === -1) ks = it <= 3 ? f(f(f(0.2) * it) + f(0.6)) : f(1.2);
    else if (gs === -2) ks = it <= 3 ? f(f(f(0.4) * it) + f(0.2)) : 1.5;
    const strengthx = f(ks * strength);
    const scales = retinexScales(scal, moderetinex, Math.trunc(f(nei / grad)), high);
    let pond = f(f(Math.log(16384)) / scal);
    if (!useHslLin) pond = f(pond / Math.log(f(2.71828)));
    plans.push({ it, scal, scales, pond, varx, limdx, ilimdx, strengthx });
  }
  return plans;
}

/** Safelight's Highlights+ strength factor (docs/SPEC.md §1.12). */
export function protection(L0: number, p: RetinexParams): number {
  const t = Math.min(Math.max((L0 - p.protectFrom) / p.protectSoftness, 0), 1);
  return 1 - (p.protectAmount / 100) * t * t * (3 - 2 * t);
}
