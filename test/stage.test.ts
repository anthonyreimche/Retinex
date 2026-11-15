// The stage's contract with the host (src/stage.ts, src/glsl.ts): placement,
// dormancy, which pass reads what, the D3D11 rules and each helper's reads.

import { describe, expect, it } from "vitest";
import { helperFetches } from "./support/fetch-budget";
import { DERIVED_MARK, DERIVED_SIZES, type Params, DEFAULT_PARAMS, derive } from "../src/model";
import { DERIVED_KEYS, VIEW_KEY, VIEW_P1_KEY, qualified, bagPatch } from "../src/params";
import { PASS_KEYS, PRIORITY, resultSampler, retinexStage } from "../src/stage";

const stage = retinexStage();
const passes = stage.passes ?? [];
const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p, on: true });

describe("the stage", () => {
  it("sits in the decode phase, reads the current image and is a global look", () => {
    expect(stage.phase).toBe("decode");
    expect(stage.priority).toBe(PRIORITY);
    expect(stage.reads).toBe("current");
    expect(stage.presetScope).toBe("global");
    expect(stage.mask).toBeUndefined();
    expect(stage.keepsDetail).toBeUndefined();
    expect(stage.viewOnly).toBeUndefined();
  });

  it("is dormant while every pass draws nothing", () => {
    expect(stage.dormantWhen).toEqual({ p1Draws: 0, p2Draws: 0, p3Draws: 0 });
  });

  it("names its own result sampler and moves lin only under the sentinel", () => {
    expect(resultSampler("retinex.msr")).toMatch(/^u_[0-9a-z]{1,4}_stageResult$/);
    expect(stage.glsl).toContain(resultSampler(stage.id));
    expect(stage.glsl).toContain("abs(rtResult.a - (-10000.0)) < 0.5");
    expect(stage.glsl).not.toMatch(/rtResult\.a\s*</);
  });

  it("marks every plan array a pass reads with the layout's version, and each pass checks its own", () => {
    const d = derive(full({}));
    expect(DERIVED_MARK).toBe(1001);
    expect(d.rtConv[4]).toBe(DERIVED_MARK);
    expect(d.rtMask[7]).toBe(DERIVED_MARK);
    expect(d.rtIters[15]).toBe(DERIVED_MARK);
    expect(d.rtFlags[11]).toBe(DERIVED_MARK);
    const marks = ["rtConv[1].x", "rtMask[1].w", "rtIters[3].w", "rtFlags[2].w"];
    const [p1, p2, p3] = passes.map((p) => p.helpers ?? "");
    const checked = (helpers: string) => marks.filter((m) => helpers.includes(`${m} == 1001.0`));
    expect(checked(p1)).toEqual(["rtConv[1].x", "rtMask[1].w"]);
    expect(checked(p2)).toEqual(["rtConv[1].x", "rtIters[3].w", "rtFlags[2].w"]);
    expect(checked(p3)).toEqual(["rtConv[1].x", "rtIters[3].w", "rtFlags[2].w"]);
    for (const helpers of [p1, p2]) expect(helpers).toContain("bool rtCountsFit() { return rtMarked() &&");
  });

  it("draws nothing in the final pass unless the last iteration's bank carries its tag", () => {
    const p3 = passes[2].helpers ?? "";
    expect(p3).toContain("iters < 1 || iters > 5");
    expect(p3).toContain("rtBankTag(iters) != float(iters)");
    expect(p3).toContain("any(isnan(d)) || any(isinf(d))");
    expect(passes[1].glsl).toContain("rtBankTag(st.it - 1) != float(st.it - 1)");
  });

  it("rounds the box count's m half away from zero with room for a division's last bit", () => {
    for (const pass of passes.slice(0, 2)) expect(pass.helpers).toContain("floor(abs(mIdeal) + 0.5 + 1e-5)");
  });

  it("gives P1 the view only through its own value", () => {
    const keys = passes.map((p) => (p.uniforms ?? []).map((u) => u.key));
    expect(keys[0]).toContain(VIEW_P1_KEY);
    expect(keys[0]).not.toContain(VIEW_KEY);
    expect(keys[1]).toContain(VIEW_KEY);
    expect(keys[2]).toContain(VIEW_KEY);
    expect(passes[0].glsl).not.toMatch(/\bview\b/);
    expect(passes[0].helpers).not.toMatch(/\bview\b/);
  });

  it("keeps the analysis checkpoint and nothing else", () => {
    expect(passes.map((p) => p.keep === true)).toEqual([true, false, false]);
    expect(passes.map((p) => p.channels)).toEqual([4, 4, 4]);
  });

  it("keeps Strength, Contrast, Offset and the gain and hue curves out of the analysis pass", () => {
    const p1 = new Set((passes[0].uniforms ?? []).map((u) => u.key));
    for (const key of ["rtIters", "rtFlags", "rtProtect", "rtGainA", "rtGainB", "rtHue"]) expect(p1.has(key)).toBe(false);
    const a = derive(full({ strength: 20 }));
    const b = derive(full({ strength: 80, contrast: 100, offset: 500 }));
    for (const key of PASS_KEYS[1]) expect(a[key]).toEqual(b[key]);
  });

  it("declares every derived key on some pass, and only vec4 arrays within the host's limits", () => {
    const declared = new Set(passes.flatMap((p) => (p.uniforms ?? []).map((u) => u.key)));
    for (const key of DERIVED_KEYS) expect(declared.has(key)).toBe(true);
    for (const pass of passes) {
      let vectors = 0;
      for (const u of pass.uniforms ?? []) {
        if (u.length !== undefined) expect(u.length).toBeLessThanOrEqual(64);
        vectors += u.length ?? 1;
      }
      expect(vectors).toBeLessThanOrEqual(512);
    }
    for (const [key, size] of Object.entries(DERIVED_SIZES)) expect(derive(full({}))[key].length).toBe(4 * size);
  });

  it("keeps the curves' derived arrays off the stage's own uniforms", () => {
    const own = new Set(stage.uniforms.map((u) => u.key));
    for (const key of DERIVED_KEYS) expect(own.has(key)).toBe(false);
  });

  it("follows the D3D11 rules: no texture() or readPrev(), no const or local arrays", () => {
    for (const src of [stage.glsl, stage.helpers ?? "", ...passes.flatMap((p) => [p.glsl, p.helpers ?? "", p.region ?? ""])]) {
      expect(src).not.toMatch(/\btexture\s*\(/);
      expect(src).not.toMatch(/\breadPrev4?\s*\(/);
      expect(src).not.toMatch(/\bconst\s+\w+\s+\w+\s*\[/);
      expect(src).not.toMatch(/\b(?:float|int|vec[234])\s+\w+\s*\[\s*\d+\s*\]\s*;/);
    }
  });

  it("names no uniform key as a helper or a local", () => {
    for (const pass of passes) {
      const keys = (pass.uniforms ?? []).map((u) => u.key);
      for (const key of keys) {
        expect(pass.helpers ?? "").not.toMatch(new RegExp(`\\b(?:float|int|vec[234]|bool)\\s+${key}\\b`));
      }
    }
  });

  it("does integer address arithmetic in highp", () => {
    for (const pass of passes.slice(0, 2)) {
      expect(pass.helpers).toMatch(/highp int rtTileBase/);
      expect(pass.helpers).toMatch(/highp ivec2 rtAt/);
    }
  });

  it("reads tens of texels a draw", () => {
    const [p1, p2, p3] = passes.map((p) => p.helpers ?? "");
    const budget: [string, string, number][] = [
      ["rtReduceTexel", p1, 16],
      ["rtBoxFull", p1, 35],
      // A coarse box draw covers only its tile: at most a quarter of the frame.
      ["rtBoxCoarse", p1, 67],
      ["rtBlurAt", p1, 5],
      ["rtDirpyr", p1, 10],
      ["rtReduceSource", p1, 16],
      ["rtReduceChildren", p1, 32],
      ["rtMasked", p1, 3],
      ["rtSourceAt", p1, 1],
      ["rtOutput", p2, 8],
      ["rtFinal", p3, 13],
      ["rtStepAt", p1, 0],
      ["rtPixelAt", p2, 1],
    ];
    for (const [name, helpers, max] of budget) expect(helperFetches(name, helpers), name).toBeLessThanOrEqual(max);
    // An accumulation draw: the blur (either branch), the mask's three constants, the source.
    expect(helperFetches("rtBlurAt", p1) + helperFetches("rtMasked", p1) + helperFetches("rtSourceAt", p1)).toBeLessThanOrEqual(11);
  });

  it("writes the draw counts the schedule needs", () => {
    const bag = bagPatch(full({}));
    expect(bag[qualified("p3Draws")]).toBe(1);
    expect(Number(bag[qualified("p1Draws")])).toBeGreaterThan(30);
  });
});
