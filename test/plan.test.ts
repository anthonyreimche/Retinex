// RawTherapee's plan quirks (docs/SPEC.md §1.10), on src/rt-plan.ts, the code
// the passes' constants come from. vectors.json pins the whole tool; these name
// each behaviour.

import { describe, expect, it } from "vitest";
import { RT_DEFAULTS, boxRadii, calcGamma, iterationPlans, methodMode, neighbours, protection, retinexScales } from "../src/rt-plan";

describe("RawTherapee's Retinex plan", () => {
  it("runs High at mode 3, not 2 (ipretinex.cc 233-245)", () => {
    expect(methodMode({ ...RT_DEFAULTS, retinexMethod: "high" })).toBe(3);
    expect(methodMode({ ...RT_DEFAULTS, retinexMethod: "highli" })).toBe(3);
    expect(methodMode({ ...RT_DEFAULTS, retinexMethod: "uni" })).toBe(0);
    expect(methodMode({ ...RT_DEFAULTS, retinexMethod: "low" })).toBe(1);
  });

  it("truncates 2.8f × neigh in float", () => {
    expect(neighbours(80)).toBe(224);
    expect(neighbours(10)).toBe(28);
    expect(neighbours(6)).toBe(16);
  });

  it("gives the default High its three scales", () => {
    const [plan] = iterationPlans(RT_DEFAULTS);
    expect(plan.scal).toBe(3);
    expect(plan.scales[0]).toBeCloseTo(555.606, 2);
    expect(plan.scales[1]).toBeCloseTo(550.551, 2);
    expect(plan.scales[2]).toBeCloseTo(519.94, 1);
  });

  it("sizes the Highlight threshold into High's scales although the GUI hides it", () => {
    const a = iterationPlans({ ...RT_DEFAULTS, highl: 4 })[0].scales[0];
    const b = iterationPlans({ ...RT_DEFAULTS, highl: 8 })[0].scales[0];
    expect(b).toBeGreaterThan(a * 1.5);
  });

  it("applies the strength gradient at one iteration (ks 1.3 by default)", () => {
    expect(iterationPlans(RT_DEFAULTS)[0].strengthx).toBeCloseTo(0.26, 6);
    expect(iterationPlans({ ...RT_DEFAULTS, grads: 0 })[0].strengthx).toBeCloseTo(0.2, 6);
  });

  it("carries the running scale count between iterations", () => {
    const plans = iterationPlans({ ...RT_DEFAULTS, iter: 5, scal: 6, skal: 8 });
    expect(plans.map((p) => p.scal)).toEqual([6, 5, 5, 4, 2]);
  });

  it("keeps the transmission gradient at 1 on the first iteration", () => {
    for (const grad of [-2, -1, 0, 1, 2]) {
      const [plan] = iterationPlans({ ...RT_DEFAULTS, grad, iter: 3 });
      expect(plan.varx).toBeCloseTo(2, 6);
    }
  });

  it("builds RawTherapee's scale lists for one and two scales", () => {
    expect(retinexScales(1, 3, 100, 2)).toEqual([50]);
    expect(retinexScales(2, 3, 100, 2)).toEqual([100, 50]);
    expect(retinexScales(3, 0, 2, 2)[2]).toBe(2);
  });

  it("sizes the default boxes as gaussianBlur does at 6000 × 4000", () => {
    expect(boxRadii(519.94, 6000, 4000)).toEqual([519, 519, 520]);
    expect(boxRadii(181.02, 6000, 4000)).toEqual([180, 181, 181]);
    expect(boxRadii(74.78, 6000, 4000)).toEqual([74, 74, 75]);
  });

  it("adds boxes while the box is wider than the image, keeping w when capped at 6", () => {
    expect(boxRadii(400, 1000, 300).length).toBeGreaterThan(3);
    expect(boxRadii(400, 1000, 300).length).toBeLessThanOrEqual(6);
  });

  it("finds dcraw's toe for the free gamma", () => {
    const g = calcGamma(1 / 1.3, 3);
    expect(g[3]).toBeCloseTo(g[2] / 3, 12);
    expect(g[2]).toBeGreaterThan(0);
  });

  it("eases Highlights+ off with a smoothstep over the original lightness", () => {
    const p = { ...RT_DEFAULTS, protectFrom: 70, protectSoftness: 20, protectAmount: 100 };
    expect(protection(60, p)).toBe(1);
    expect(protection(80, p)).toBeCloseTo(0.5, 9);
    expect(protection(95, p)).toBe(0);
    expect(protection(80, { ...p, protectAmount: 50 })).toBeCloseTo(0.75, 9);
  });
});
