// The param-bag contract (src/params.ts).

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, type Params } from "../src/model";
import { DERIVED_KEYS, bagPatch, editPatch, packCurve, qualified, readParams, rederivePatch, resetPatch, unpackCurve } from "../src/params";

const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p, on: true });

describe("the bag", () => {
  it("reads back what it writes", () => {
    const p = full({
      method: "highlightsPlus",
      space: "hslLog",
      gamma: "free",
      maskMethod: "partial",
      strength: 63,
      median: true,
      lightnessCurve: [1, 0, 0, 0.4, 0.6, 1, 1],
      hueCurve: [1, 0, 0.5, 0.35, 0.35, 0.5, 0.8, 0.35, 0.35],
    });
    expect(readParams(bagPatch(p))).toEqual(p);
  });

  it("reads a missing or malformed value as the default", () => {
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
    expect(readParams({ [qualified("strength")]: "x", [qualified("method")]: 9, [qualified("gainCurve")]: [1, 2] })).toEqual(DEFAULT_PARAMS);
  });

  it("clamps sliders to their ranges", () => {
    expect(readParams({ [qualified("radius")]: 1000 }).radius).toBe(100);
    expect(readParams({ [qualified("gamma")]: 4.6 }).gamma).toBe(DEFAULT_PARAMS.gamma);
    expect(readParams({ [qualified("gamma")]: 3.6 }).gamma).toBe("free");
    expect(readParams({ [qualified("method")]: -0.4 }).method).toBe("low");
    expect(() => bagPatch(readParams({ [qualified("gamma")]: 4.6, [qualified("on")]: true }))).not.toThrow();
  });

  it("packs curves to a fixed size and back", () => {
    const curve = [1, 0, 0.5, 0.35, 0.35, 1, 0.5, 0.35, 0.35];
    expect(packCurve("transmissionCurve", curve)).toHaveLength(100);
    expect(unpackCurve("transmissionCurve", packCurve("transmissionCurve", curve))).toEqual(curve);
    expect(packCurve("lightnessCurve", [0])).toHaveLength(68);
  });

  it("puts a hand-made curve in order: nodes clamped, sorted and unique, a known type", () => {
    const flat = (c: number[]) => unpackCurve("transmissionCurve", packCurve("transmissionCurve", c));
    const diagonal = (c: number[]) => unpackCurve("lightnessCurve", packCurve("lightnessCurve", c));
    expect(diagonal([1, 1.4, 1, 0.5, 0.6, -0.2, -1])).toEqual([1, 0, 0, 0.5, 0.6, 1, 1]);
    expect(diagonal([4, 0, 0, 0.5, 0.2, 0.5, 0.9, 1, 1])).toEqual([4, 0, 0, 0.5, 0.2, 1, 1]);
    expect(diagonal([7, 0, 0, 1, 1])).toBeNull();
    expect(diagonal([1.5, 0, 0, 1, 1])).toBeNull();
    expect(diagonal([1, 0.5, 0.5])).toBeNull();
    expect(diagonal([2, 0.25, 0.5, 0.75, 0, 0])).toBeNull();
    expect(diagonal([2, 0.25, 0.5, 0.75, 10, -5, 0, 0])).toEqual([2, 0.25, 0.5, 0.75, 10, -5, 0, 0]);
    expect(diagonal([0, 0.3, 0.3])).toEqual([0]);
    expect(flat([1, 1, 0.5, 2, 0.35, 0, 0.5, 0.35, 0.35, 0])).toEqual([1, 0, 0.5, 0.35, 0.35, 1, 0.5, 1, 0.35]);
    expect(flat([3, 0, 0.5, 0.35, 0.35])).toBeNull();
    expect(flat([1])).toBeNull();
  });

  it("writes the derived values only while on, and clears them when off", () => {
    const on = bagPatch(full({}));
    for (const key of DERIVED_KEYS) expect(Array.isArray(on[qualified(key)])).toBe(true);
    const off = resetPatch();
    for (const key of DERIVED_KEYS) expect(off[qualified(key)]).toBeUndefined();
    expect(off[qualified("p1Draws")]).toBe(0);
  });

  it("re-derives a bag whose derived values disagree with its edit", () => {
    const bag = { ...bagPatch(full({ radius: 40 })), [qualified("radius")]: 60 };
    const fix = rederivePatch(bag);
    expect(fix).not.toBeNull();
    expect(rederivePatch({ ...bag, ...fix })).toBeNull();
    expect(rederivePatch({})).toBeNull();
  });

  it("writes only the edited keys and the derived values from a control", () => {
    const patch = editPatch(full({ strength: 40 }), ["strength"]);
    expect(patch[qualified("strength")]).toBe(40);
    expect(patch[qualified("radius")]).toBeUndefined();
  });
});
