// @vitest-environment node
// rtref.ts against rawtherapee-cli 5.13 itself (cli.json, made by
// make_cli_fixture.py from a LinearRaw DNG through RawTherapee's raw path):
// the end-to-end check on the shipped binary, besides the compiled-source
// fixture. RawTherapee's raw pipeline around Retinex returns the identity
// within 4e-4, so that is the floor here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RT_DEFAULTS, RT_SRGB, XYZ_FROM_SRGB, retinex, rgb2lab, type RetinexParams } from "./rtref";

interface CliCase {
  name: string;
  keys: Record<string, string | number>;
  rgb: string;
}

const fixture = JSON.parse(readFileSync(join(process.cwd(), "test", "reference", "cli.json"), "utf8")) as {
  w: number;
  h: number;
  input: string;
  cases: CliCase[];
};

const floats = (b64: string): Float32Array => {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
};

/** pp3 [Retinex] keys (procparams.cc 4130-4162) as RetinexParams. */
function paramsOf(keys: Record<string, string | number>): RetinexParams {
  const p: RetinexParams = { ...RT_DEFAULTS };
  const num = (k: string): number => Number(keys[k]);
  if ("Str" in keys) p.str = num("Str");
  if ("Neigh" in keys) p.neigh = num("Neigh");
  if ("highl" in keys) p.highl = num("highl");
  if ("skal" in keys) p.skal = num("skal");
  if ("Iter" in keys) p.iter = num("Iter");
  if ("Scal" in keys) p.scal = num("Scal");
  if ("Grad" in keys) p.grad = num("Grad");
  if ("Grads" in keys) p.grads = num("Grads");
  if ("Offs" in keys) p.offs = num("Offs");
  if ("Shadows" in keys) p.shadows = num("Shadows");
  if ("Highlights" in keys) p.highlights = num("Highlights");
  if ("Median" in keys) p.medianmap = keys.Median === "true";
  if ("RetinexMethod" in keys) p.retinexMethod = keys.RetinexMethod as RetinexParams["retinexMethod"];
  if ("Retinexcolorspace" in keys) p.retinexcolorspace = keys.Retinexcolorspace as RetinexParams["retinexcolorspace"];
  if ("Gammaretinex" in keys) p.gammaretinex = keys.Gammaretinex as RetinexParams["gammaretinex"];
  if ("mapMethod" in keys) p.mapMethod = keys.mapMethod as RetinexParams["mapMethod"];
  return p;
}

describe("rtref against rawtherapee-cli", () => {
  const { w, h } = fixture;
  const input = floats(fixture.input);

  it.each(fixture.cases.map((c) => [c.name, c] as const))("matches: %s", (name, c) => {
    const want = floats(c.rgb);
    const got = retinex(input, w, h, paramsOf(c.keys), RT_SRGB).rgb;
    const e: number[] = [];
    for (let k = 0; k < w * h; k++) {
      const ref = [want[3 * k], want[3 * k + 1], want[3 * k + 2]];
      if (Math.max(...ref) >= 0.97 || Math.min(...ref) <= 0) continue;
      const a = rgb2lab(Math.max(got[3 * k], 0), Math.max(got[3 * k + 1], 0), Math.max(got[3 * k + 2], 0), XYZ_FROM_SRGB)[0];
      const b = rgb2lab(ref[0] * 65535, ref[1] * 65535, ref[2] * 65535, XYZ_FROM_SRGB)[0];
      e.push(Math.abs(a - b) / 327.68);
    }
    e.sort((x, y) => x - y);
    const p99 = e[Math.floor(0.99 * (e.length - 1))];
    const max = e[e.length - 1];
    console.log(`${name}: |ΔL*| p50 ${e[e.length >> 1].toExponential(2)} p99 ${p99.toExponential(2)} max ${max.toExponential(2)} (${e.length} px)`);
    expect(e.length).toBeGreaterThan(0.8 * w * h);
    expect(p99).toBeLessThan(2e-3);
    expect(max).toBeLessThan(5e-3);
  });
});
