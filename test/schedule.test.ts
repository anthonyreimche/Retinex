// The fixed-slot schedule and atlas (src/schedule.ts), which glsl.ts decodes
// on the GPU: slot counts from the params alone, every step's writes inside
// the frame and its region, tiles that fit and never overlap the statistics,
// the decimated chain's levels, and the box draws' read bounds.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, drawCounts, shapes, type Params } from "../src/model";
import {
  BANK_TEXELS,
  COARSE_READS,
  FULL_RADIUS,
  FLAG_TEXEL,
  LO_START,
  MASK_STATS,
  MAX_LEVEL,
  atlasFits,
  fractionalBox,
  iterationSlots,
  levelAt,
  radiiAt,
  readbackCell,
  reductionsInto,
  regionOf,
  statsBase,
  statsDepth,
  stepAt,
  tileBase,
  tileSize,
  treeBase,
  writesOf,
  type Frame,
  type IterationShape,
} from "../src/schedule";

const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p, on: true });

const PARAMS: Partial<Params>[] = [
  {},
  { method: "low", radius: 100, scales: 8, scaleGradient: 6, iterations: 5, maskMethod: "gaussian", median: true },
  { method: "uniform", scales: 8, radius: 6, maskMethod: "total" },
  { method: "highlight", iterations: 3, scaleGradient: -1, maskMethod: "partial", scales: 6 },
  { transmissionCurve: [0], scales: 1 },
  { scales: 2, radius: 6 },
];

const FRAMES: Frame[] = (
  [
    [4096, 2731, 4096 / 6000],
    [6000, 4000, 1],
    [2560, 1707, 2560 / 6000],
    [960, 640, 960 / 6000],
    [256, 171, 256 / 6000],
    [1000, 4000, 1],
    [8192, 1365, 1],
  ] as const
).map(([W, H, k]) => ({ W, H, k }));

describe("the schedule", () => {
  it("counts slots from the params alone", () => {
    expect(drawCounts(full({}))).toEqual({ p1Draws: iterationSlots(shapes(full({}))[0]), p2Draws: 0, p3Draws: 1 });
    expect(drawCounts({ ...DEFAULT_PARAMS, on: false })).toEqual({ p1Draws: 0, p2Draws: 0, p3Draws: 0 });
    for (const p of PARAMS) {
      const c = drawCounts(full(p));
      expect(c.p1Draws).toBeLessThanOrEqual(1024);
      expect(c.p2Draws).toBeLessThanOrEqual(1024);
    }
  });

  it.each(FRAMES.map((f) => [`${f.W}×${f.H}`, f] as const))("keeps every step inside the frame and its region at %s", (_name, frame) => {
    expect(atlasFits(frame)).toBe(true);
    for (const p of PARAMS) {
      const all = shapes(full(p));
      const passes: [number, IterationShape[]][] = [
        [1, all.slice(0, 1)],
        [2, all.slice(1)],
      ];
      for (const [first, list] of passes) {
        const slots = list.reduce((n, s) => n + iterationSlots(s), 0);
        for (let slot = 0; slot < slots; slot++) {
          const step = stepAt(list, first, slot);
          expect(step.kind).not.toBe("idle");
          const writes = writesOf(list, first, step, frame);
          const region = regionOf(list, first, slot, frame);
          if (writes === "whole") expect(region).toBe("whole");
          else if (writes !== "none") {
            expect(writes[0]).toBeGreaterThanOrEqual(0);
            expect(writes[1]).toBeLessThanOrEqual(frame.H);
            expect(region === "whole" || (region !== "none" && region[0] <= writes[0] && region[1] >= writes[1])).toBe(true);
          }
        }
      }
    }
  });

  it.each(FRAMES.map((f) => [`${f.W}×${f.H}`, f] as const))("keeps the tiles apart from the statistics at %s", (_name, frame) => {
    expect(tileBase(frame, MAX_LEVEL) + 2 * tileSize(frame, MAX_LEVEL)).toBeLessThanOrEqual(statsBase(frame));
    const depth = statsDepth(frame.W, frame.H);
    expect(depth).toBeLessThanOrEqual(8);
    expect(treeBase(frame, frame.W, frame.H, depth - 1, 0)).toBeLessThanOrEqual(frame.W * frame.H);
  });

  it("covers the banks, their tags and the flag on frames narrower than they are", () => {
    expect(BANK_TEXELS).toBe(2 * 8 + 1);
    expect(FLAG_TEXEL).toBe(2 * BANK_TEXELS);
    expect(LO_START).toBe(FLAG_TEXEL + 1);
    const frame: Frame = { W: 8, H: 40, k: 1 };
    expect(atlasFits(frame)).toBe(true);
    expect(atlasFits({ W: 5, H: 6, k: 1 })).toBe(false);
    const shape = shapes(full({ maskMethod: "gaussian", method: "low" }))[0];
    let stats = 0;
    let mask = 0;
    for (let slot = 0; slot < iterationSlots(shape); slot++) {
      const step = stepAt([shape], 1, slot);
      const writes = writesOf([shape], 1, step, frame);
      if (writes === "none" || writes === "whole") continue;
      if ((step.kind === "stats1" || step.kind === "stats2") && step.sub === statsDepth(frame.W, frame.H) - 1) {
        expect(writes).toEqual([0, Math.ceil(LO_START / frame.W)]);
        stats++;
      }
      if (step.kind === "maskStats" && writes[0] === 0 && writes[1] === Math.ceil(MASK_STATS / frame.W)) mask++;
    }
    expect(stats).toBe(2);
    expect(mask).toBeGreaterThan(0);
  });

  const coarseReads = (r: number, level: number): number => 2 * fractionalBox((r * (r + 1)) / 3 / 4 ** level).m + 3;

  it("runs each scale at the finest level its boxes' reads allow, never finer than the scale before", () => {
    expect(FULL_RADIUS).toBe(17);
    expect(COARSE_READS).toBe(67);
    for (const frame of [...FRAMES, { W: 640, H: 400, k: 1 }, { W: 1600, H: 1000, k: 1 }]) {
      for (const p of [...PARAMS, { radius: 80 }, { radius: 30, space: "hslLinear" as const }]) {
        for (const shape of shapes(full(p))) {
          let before = 0;
          for (let j = 0; j < shape.n; j++) {
            const level = levelAt(shape, j, frame);
            const rmax = Math.max(...radiiAt(shape, j, frame));
            expect(level).toBeGreaterThanOrEqual(before);
            expect(reductionsInto(shape, j, frame).length).toBeLessThanOrEqual(3);
            if (level === 0) expect(rmax).toBeLessThanOrEqual(FULL_RADIUS);
            else if (level > Math.max(before, 1)) expect(coarseReads(rmax, level - 1)).toBeGreaterThan(COARSE_READS);
            else if (level === 1 && before === 0) expect(rmax).toBeGreaterThan(FULL_RADIUS);
            before = level;
          }
        }
      }
    }
  });

  it("keeps every full-resolution box within 35 reads and every coarse box within 67", () => {
    for (const frame of FRAMES) {
      for (const p of PARAMS) {
        for (const shape of shapes(full(p))) {
          for (let j = 0; j < shape.n; j++) {
            const level = levelAt(shape, j, frame);
            for (const r of radiiAt(shape, j, frame)) {
              if (level === 0) expect(2 * r + 1).toBeLessThanOrEqual(35);
              else expect(coarseReads(r, level)).toBeLessThanOrEqual(COARSE_READS);
            }
          }
        }
      }
    }
  });

  it("reads a tile back between true cell centres, extending the edge cells' slope past the outer ones", () => {
    // 10 px at level 2: cells of 4, 4 and 2 px, centred at 1.5, 5.5 and 8.5.
    expect(readbackCell(0, 10, 2)).toEqual([0, -0.375]);
    expect(readbackCell(3.5, 10, 2)).toEqual([0, 0.5]);
    expect(readbackCell(7, 10, 2)).toEqual([1, 0.5]);
    expect(readbackCell(9, 10, 2)[0]).toBe(1);
    expect(readbackCell(9, 10, 2)[1]).toBeCloseTo(7 / 6, 12);
    expect(readbackCell(2, 3, 2)).toEqual([0, 0]);
  });

  it("matches a fractional box's variance to its target", () => {
    for (const v of [0.2, 0.83, 4.96, 40.8, 80]) {
      const { m, t } = fractionalBox(v);
      let second = 2 * t * (m + 1) ** 2;
      for (let d = 1; d <= m; d++) second += 2 * d * d;
      expect(second / (2 * m + 1 + 2 * t)).toBeCloseTo(v, 6);
    }
  });
});
