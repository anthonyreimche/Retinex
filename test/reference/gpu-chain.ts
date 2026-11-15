// A CPU model of the passes' blur chain (src/glsl.ts CHAIN, docs/SPEC.md §4.3)
// in float64, without the half-float storage: the levels (schedule.ts
// levelAt), the count-weighted reductions, the fractional boxes with their
// count-weighted truncation at the frame, and the read back (schedule.ts
// readbackCell). rtref's `chain` option takes it in place of RawTherapee's
// exact iterated boxes, to measure what the chain's approximations cost.

import { fractionalBox, incrementAt, levelAt, radiiAt, readbackCell, type Frame, type IterationShape } from "../../src/schedule";
import { gaussianBox, toHalf } from "./rtref";

export interface ChainModel {
  /** The exact blur of every scale, only reduced to its level and read back
   *  (the read back's share alone), in place of the decimated chain. */
  readbackOnly?: boolean;
  /** Round every stored tile and plane to half floats (L* units), as the
   *  passes' RGBA16F targets keep them. */
  half?: boolean;
}

interface Tile {
  level: number;
  cw: number;
  ch: number;
  v: Float64Array;
}

const cellCount = (n: number, level: number, c: number): number => Math.min(2 ** level, n - c * 2 ** level);

/** Count-weighted block means of `t` at `level`. */
function reduce(t: Tile, level: number, W: number, H: number): Tile {
  const cw = Math.ceil(W / 2 ** level);
  const ch = Math.ceil(H / 2 ** level);
  const q = 2 ** (level - t.level);
  const v = new Float64Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let acc = 0;
      let total = 0;
      for (let dy = 0; dy < q; dy++)
        for (let dx = 0; dx < q; dx++) {
          const x = cx * q + dx;
          const y = cy * q + dy;
          if (x >= t.cw || y >= t.ch) continue;
          const w = cellCount(W, t.level, x) * cellCount(H, t.level, y);
          acc += w * t.v[y * t.cw + x];
          total += w;
        }
      v[cy * cw + cx] = acc / total;
    }
  return { level, cw, ch, v };
}

/** The exact truncated box along an axis at full resolution (rtBoxFull). */
function boxFull(t: Tile, axis: number, r: number): Tile {
  const v = new Float64Array(t.v.length);
  for (let y = 0; y < t.ch; y++)
    for (let x = 0; x < t.cw; x++) {
      const at = axis === 0 ? x : y;
      const n = axis === 0 ? t.cw : t.ch;
      let acc = 0;
      for (let q = Math.max(0, at - r); q <= Math.min(n - 1, at + r); q++) acc += axis === 0 ? t.v[y * t.cw + q] : t.v[q * t.cw + x];
      v[y * t.cw + x] = acc / (Math.min(n - 1, at + r) - Math.max(0, at - r) + 1);
    }
  return { ...t, v };
}

/** The coarse fractional box along an axis (rtBoxCoarse). */
function boxCoarse(t: Tile, axis: number, r: number, prefilter: number, W: number, H: number): Tile {
  const f = 2 ** t.level;
  const { m, t: end } = fractionalBox((r * (r + 1)) / 3 / (f * f) - prefilter);
  const v = new Float64Array(t.v.length);
  for (let cy = 0; cy < t.ch; cy++)
    for (let cx = 0; cx < t.cw; cx++) {
      const at = axis === 0 ? cx : cy;
      const n = axis === 0 ? t.cw : t.ch;
      let acc = 0;
      let total = 0;
      for (let d = -m - 1; d <= m + 1; d++) {
        const c = at + d;
        if (c < 0 || c >= n) continue;
        const w = (Math.abs(d) === m + 1 ? end : 1) * cellCount(axis === 0 ? W : H, t.level, c);
        acc += w * (axis === 0 ? t.v[cy * t.cw + c] : t.v[c * t.cw + cx]);
        total += w;
      }
      v[cy * t.cw + cx] = acc / total;
    }
  return { ...t, v };
}

/** The tile at full resolution, as rtBlurAt reads it back. */
function readback(t: Tile, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  if (t.level === 0) {
    for (let i = 0; i < W * H; i++) out[i] = t.v[i];
    return out;
  }
  const at = (cx: number, cy: number): number => t.v[cy * t.cw + cx];
  for (let y = 0; y < H; y++) {
    const [y0, ty] = readbackCell(y, H, t.level);
    const y1 = Math.min(y0 + 1, t.ch - 1);
    for (let x = 0; x < W; x++) {
      const [x0, tx] = readbackCell(x, W, t.level);
      const x1 = Math.min(x0 + 1, t.cw - 1);
      const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
      const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
      out[y * W + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** Every scale's blur of `src`, by RawTherapee's scale index, as the passes
 *  make it at a W × H pass of a W × H source. */
export function chainModel(model: ChainModel = {}) {
  return (src: Float32Array, W: number, H: number, scales: readonly number[]): Float32Array[] => {
    const shape: IterationShape = { n: scales.length, sigma: scales, maskAt: () => false, hasTransmission: true, median: false };
    const frame: Frame = { W, H, k: 1 };
    const outs: Float32Array[] = new Array(scales.length);
    let t: Tile = { level: 0, cw: W, ch: H, v: Float64Array.from(src) };
    let exact = src;
    for (let j = 0; j < shape.n; j++) {
      const s = shape.n - 1 - j;
      const level = levelAt(shape, j, frame);
      if (model.readbackOnly) {
        exact = gaussianBox(exact, W, H, incrementAt(shape, j, frame));
        outs[s] = level === 0 ? exact : readback(reduce({ level: 0, cw: W, ch: H, v: Float64Array.from(exact) }, level, W, H), W, H);
        continue;
      }
      const store = (tile: Tile): Tile => (model.half ? { ...tile, v: tile.v.map((x) => toHalf(x / 327.68) * 327.68) } : tile);
      if (j === 0) t = store(t);
      const from = t.level;
      while (t.level < level) t = store(reduce(t, Math.min(level, t.level + 2), W, H));
      radiiAt(shape, j, frame).forEach((r, box) => {
        const prefilter = box === 0 && level > from ? (1 - 4 ** (from - level)) / 12 : 0;
        for (const axis of [0, 1]) t = store(level === 0 ? boxFull(t, axis, r) : boxCoarse(t, axis, r, prefilter, W, H));
      });
      outs[s] = readback(t, W, H);
    }
    return outs;
  };
}
