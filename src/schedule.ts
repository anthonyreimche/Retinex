// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The passes' fixed-slot schedule and atlas, the arithmetic glsl.ts decodes
// on the GPU from uPassIndex, the pass size and the uniforms. Slots depend on
// the params alone (the panel writes the draw counts); whether a slot has work
// at this pass size, and where it reads and writes, depend on the size too.
// docs/SPEC.md §4 sets it out.

import { boxRadii } from "./rt-plan";

export const MAX_SCALES = 8;
export const MAX_BOXES = 6;
export const MAX_LEVEL = 6;
export const RED_SLOTS = 3;
export const BOX_SLOTS = 2 * MAX_BOXES;
export const STAT_SLOTS = 8;
export const MASK_SLOTS = 2 + STAT_SLOTS;
/** The largest box radius run at full resolution (rtBoxFull reads 2r + 1). */
export const FULL_RADIUS = 17;
/** The most cells a coarse box reads (rtBoxCoarse: 2m + 3, m ≤ 32). */
export const COARSE_READS = 67;
/** A coarse box keeps m ≤ 32 while r(r + 1) < COARSE_LIMIT · 4^level:
 *  fractionalBox's m ≤ 32 holds while the variance r(r + 1)/3/4^level is
 *  under (67² − 1)/12 = 374 cells². */
export const COARSE_LIMIT = 3 * ((COARSE_READS * COARSE_READS - 1) / 12);
/** A texels per statistics bank, from texel 0: each of its 8 statistics as a
 *  high and a low half, then the iteration that wrote it. */
export const BANK_TEXELS = 17;
/** The A texel that flags a schedule the draw counts don't fit. */
export const FLAG_TEXEL = 2 * BANK_TEXELS;
/** The first A texel that holds the log map's low half. */
export const LO_START = FLAG_TEXEL + 1;
/** The mask's statistics (max, min, mean), G texels from 0. */
export const MASK_STATS = 3;

export type StepKind =
  | "idle"
  | "start"
  | "reduce"
  | "box"
  | "shmap1"
  | "shmap2"
  | "maskStats"
  | "accumulate"
  | "stats1"
  | "transmission"
  | "median"
  | "stats2"
  | "final";

/** What the schedule needs of one iteration's plan. */
export interface IterationShape {
  /** Scale count. */
  n: number;
  /** σ by RawTherapee's index (0 the largest), source pixels. */
  sigma: readonly number[];
  /** The shadows/highlights mask runs at RawTherapee's scale index s. */
  maskAt: (s: number) => boolean;
  hasTransmission: boolean;
  median: boolean;
}

export interface Step {
  kind: StepKind;
  it: number;
  /** Chain position (0 = the smallest σ, RawTherapee's index n − 1). */
  j: number;
  /** The slot within its group (reduction, box, statistics level). */
  sub: number;
}

/** Slots of one scale. */
export const scaleSlots = (shape: IterationShape, j: number): number =>
  RED_SLOTS + BOX_SLOTS + (shape.maskAt(shape.n - 1 - j) ? MASK_SLOTS : 0) + 1;

/** Slots of one iteration. */
export function iterationSlots(shape: IterationShape): number {
  let slots = 1 + STAT_SLOTS;
  for (let j = 0; j < shape.n; j++) slots += scaleSlots(shape, j);
  if (shape.hasTransmission) slots += 1 + (shape.median ? 1 : 0) + STAT_SLOTS;
  return slots;
}

/** The step of slot `slot` among `shapes` (the iterations a pass runs, first `firstIt`). */
export function stepAt(shapes: readonly IterationShape[], firstIt: number, slot: number): Step {
  let o = slot;
  for (let k = 0; k < shapes.length; k++) {
    const shape = shapes[k];
    const it = firstIt + k;
    const count = iterationSlots(shape);
    if (o >= count) {
      o -= count;
      continue;
    }
    if (o === 0) return { kind: "start", it, j: 0, sub: 0 };
    o -= 1;
    for (let j = 0; j < shape.n; j++) {
      const size = scaleSlots(shape, j);
      if (o < size) {
        if (o < RED_SLOTS) return { kind: "reduce", it, j, sub: o };
        o -= RED_SLOTS;
        if (o < BOX_SLOTS) return { kind: "box", it, j, sub: o };
        o -= BOX_SLOTS;
        if (shape.maskAt(shape.n - 1 - j)) {
          if (o === 0) return { kind: "shmap1", it, j, sub: 0 };
          if (o === 1) return { kind: "shmap2", it, j, sub: 0 };
          if (o < MASK_SLOTS) return { kind: "maskStats", it, j, sub: o - 2 };
          o -= MASK_SLOTS;
        }
        return { kind: "accumulate", it, j, sub: 0 };
      }
      o -= size;
    }
    if (o < STAT_SLOTS) return { kind: "stats1", it, j: 0, sub: o };
    o -= STAT_SLOTS;
    if (o === 0) return { kind: "transmission", it, j: 0, sub: 0 };
    o -= 1;
    if (shape.median) {
      if (o === 0) return { kind: "median", it, j: 0, sub: 0 };
      o -= 1;
    }
    return { kind: "stats2", it, j: 0, sub: o };
  }
  return { kind: "idle", it: 0, j: 0, sub: 0 };
}

// ── geometry ─────────────────────────────────────────────────────────────────

export interface Frame {
  W: number;
  H: number;
  /** Pass long edge over source long edge. */
  k: number;
}

export const cells = (n: number, level: number): number => Math.ceil(n / 2 ** level);
export const tileSize = (f: Frame, level: number): number => cells(f.W, level) * cells(f.H, level);

/** The cumulative σ of chain position j, pass pixels. */
export const sigmaAt = (shape: IterationShape, j: number, frame: Frame): number => shape.sigma[shape.n - 1 - j] * frame.k;

/** The increment chain position j blurs by, pass pixels (gauss.cc's
 *  `sqrtf(SQR(s_i) - SQR(s_i+1))`). */
export function incrementAt(shape: IterationShape, j: number, frame: Frame): number {
  const s = shape.n - 1 - j;
  if (j === 0) return shape.sigma[s] * frame.k;
  const a = Math.fround(shape.sigma[s]);
  const b = Math.fround(shape.sigma[s + 1]);
  return Math.fround(Math.sqrt(Math.fround(Math.fround(a * a) - Math.fround(b * b)))) * frame.k;
}

/** The level (cell size 2^level) chain position j runs at: the finest whose
 *  boxes stay within their reads (full resolution while every radius is at
 *  most FULL_RADIUS, else m ≤ 32 cells), never finer than the one before.
 *  Coarser cells can't follow the kinks a box truncated at the frame leaves
 *  r pixels in from each edge (docs/SPEC.md §4.3). */
export function levelAt(shape: IterationShape, j: number, frame: Frame): number {
  let level = 0;
  for (let i = 0; i <= j; i++) {
    const r = Math.max(0, ...radiiAt(shape, i, frame));
    if (level === 0 && r <= FULL_RADIUS) continue;
    level = Math.max(level, 1);
    while (level < MAX_LEVEL && r * (r + 1) >= COARSE_LIMIT * 4 ** level) level++;
  }
  return level;
}

/** The reduction steps into chain position j: from → to levels. */
export function reductionsInto(shape: IterationShape, j: number, frame: Frame): [number, number][] {
  const to = levelAt(shape, j, frame);
  let from = j === 0 ? 0 : levelAt(shape, j - 1, frame);
  const steps: [number, number][] = [];
  while (to - from >= 2) {
    steps.push([from, from + 2]);
    from += 2;
  }
  if (to > from) steps.push([from, to]);
  return steps;
}

/** Where pixel x of an axis of n pixels reads a tile of `level` back: the
 *  lower of the two cells it interpolates between and the upper one's weight
 *  (rtBlurAt), between the cells' true centres (a partial last cell's sits
 *  in its pixels), and past the outer centres along the edge cells' slope:
 *  a truncated box's result keeps sloping to the frame's edge. */
export function readbackCell(x: number, n: number, level: number): [number, number] {
  const f = 2 ** level;
  const count = cells(n, level);
  if (count === 1) return [0, 0];
  const c0 = Math.min(Math.max(Math.floor((x + 0.5) / f - 0.5), 0), count - 2);
  const centre = (c: number): number => c * f + (Math.min(f, n - c * f) - 1) / 2;
  return [c0, (x - centre(c0)) / (centre(c0 + 1) - centre(c0))];
}

/** The box radii of chain position j's increment at this pass size. */
export const radiiAt = (shape: IterationShape, j: number, frame: Frame): number[] =>
  boxRadii(incrementAt(shape, j, frame), frame.W, frame.H).map((r) => Math.min(r, frame.W - 1, frame.H - 1));

/** The fractional box with variance `v` (cells²): ones out to m, t at m + 1. */
export function fractionalBox(v: number): { m: number; t: number } {
  if (v <= 0) return { m: 0, t: 0 };
  const m = Math.max(0, Math.floor((-1 + Math.sqrt(1 + 12 * v)) / 2));
  const t = (v * (2 * m + 1) - (m * (m + 1) * (2 * m + 1)) / 3) / (2 * (m + 1) ** 2 - 2 * v);
  return { m, t: Math.min(Math.max(t, 0), 0.999999) };
}

/** The variance a full-resolution box of radius r has, in cells of 2^level,
 *  less what the reduction into the level already put in (first box only). */
export function boxVariance(r: number, level: number, prefilter: number): number {
  const f = 2 ** level;
  return (r * (r + 1)) / 3 / (f * f) - prefilter;
}

/** What a reduction from level `from` into `to` leaves as variance, in the
 *  coarse level's cells². */
export const reductionVariance = (from: number, to: number): number => (1 - 4 ** (from - to)) / 12;

/** Atlas: the two tiles of each level 1…MAX_LEVEL, then the statistics trees. */
export function tileBase(frame: Frame, level: number): number {
  let base = 0;
  for (let i = 1; i < level; i++) base += 2 * tileSize(frame, i);
  return base;
}

export const statsBase = (frame: Frame): number => tileBase(frame, MAX_LEVEL + 1);

/** A statistics tree's grid at level l (l = 0 reduces the source grid by 4). */
export const statsGrid = (gw: number, gh: number, l: number): [number, number] => [Math.ceil(gw / 4 ** (l + 1)), Math.ceil(gh / 4 ** (l + 1))];

/** Levels until the grid is a single node (that last level writes the bank). */
export function statsDepth(gw: number, gh: number): number {
  let l = 0;
  for (;;) {
    const [w, h] = statsGrid(gw, gh, l);
    if (w <= 1 && h <= 1) return l + 1;
    l++;
  }
}

/** Base of tree t (0 mean, 1 variance, 2 min, 3 max) at level l. */
export function treeBase(frame: Frame, gw: number, gh: number, l: number, t: number): number {
  let base = statsBase(frame);
  for (let i = 0; i < l; i++) {
    const [w, h] = statsGrid(gw, gh, i);
    base += 4 * w * h;
  }
  const [w, h] = statsGrid(gw, gh, l);
  return base + t * w * h;
}

/** Whether the atlas fits this frame. */
export function atlasFits(frame: Frame): boolean {
  const depth = statsDepth(frame.W, frame.H);
  return treeBase(frame, frame.W, frame.H, depth - 1, 0) <= frame.W * frame.H && LO_START <= frame.W * frame.H;
}

/** Rows a linear range [from, to) covers, or null when empty. */
export function rowsOf(frame: Frame, from: number, to: number): [number, number] | null {
  if (to <= from) return null;
  return [Math.floor(from / frame.W), Math.floor((to - 1) / frame.W) + 1];
}

export type Writes = "none" | "whole" | [number, number];

/** The rows a step writes (B, G or A channel; the region doesn't care). */
export function writesOf(shapes: readonly IterationShape[], firstIt: number, step: Step, frame: Frame): Writes {
  const shape = shapes[step.it - firstIt];
  switch (step.kind) {
    case "idle":
      return "none";
    case "start":
    case "accumulate":
    case "transmission":
    case "median":
    case "final":
      return "whole";
    case "reduce": {
      const r = reductionsInto(shape, step.j, frame)[step.sub];
      if (!r) return "none";
      const base = tileBase(frame, r[1]);
      return rowsOf(frame, base, base + tileSize(frame, r[1])) ?? "none";
    }
    case "box": {
      const radii = radiiAt(shape, step.j, frame);
      if (step.sub >> 1 >= radii.length) return "none";
      const level = levelAt(shape, step.j, frame);
      if (level === 0) return "whole";
      const base = tileBase(frame, level) + (step.sub & 1 ? 0 : tileSize(frame, level));
      return rowsOf(frame, base, base + tileSize(frame, level)) ?? "none";
    }
    case "shmap1":
    case "shmap2":
      return levelAt(shape, step.j, frame) === 0 ? "whole" : "none";
    case "maskStats": {
      const level = levelAt(shape, step.j, frame);
      const gw = cells(frame.W, level);
      const gh = cells(frame.H, level);
      return statsWrites(frame, gw, gh, step.sub, MASK_STATS);
    }
    case "stats1":
    case "stats2":
      return statsWrites(frame, frame.W, frame.H, step.sub, LO_START);
  }
}

function statsWrites(frame: Frame, gw: number, gh: number, l: number, last: number): Writes {
  const depth = statsDepth(gw, gh);
  if (l >= depth) return "none";
  if (l === depth - 1) return rowsOf(frame, 0, last) ?? "none";
  const from = treeBase(frame, gw, gh, l, 0);
  return rowsOf(frame, from, treeBase(frame, gw, gh, l, 4)) ?? "none";
}

/** The rows a draw must cover: its writes and the draw before's. The first
 *  slot of a pass is drawn whole (the previous pass's last draw is unknown). */
export function regionOf(shapes: readonly IterationShape[], firstIt: number, slot: number, frame: Frame): Writes {
  if (slot === 0) return "whole";
  const now = writesOf(shapes, firstIt, stepAt(shapes, firstIt, slot), frame);
  const before = writesOf(shapes, firstIt, stepAt(shapes, firstIt, slot - 1), frame);
  if (now === "whole" || before === "whole") return "whole";
  if (now === "none") return before;
  if (before === "none") return now;
  return [Math.min(now[0], before[0]), Math.max(now[1], before[1])];
}
