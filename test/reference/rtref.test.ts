// @vitest-environment node
// rtref.ts against RawTherapee 5.13 compiled from its own source
// (vectors.json, made by build.cjs from rt_ref.cpp): every case of cases.json
// on both test images, in RawTherapee's 0..65535.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REC2020_FROM_XYZ,
  RT_SRGB,
  XYZ_FROM_REC2020,
  boxRadii,
  invert3,
  iterationPlans,
  retinex,
  type Options,
  type RetinexParams,
} from "./rtref";

interface Case {
  name: string;
  image: number;
  params: Partial<RetinexParams>;
  working?: "srgb" | "rec2020";
  hrenabled?: boolean;
}

interface Vector {
  name: string;
  w: number;
  h: number;
  mini: number;
  maxi: number;
  rgb: string;
}

const here = join(process.cwd(), "test", "reference");
const spec = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")) as { defaults: RetinexParams; cases: Case[] };
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8")) as {
  cases: Vector[];
  images: { w: number; h: number; rgb: string }[];
};

const floats = (b64: string): Float32Array => {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
};

export const caseParams = (c: Case): RetinexParams => ({
  ...spec.defaults,
  protectFrom: 70,
  protectSoftness: 20,
  protectAmount: 100,
  ...c.params,
});

const optionsOf = (c: Case): Options => ({
  ...RT_SRGB,
  ...(c.working === "rec2020" ? { working: XYZ_FROM_REC2020, gamutInverse: REC2020_FROM_XYZ, backInverse: invert3(XYZ_FROM_REC2020) } : {}),
  highlight: c.hrenabled === true,
});

describe("rtref against RawTherapee compiled", () => {
  it("has a vector for every case", () => {
    expect(vectors.cases.map((v) => v.name)).toEqual(spec.cases.map((c) => c.name));
  });

  it.each(spec.cases.map((c) => [c.name, c] as const))("every box fits its image: %s", (_name, c) => {
    const im = vectors.images[c.image];
    for (const plan of iterationPlans(caseParams(c))) {
      let prev: number | null = null;
      for (let s = plan.scal - 1; s >= 0; s--) {
        const sigma = prev === null ? plan.scales[s] : Math.sqrt(plan.scales[s] ** 2 - prev ** 2);
        for (const r of boxRadii(sigma, im.w, im.h)) expect(2 * r + 1).toBeLessThanOrEqual(Math.min(im.w, im.h));
        prev = plan.scales[s];
      }
    }
  });

  it.each(spec.cases.map((c, i) => [c.name, c, i] as const))("matches: %s", (name, c, i) => {
    const im = vectors.images[c.image];
    const input = floats(im.rgb);
    const want = floats(vectors.cases[i].rgb);
    const got = retinex(input, im.w, im.h, caseParams(c), optionsOf(c)).rgb;
    const err: number[] = [];
    let moved = 0;
    for (let k = 0; k < got.length; k++) {
      err.push(Math.abs(got[k] - want[k]) / Math.max(Math.abs(want[k]), 655.35));
      moved = Math.max(moved, Math.abs(want[k] - input[k]) / 65535);
    }
    err.sort((a, b) => a - b);
    const p99 = err[Math.floor(0.99 * (err.length - 1))];
    const max = err[err.length - 1];
    const over = err.filter((e) => e > 1e-3).length / err.length;
    console.log(`${name}: rel p99 ${p99.toExponential(2)} max ${max.toExponential(2)} over 1e-3 ${(100 * over).toFixed(3)}%`);
    expect(moved, "the case changes the image").toBeGreaterThan(1e-3);
    expect(p99).toBeLessThan(2e-5);
    expect(max).toBeLessThan(2e-4);
  });
});
