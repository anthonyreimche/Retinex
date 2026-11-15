// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// RawTherapee's two curve kinds, as its Retinex tool builds them:
// DiagonalCurve (rtengine/diagonalcurves.cc) and FlatCurve
// (rtengine/flatcurves.cc), with Curve::AddPolygons/fillDyByDx (curves.cc
// 108-142), CurveFactory's parametric bases (curves.h 145-157, 465-471) and the
// lookup tables Retinex samples them into (curves.cc 41-65, 368-393,
// 2546-2601).
//
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
//
// A curve is kept as RawTherapee keeps it in a profile: a number list whose
// first entry is the curve's type.

export const DCT = { linear: 0, spline: 1, parametric: 2, nurbs: 3, catmullRom: 4 } as const;
export const FCT = { linear: 0, controlPoints: 1 } as const;

/** CURVES_MIN_POLY_POINTS (curves.h:31). */
export const MIN_POLY_POINTS = 1000;

const LIM01 = (v: number): number => Math.min(Math.max(v, 0), 1);

const baselAlt = (x: number): number => (2 - x) * x * x * x;
const baseuAlt = (x: number): number => x * (2 + (x - 2) * x * x);
function pfullAlt(x: number, sh: number, hl: number): number {
  const t = (1 - sh) * (1 - hl) * baselAlt(x) + sh * hl * baseuAlt(x);
  return x <= 0.5
    ? t + (1 - sh) * hl * baselAlt(2 * x) * 0.5 + sh * (1 - hl) * baseuAlt(2 * x) * 0.5
    : t + (1 - sh) * hl * (0.5 + baseuAlt(2 * x - 1) * 0.5) + sh * (1 - hl) * (0.5 + baselAlt(2 * x - 1) * 0.5);
}

/** A polyline of quadratic Bézier pieces, as Curve::AddPolygons lays it. */
class Polyline {
  readonly x: number[] = [];
  readonly y: number[] = [];
  slope: number[] = [];

  addBezier(nbr: number, first: boolean, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    if (first) {
      this.x.push(x1);
      this.y.push(y1);
    }
    const increment = 1 / (nbr - 1);
    for (let k = 1; k < nbr - 1; k++) {
      const t = k * increment;
      const t2 = t * t;
      const tr = 1 - t;
      const tr2 = tr * tr;
      const tr2t = tr * 2 * t;
      this.x.push(tr2 * x1 + tr2t * x2 + t2 * x3);
      this.y.push(tr2 * y1 + tr2t * y2 + t2 * y3);
    }
    this.x.push(x3);
    this.y.push(y3);
  }

  finish(): void {
    this.slope = [];
    for (let i = 0; i < this.x.length - 1; i++) this.slope.push((this.y[i + 1] - this.y[i]) / (this.x[i + 1] - this.x[i]));
  }

  /** The segment whose start is the last at or below t (binary search). */
  segment(t: number): number {
    let lo = 0;
    let hi = this.x.length - 1;
    while (hi > 1 + lo) {
      const k = (hi + lo) >>> 1;
      if (this.x[k] > t) hi = k;
      else lo = k;
    }
    return lo;
  }

  value(t: number): number {
    const k = this.segment(t);
    return this.y[k] + (t - this.x[k]) * this.slope[k];
  }
}

/** rtengine::DiagonalCurve. */
export class DiagonalCurve {
  readonly kind: number;
  private readonly cx: number[] = [];
  private readonly cy: number[] = [];
  private ypp: number[] = [];
  private poly = new Polyline();
  private catmull: { x: number[]; y: number[] } = { x: [], y: [] };
  private px: number[] = [];
  private mc = 0;
  private mfc = 0;
  private msc = 0;
  private mhc = 0;

  constructor(p: readonly number[], ppn = MIN_POLY_POINTS) {
    const poly = Math.min(ppn, 65500);
    let kind = p.length < 3 ? -1 : p[0];
    let identity = true;
    if (kind === DCT.linear || kind === DCT.spline || kind === DCT.nurbs || kind === DCT.catmullRom) {
      const n = Math.floor((p.length - 1) / 2);
      for (let i = 0; i < n; i++) {
        this.cx.push(p[1 + 2 * i]);
        this.cy.push(p[2 + 2 * i]);
        if (Math.abs(this.cx[i] - this.cy[i]) >= 0.000009) identity = false;
      }
      if (this.cx[0] !== 0 || this.cx[n - 1] !== 1) identity = false;
      if (this.cx[0] === 0 && this.cx[1] === 0) this.cx[1] = 0.01;
      if (this.cx[0] === 1 && this.cx[1] === 1) this.cx[0] = 0.99;
      if (!identity) {
        if (kind === DCT.spline && n > 2) this.splineSet();
        else if (kind === DCT.nurbs && n > 2) this.nurbsSet(poly);
        else if (kind === DCT.catmullRom && n > 2) this.catmullRomSet(poly);
        else kind = DCT.linear;
      }
    } else if (kind === DCT.parametric) {
      if ((p.length === 8 || p.length === 9) && (p[4] !== 0 || p[5] !== 0 || p[6] !== 0 || p[7] !== 0)) {
        identity = false;
        const x = [p[0]];
        for (let i = 1; i < 4; i++) x[i] = Math.min(Math.max(p[i], 0.001), 0.99);
        for (let i = 4; i < 8; i++) x[i] = (p[i] + 100) / 200;
        x[8] = p.length < 9 ? 1 : p[8] / 100;
        this.px = x;
        this.mc = -Math.log(2) / Math.log(x[2]);
        const mbase = pfullAlt(0.5, x[6], x[5]);
        this.mfc = Math.exp(Math.log(mbase) / this.mc);
        this.msc = -Math.log(2) / Math.log(x[1] / x[2]);
        this.mhc = -Math.log(2) / Math.log((x[3] - x[2]) / (1 - x[2]));
      }
    }
    this.kind = identity ? -1 : kind;
  }

  isIdentity(): boolean {
    return this.kind === -1;
  }

  private splineSet(): void {
    const x = this.cx;
    const y = this.cy;
    const n = x.length;
    const u = new Array<number>(n - 1).fill(0);
    const ypp = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; ++i) {
      const sig = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]);
      const p = sig * ypp[i - 1] + 2;
      ypp[i] = (sig - 1) / p;
      u[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
      u[i] = ((6 * u[i]) / (x[i + 1] - x[i - 1]) - sig * u[i - 1]) / p;
    }
    ypp[n - 1] = 0;
    for (let k = n - 2; k >= 0; --k) ypp[k] = ypp[k] * ypp[k + 1] + u[k];
    this.ypp = ypp;
  }

  private nurbsSet(ppn: number): void {
    const x = this.cx;
    const y = this.cy;
    const n = x.length;
    const scx: number[] = [];
    const scy: number[] = [];
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < n - 1; ) {
      if (!i) {
        scx.push(x[i]);
        scy.push(y[i++]);
      } else {
        scx.push((x[i - 1] + x[i]) / 2);
        scy.push((y[i - 1] + y[i]) / 2);
      }
      scx.push(x[i]);
      scy.push(y[i++]);
      let j = scx.length - 1;
      let length = Math.hypot(scx[j] - scx[j - 1], scy[j] - scy[j - 1]);
      if (i === n - 1) {
        scx.push(x[i]);
        scy.push(y[i]);
      } else {
        scx.push((x[i - 1] + x[i]) / 2);
        scy.push((y[i - 1] + y[i]) / 2);
      }
      j = scx.length - 1;
      length += Math.hypot(scx[j] - scx[j - 1], scy[j] - scy[j - 1]);
      lengths.push(length);
      total += length;
    }
    const poly = new Polyline();
    if (x[0] > 0) {
      poly.x.push(0);
      poly.y.push(y[0]);
    }
    const size = scx.length - 1;
    for (let i = 0; i < size; i += 3) {
      const nbr = Math.trunc(((ppn + n - 2) * lengths[i / 3]) / total);
      poly.addBezier(nbr, !i, scx[i], scy[i], scx[i + 1], scy[i + 1], scx[i + 2], scy[i + 2]);
    }
    poly.x.push(3);
    poly.y.push(y[n - 1]);
    poly.finish();
    this.poly = poly;
  }

  private catmullRomSet(ppn: number): void {
    const x = this.cx;
    const y = this.cy;
    const nPoints = Math.max(ppn * 65, 65000);
    const ncp = x.length;
    const reflect = (px: number, py: number, cx: number, cy: number): [number, number] => {
      const dx = px - cx;
      const dy = py - cy;
      const rx = cx - dx * 0.01;
      return [rx, dx > 1e-5 ? (dy / dx) * (rx - cx) + cy : cy];
    };
    const [xf, yf] = reflect(x[1], y[1], x[0], y[0]);
    const [xl, yl] = reflect(x[ncp - 2], y[ncp - 2], x[ncp - 1], y[ncp - 1]);
    const rx: number[] = [];
    const ry: number[] = [];
    const tj = (ti: number, xi: number, yi: number, xj: number, yj: number): number =>
      Math.pow(Math.sqrt((xj - xi) ** 2 + (yj - yi) ** 2), 0.375) + ti;
    const segments = ncp - 1;
    for (let i = 0; i < segments; ++i) {
      const np = Math.max(Math.trunc(nPoints * (x[i + 1] - x[i]) + 0.5), 2);
      const p0x = i === 0 ? xf : x[i - 1];
      const p0y = i === 0 ? yf : y[i - 1];
      const p1x = x[i];
      const p1y = y[i];
      const p2x = x[i + 1];
      const p2y = y[i + 1];
      const p3x = i === segments - 1 ? xl : x[i + 2];
      const p3y = i === segments - 1 ? yl : y[i + 2];
      const t0 = 0;
      const t1 = tj(t0, p0x, p0y, p1x, p1y);
      const t2 = tj(t1, p1x, p1y, p2x, p2y);
      const t3 = tj(t2, p2x, p2y, p3x, p3y);
      const space = (t2 - t1) / np;
      rx.push(p1x);
      ry.push(p1y);
      if (p1y === p2y && (p1y === 0 || p1y === 1)) {
        for (let k = 1; k < np - 1; ++k) {
          const t = p1x + space * k;
          if (t >= p2x) break;
          rx.push(t);
          ry.push(p1y);
        }
      } else {
        for (let k = 1; k < np - 1; ++k) {
          const t = t1 + space * k;
          let c = (t1 - t) / (t1 - t0);
          let d = (t - t0) / (t1 - t0);
          const a1x = c * p0x + d * p1x;
          const a1y = c * p0y + d * p1y;
          c = (t2 - t) / (t2 - t1);
          d = (t - t1) / (t2 - t1);
          const a2x = c * p1x + d * p2x;
          const a2y = c * p1y + d * p2y;
          c = (t3 - t) / (t3 - t2);
          d = (t - t2) / (t3 - t2);
          const a3x = c * p2x + d * p3x;
          const a3y = c * p2y + d * p3y;
          c = (t2 - t) / (t2 - t0);
          d = (t - t0) / (t2 - t0);
          const b1x = c * a1x + d * a2x;
          const b1y = c * a1y + d * a2y;
          c = (t3 - t) / (t3 - t1);
          d = (t - t1) / (t3 - t1);
          const b2x = c * a2x + d * a3x;
          const b2y = c * a2y + d * a3y;
          c = (t2 - t) / (t2 - t1);
          d = (t - t1) / (t2 - t1);
          rx.push(c * b1x + d * b2x);
          ry.push(c * b1y + d * b2y);
        }
      }
      rx.push(p2x);
      ry.push(p2y);
    }
    this.catmull = { x: rx, y: ry };
  }

  getVal(t: number): number {
    switch (this.kind) {
      case DCT.parametric: {
        const x = this.px;
        if (t <= 1e-14) return 0;
        const tv = Math.exp(Math.max(this.mc * Math.log(t), -236));
        const base = pfullAlt(tv, x[6], x[5]);
        const stretched = Math.exp(Math.log(base) / this.mc);
        if (t < x[2]) {
          const stv = Math.exp(Math.max(this.msc * Math.log(stretched / this.mfc), -236));
          const sbase = pfullAlt(stv, x[7], 0.5);
          return this.mfc * Math.exp(Math.log(sbase) / this.msc);
        }
        const htv = Math.exp(Math.max(this.mhc * Math.log((stretched - this.mfc) / (1 - this.mfc)), -236));
        if (htv < 1e-6) return stretched;
        const hbase = pfullAlt(htv, 0.5, x[4]);
        return this.mfc + (1 - this.mfc) * Math.exp(Math.log(hbase) / this.mhc);
      }
      case DCT.linear:
      case DCT.spline: {
        const x = this.cx;
        const y = this.cy;
        const n = x.length;
        if (t > x[n - 1]) return y[n - 1];
        if (t < x[0]) return y[0];
        let lo = 0;
        let hi = n - 1;
        while (hi > 1 + lo) {
          const k = (hi + lo) >>> 1;
          if (x[k] > t) hi = k;
          else lo = k;
        }
        const h = x[hi] - x[lo];
        if (this.kind === DCT.linear) return y[lo] + ((t - x[lo]) * (y[hi] - y[lo])) / h;
        const a = (x[hi] - t) / h;
        const b = (t - x[lo]) / h;
        const r = a * y[lo] + b * y[hi] + ((a * a * a - a) * this.ypp[lo] + (b * b * b - b) * this.ypp[hi]) * (h * h) * 0.1666666666666666666666666666666;
        return LIM01(r);
      }
      case DCT.catmullRom: {
        const { x, y } = this.catmull;
        let lo = 0;
        let hi = x.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (x[mid] < t) lo = mid + 1;
          else hi = mid;
        }
        if (lo === x.length) return y[y.length - 1];
        let d = lo;
        if (d + 1 < x.length && t - x[d] > x[d + 1] - t) ++d;
        return LIM01(y[d]);
      }
      case DCT.nurbs:
        return this.poly.value(t);
      default:
        return t;
    }
  }
}

/** rtengine::FlatCurve. */
export class FlatCurve {
  readonly periodic: boolean;
  private kind: number;
  private identityValue = 0.5;
  private readonly cx: number[] = [];
  private readonly cy: number[] = [];
  private readonly lt: number[] = [];
  private readonly rt: number[] = [];
  private readonly n: number = 0;
  private readonly ppn: number;
  private poly = new Polyline();

  constructor(p: readonly number[], periodic = true, ppn = MIN_POLY_POINTS) {
    this.periodic = periodic;
    this.ppn = Math.min(ppn, 65500);
    this.kind = -1;
    if (p.length > 4) {
      let identity = true;
      const kind = p[0];
      this.kind = kind;
      if (kind === FCT.controlPoints) {
        const n = Math.floor((p.length - 1) / 4);
        this.n = n;
        for (let i = 0; i < n; i++) {
          this.cx.push(p[1 + 4 * i]);
          this.cy.push(p[2 + 4 * i]);
          this.lt.push(p[3 + 4 * i]);
          this.rt.push(p[4 + 4 * i]);
          if (this.cy[i] >= this.identityValue + 1e-7 || this.cy[i] <= this.identityValue - 1e-7) identity = false;
        }
        if (periodic) {
          this.cx.push(p[1] + 1);
          this.cy.push(p[2]);
          this.lt.push(p[3]);
          this.rt.push(p[4]);
        }
        if (!identity && n > (periodic ? 1 : 0)) this.ctrlPointsSet();
      }
      if (identity) this.kind = -1;
    }
  }

  /** FlatCurve::setIdentityValue; true when the curve is the identity. */
  setIdentityValue(v: number): boolean {
    if (this.identityValue === v) return this.kind === -1;
    this.identityValue = v;
    let identity = true;
    for (let i = 0; i < this.n + (this.periodic ? 1 : 0); i++) {
      if (this.cy[i] >= v + 1e-7 || this.cy[i] <= v - 1e-7) {
        identity = false;
        break;
      }
    }
    if (!identity && this.n > (this.periodic ? 1 : 0)) {
      this.ctrlPointsSet();
      this.kind = FCT.controlPoints;
    } else {
      this.poly = new Polyline();
      this.kind = -1;
    }
    return this.kind === -1;
  }

  isIdentity(): boolean {
    return this.kind === -1;
  }

  private ctrlPointsSet(): void {
    const x = this.cx;
    const y = this.cy;
    const lt = this.lt;
    const rt = this.rt;
    const n = this.periodic ? this.n : this.n - 1;
    const scx: number[] = [];
    const scy: number[] = [];
    const lengths: number[] = [];
    const linear: boolean[] = [];
    let total = 0;
    const push = (px: number, py: number): void => {
      scx.push(px);
      scy.push(py);
    };
    const seg = (): number => {
      const j = scx.length - 1;
      return Math.hypot(scx[j] - scx[j - 1], scy[j] - scy[j - 1]);
    };
    for (let i = 0; i < n; ) {
      const startLinear = rt[i] === 0 || y[i] === y[i + 1];
      const endLinear = lt[i + 1] === 0 || y[i] === y[i + 1];
      if (startLinear && endLinear) {
        push(x[i], y[i]);
        push(x[i + 1], y[i + 1]);
        linear.push(true);
        i++;
        const length = seg();
        lengths.push(length);
        total += length;
      } else {
        let xp1 = startLinear ? x[i] : (x[i + 1] - x[i]) * rt[i] + x[i];
        let xp3 = endLinear ? x[i + 1] : (x[i] - x[i + 1]) * lt[i + 1] + x[i + 1];
        const xp2 = (xp1 + xp3) / 2;
        const yp2 = (y[i] + y[i + 1]) / 2;
        if (rt[i] + lt[i + 1] > 1) xp1 = xp3 = xp2;
        if (startLinear) {
          push(x[i], y[i]);
          push(xp2, yp2);
          linear.push(true);
          const length = seg();
          lengths.push(length);
          total += length;
        } else {
          push(x[i], y[i]);
          push(xp1, y[i]);
          let length = seg();
          push(xp2, yp2);
          length += seg();
          linear.push(false);
          lengths.push(length);
          total += length;
        }
        if (endLinear) {
          push(xp2, yp2);
          push(x[i + 1], y[i + 1]);
          linear.push(true);
          const length = seg();
          lengths.push(length);
          total += length;
        } else {
          push(xp2, yp2);
          push(xp3, y[i + 1]);
          let length = seg();
          push(x[i + 1], y[i + 1]);
          length += seg();
          linear.push(false);
          lengths.push(length);
          total += length;
        }
        i++;
      }
    }
    const poly = new Polyline();
    let j = 0;
    if (!this.periodic && scx[0] !== 0) {
      poly.x.push(0);
      poly.y.push(scy[0]);
    }
    poly.x.push(scx[0]);
    poly.y.push(scy[0]);
    for (let i = 0; i < linear.length; i++) {
      if (linear[i]) {
        j++;
        poly.x.push(scx[j]);
        poly.y.push(scy[j++]);
      } else {
        const nbr = Math.trunc((this.ppn * lengths[i]) / total);
        const x1 = scx[j];
        const y1 = scy[j++];
        const x2 = scx[j];
        const y2 = scy[j++];
        const x3 = scx[j];
        const y3 = scy[j++];
        poly.addBezier(nbr, false, x1, y1, x2, y2, x3, y3);
      }
    }
    poly.x.push(3);
    poly.y.push(scy[j - 1]);
    poly.finish();
    this.poly = poly;
  }

  getVal(t: number): number {
    if (this.kind !== FCT.controlPoints) return this.identityValue;
    let v = t;
    if (v < this.poly.x[0]) v += 1;
    return this.poly.value(v);
  }
}

/** CurveFactory::diagonalCurve2Lut with skip 1: 65536 entries of 65535·curve,
 *  or null when the curve is the identity (Retinex then skips it). */
export function diagonalLut(points: readonly number[]): Float32Array | null {
  if (points.length === 0 || points[0] === 0) return null;
  const curve = new DiagonalCurve(points, MIN_POLY_POINTS);
  if (curve.isIdentity()) return null;
  const lut = new Float32Array(65536);
  for (let i = 0; i <= 0xffff; i++) lut[i] = Math.fround(Math.fround(curve.getVal(Math.fround(i / 65535))) * 65535);
  return lut;
}

/** RetinextransmissionCurve / RetinexgaintransmissionCurve::Set: 501 entries
 *  of the curve at i/500, or null when it is off (linear type or all at 0). */
export function transmissionLut(points: readonly number[]): Float32Array | null {
  if (points.length === 0 || !(points[0] > FCT.linear && points[0] < 2)) return null;
  const curve = new FlatCurve(points, false, MIN_POLY_POINTS / 2);
  if (curve.setIdentityValue(0)) return null;
  const lut = new Float32Array(501);
  for (let i = 0; i < 501; i++) lut[i] = curve.getVal(i / 500);
  return lut;
}

/** The Strength=f(H) curve as MSR and the chroma step build it
 *  (`new FlatCurve(deh.lhcurve)`: periodic, identity 0.5), or null. */
export function hueCurve(points: readonly number[]): FlatCurve | null {
  const curve = new FlatCurve(points);
  return curve.isIdentity() ? null : curve;
}

/** LUT<float>::operator[](float) (LUT.h 460-482). `clip` is the LUT's
 *  LUT_CLIP_BELOW | LUT_CLIP_ABOVE (the default); 0 extrapolates. */
export function lutAt(lut: ArrayLike<number>, index: number, clip: boolean): number {
  const size = lut.length;
  const maxs = size - 2;
  let idx = Math.trunc(index);
  if (index < 0) {
    if (clip) return lut[0];
    idx = 0;
  } else if (index > maxs) {
    if (clip) return lut[size - 1];
    idx = maxs;
  }
  const diff = Math.fround(index - idx);
  const p1 = lut[idx];
  const p2 = Math.fround(lut[idx + 1] - p1);
  return Math.fround(p1 + Math.fround(p2 * diff));
}
