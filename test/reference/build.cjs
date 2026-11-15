// Regenerates vectors.json: RawTherapee 5.13's Retinex compiled from its own
// source (rt_ref.cpp with rt/upstream and rt/stubs) over the two test images
// and every case in cases.json. The committed JSON is what the tests read, so
// a machine without a compiler still runs the suite; run this after touching
// the C++ or the cases. GPL-3.0-or-later.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = __dirname;
const build = path.join(dir, ".build");
fs.mkdirSync(build, { recursive: true });
const exe = path.join(build, process.platform === "win32" ? "rt_ref.exe" : "rt_ref");
const gxx = process.env.CXX || "g++";

const sources = [
  "rt_ref.cpp",
  "rt_curves.cpp",
  "rt/upstream/gauss.cc",
  "rt/upstream/boxblur.cc",
  "rt/upstream/shmap.cc",
  "rt/upstream/flatcurves.cc",
  "rt/upstream/diagonalcurves.cc",
];
const flags = ["-std=c++17", "-O2", "-ffp-contract=off", "-Wno-unknown-pragmas", `-I${path.join(dir, "rt", "stubs")}`, `-I${path.join(dir, "rt", "upstream")}`];
const objects = [];
for (const src of sources) {
  const obj = path.join(build, `${path.basename(src)}.o`);
  const cc = spawnSync(gxx, [...flags, "-c", path.join(dir, src), "-o", obj], { stdio: "inherit" });
  if (cc.error || cc.status !== 0) {
    console.error("g++ is required to regenerate vectors.json (the committed file still serves the tests)");
    process.exit(2);
  }
  objects.push(obj);
}
const link = spawnSync(gxx, [...objects, "-o", exe], { stdio: "inherit" });
if (link.status !== 0) process.exit(link.status ?? 1);

// Two small linear test images in RawTherapee's 0..65535: soft gradients,
// colour patches, hard edges and noise (a fixed LCG), and a second with
// near-white, near-black and strongly saturated colours.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function image(kind, w, h) {
  const rand = lcg(kind === 0 ? 12345 : 67890);
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      let r, g, b;
      if (kind === 0) {
        const base = 0.02 + 0.6 * u * u + 0.15 * Math.sin(6 * v);
        r = base * (0.8 + 0.3 * v);
        g = base;
        b = base * (1.1 - 0.4 * u);
        if (x > w * 0.55 && y > h * 0.5) {
          r = 0.55;
          g = 0.18;
          b = 0.06;
        }
        if (x < w * 0.25 && y < h * 0.3) {
          r = 0.04;
          g = 0.12;
          b = 0.35;
        }
        if ((x >> 2) % 5 === 0 && y > h * 0.75) r = g = b = 0.8;
      } else {
        const t = (Math.floor(x / 8) + Math.floor(y / 8)) % 6;
        const patches = [
          [0.94, 0.9, 0.85],
          [0.9, 0.05, 0.08],
          [0.05, 0.6, 0.05],
          [0.03, 0.04, 0.85],
          [0.002, 0.003, 0.004],
          [0.92, 0.82, 0.05],
        ];
        [r, g, b] = patches[t];
        const grad = 0.4 + 0.6 * u;
        r *= grad;
        g *= grad;
        b *= grad;
      }
      const n = 0.006 * (rand() - 0.5);
      rgb[3 * (y * w + x)] = Math.max(0, r + n) * 65535;
      rgb[3 * (y * w + x) + 1] = Math.max(0, g + n) * 65535;
      rgb[3 * (y * w + x) + 2] = Math.max(0, b + n) * 65535;
    }
  }
  return { w, h, rgb };
}

const images = [image(0, 96, 72), image(1, 88, 64)];
const bin = Buffer.alloc(4 + images.reduce((n, im) => n + 8 + im.rgb.length * 4, 0));
let at = bin.writeInt32LE(images.length, 0);
for (const im of images) {
  at = bin.writeInt32LE(im.w, at);
  at = bin.writeInt32LE(im.h, at);
  for (const v of im.rgb) at = bin.writeFloatLE(v, at);
}
const imagesFile = path.join(build, "images.bin");
fs.writeFileSync(imagesFile, bin);

const { defaults, cases } = JSON.parse(fs.readFileSync(path.join(dir, "cases.json"), "utf8"));
const MATRICES = {
  srgb: {
    forward: [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733],
  },
  rec2020: {
    forward: [0.6734241, 0.1656411, 0.1251286, 0.2790177, 0.6753402, 0.0456377, -0.00193, 0.0299784, 0.797333],
    inverse: [1.6473376, -0.3935675, -0.2359961, -0.6826036, 1.6475887, 0.012819, 0.0296524, -0.0628993, 1.2531279],
  },
};
function invert(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
}
const lines = cases.map((c) => {
  const p = { ...defaults, ...c.params };
  const working = MATRICES[c.working ?? "srgb"];
  const kv = Object.entries(p).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : typeof v === "boolean" ? (v ? 1 : 0) : v}`);
  kv.push(`forward=${working.forward.join(",")}`);
  kv.push(`inverse=${(working.inverse ?? invert(working.forward)).join(",")}`);
  kv.push(`hrenabled=${c.hrenabled ? 1 : 0}`);
  return `${c.name}|${c.image}|${kv.join(";")}`;
});
const casesFile = path.join(build, "cases.txt");
fs.writeFileSync(casesFile, lines.join("\n") + "\n");

const run = spawnSync(exe, [imagesFile, casesFile], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(run.status ?? 1);
}
const out = JSON.parse(run.stdout);
out.images = images.map((im) => ({ w: im.w, h: im.h, rgb: Buffer.from(im.rgb.buffer).toString("base64") }));
fs.writeFileSync(path.join(dir, "vectors.json"), JSON.stringify(out));
console.log(`wrote ${path.join(dir, "vectors.json")} (${out.cases.length} cases)`);
