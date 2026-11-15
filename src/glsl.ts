// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The GPU side of rt-plan.ts and test/reference/rtref.ts: RawTherapee 5.13's
// Retinex (rtengine/ipretinex.cc MSR, rtengine/rawimagesource.cc
// retinexPrepareBuffers/retinex, the iterated box blur of rtengine/gauss.cc and
// rtengine/boxblur.cc, SHMap::updateL of rtengine/shmap.cc, the colour helpers
// of rtengine/color.cc/.h) as three four-channel passes.
//
// ipretinex.cc: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>;
//   adaptation 2015 Jacques Desmis <jdesmis@gmail.com>, 2015 Ingo Weyrich
//   <heckflosse67@gmx.de>
// rawimagesource.cc, gauss.cc, shmap.cc, color.cc, color.h, median.h:
//   Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// boxblur.cc: Copyright (C) 2010 Emil Martinec <ejmartin@uchicago.edu>;
//   Copyright (C) 2019 Ingo Weyrich <heckflosse67@gmx.de>
//
// Every draw decodes uPassIndex into a step of the fixed-slot schedule
// (schedule.ts) and works on part of the target: R the iteration's
// log-retinex map's high half, G the iteration's source (later iterations) or
// the mask's statistics and the views' copies, B the blur plane and the atlas
// of coarse tiles and statistics trees, A the map's low half (the shadow map
// while a mask scale is built) and, on its first texels, the statistics banks
// and the flag. docs/SPEC.md §4 sets it out.
//
// D3D11 (ANGLE) shapes this code: no arrays but uniforms, read by one accessor
// each; no texture(); loops with literal bounds that break early.

import { BANK_TEXELS, COARSE_LIMIT, COARSE_READS, FLAG_TEXEL, FULL_RADIUS, LO_START, MASK_SLOTS, MASK_STATS, MAX_LEVEL, RED_SLOTS, STAT_SLOTS } from "./schedule";
import { DERIVED_MARK, DIAGONAL_SAMPLES, HUE_SAMPLES } from "./model";
import { VIEW_KEY, VIEW_P1_KEY } from "./params";

/** A GLSL float literal that always carries a decimal point. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}e${Number(exponent)}`;
  }
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".0") : `${s}.0`;
}

const lit = glslLiteral;

export const STEP = {
  idle: 0,
  start: 1,
  reduce: 2,
  box: 3,
  shmap1: 4,
  shmap2: 5,
  maskStats: 6,
  accumulate: 7,
  stats1: 8,
  transmission: 9,
  median: 10,
  stats2: 11,
  final: 12,
  flag: 13,
} as const;

/** Exact in half float and far from anything a result holds. */
export const RESULT_SENTINEL = -1e4;
/** What the flag texel holds when the draw counts don't fit the params. */
export const FLAG_VALUE = -4096;

/** xyz_sRGB (iccmatrices.h:75-79) and its inverse; rec2020_xyz (199-209). */
const XYZ_FROM_709 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
function invert(m: number[][]): number[][] {
  const [a, b, c] = m;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  return [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
}
const REC2020_FROM_XYZ = [
  [1.6473376, -0.3935675, -0.2359961],
  [-0.6826036, 1.6475887, 0.012819],
  [0.0296524, -0.0628993, 1.2531279],
];
/** A row-major matrix as GLSL's column-major mat3 constructor takes it. */
const mat3 = (m: number[][]): string => `mat3(${[0, 1, 2].flatMap((col) => [0, 1, 2].map((row) => lit(m[row][col]))).join(", ")})`;

/** baseline-tone.ts's constants (Safelight's RAW baseline, frozen by process versions). */
const BA = 0.5323;
const BB = 1.2015;
const BC = 0.0293;
const BD = -0.4781;
const BE = 1.9616;
const BF = 0.2281;
const BG = +(BA + BB + BC - BD - BE - BF).toFixed(4);

const KAPPA = 24389 / 27;
const EPS_MAX = (65535 * 216) / 24389;

export type PassId = 1 | 2 | 3;

// ── shared by every pass ─────────────────────────────────────────────────────

const COMMON = `
highp ivec2 rtSize() { return ivec2(floor(1.0 / uTexel + 0.5)); }
float rtK() {
  vec2 pass = floor(1.0 / uTexel + 0.5);
  float source = max(uSourceSize.x, uSourceSize.y);
  return source > 0.0 ? max(pass.x, pass.y) / source : 1.0;
}
vec4 rtOneHot(highp int i) { return vec4(equal(ivec4(i), ivec4(0, 1, 2, 3))); }
float rtQuantize(float v) {
  if (abs(v) < ${lit(2 ** -14)}) return 0.0;
  return uintBitsToFloat((floatBitsToUint(v) + 0x1000u) & 0xFFFFE000u);
}
float rtHalf(float v) {
  float c = clamp(v, -65000.0, 65000.0);
  if (abs(c) < ${lit(2 ** -14)}) return floor(c * ${lit(2 ** 24)} + 0.5) * ${lit(2 ** -24)};
  return rtQuantize(c);
}
highp ivec2 rtAt(highp int n) {
  highp int w = rtSize().x;
  highp int row = n / w;
  return ivec2(n - row * w, row);
}
vec4 rtFetch(highp int n) { return fetchPrev4(rtAt(n)); }
highp int rtCells(highp int n, int level) { return (n + (1 << level) - 1) >> level; }
highp int rtTileSize(int level) { highp ivec2 s = rtSize(); return rtCells(s.x, level) * rtCells(s.y, level); }
highp int rtTileBase(int level) {
  highp int base = 0;
  for (int i = 1; i <= ${MAX_LEVEL}; i++) {
    if (i >= level) break;
    base += 2 * rtTileSize(i);
  }
  return base;
}
highp int rtStatsBase() { return rtTileBase(${MAX_LEVEL + 1}); }
highp int rtGridDiv(highp int n, int l) { highp int d = 1 << (2 * (l + 1)); return (n + d - 1) / d; }
int rtStatsDepth(highp int gw, highp int gh) {
  for (int l = 0; l < ${STAT_SLOTS}; l++) {
    if (rtGridDiv(gw, l) <= 1 && rtGridDiv(gh, l) <= 1) return l + 1;
  }
  return ${STAT_SLOTS + 1};
}
highp int rtTreeBase(highp int gw, highp int gh, int l, int tree) {
  highp int base = rtStatsBase();
  for (int i = 0; i < ${STAT_SLOTS}; i++) {
    if (i >= l) break;
    base += 4 * rtGridDiv(gw, i) * rtGridDiv(gh, i);
  }
  return base + tree * rtGridDiv(gw, l) * rtGridDiv(gh, l);
}
bool rtFits() {
  highp ivec2 s = rtSize();
  int depth = rtStatsDepth(s.x, s.y);
  return depth <= ${STAT_SLOTS} && rtTreeBase(s.x, s.y, depth - 1, 0) <= s.x * s.y && ${LO_START} <= s.x * s.y;
}
// gaussianBlur's box sizing (gauss.cc 1379-1418) at the pass size.
int rtBoxCount(float sigma, out int wl, out int m) {
  highp ivec2 s = rtSize();
  float W = float(s.x);
  float H = float(s.y);
  float v = 12.0 * sigma * sigma;
  int n = 1;
  float w = sqrt(v + 1.0);
  for (int i = 0; i < 4096; i++) {
    if (!(w > W || w > H)) break;
    n++;
    w = sqrt(v / float(n) + 1.0);
  }
  if (n < 3) {
    n = 3;
    w = sqrt(v / 3.0 + 1.0);
  } else if (n > 6) {
    n = 6;
  }
  wl = int(floor(w));
  if (wl - 2 * (wl / 2) == 0) wl--;
  float fl = float(wl);
  float mIdeal = (v - float(n) * fl * fl - 4.0 * float(n) * fl - 3.0 * float(n)) / (-4.0 * fl - 4.0);
  m = int(sign(mIdeal) * floor(abs(mIdeal) + 0.5 + 1e-5));
  return n;
}
int rtBoxRadius(float sigma, int box) {
  int wl;
  int m;
  int n = rtBoxCount(sigma, wl, m);
  if (box >= n) return -1;
  highp ivec2 s = rtSize();
  return min(((box < m ? wl : wl + 2) - 1) / 2, min(s.x, s.y) - 1);
}
// The fractional box with variance v (cells²): ones out to m, t at m + 1.
vec2 rtFractional(float v) {
  if (v <= 0.0) return vec2(0.0);
  float m = max(0.0, floor((-1.0 + sqrt(1.0 + 12.0 * v)) / 2.0));
  float t = (v * (2.0 * m + 1.0) - m * (m + 1.0) * (2.0 * m + 1.0) / 3.0) / (2.0 * (m + 1.0) * (m + 1.0) - 2.0 * v);
  return vec2(m, clamp(t, 0.0, 0.999999));
}
`;

// ── each pass's view of the plan ─────────────────────────────────────────────

const PLAN: Record<PassId, string> = {
  1: `
float rtSigma(int it, int s) { return dot(rtIt1[s >> 2], rtOneHot(s & 3)); }
int rtScales(int it) { return int(rtIt1[2].x + 0.5); }
float rtPond(int it) { return rtIt1[2].y; }
float rtLimit(int it) { return rtIt1[2].z; }
float rtLimitInv(int it) { return rtIt1[2].w; }
bool rtLogMode() { return rtIt1[3].x > 0.5; }
bool rtHasTrans() { return rtIt1[3].y > 0.5; }
bool rtMedianAt(int it) { return it == 1 && rtIt1[3].z > 0.5; }
int rtIterCount() { return int(rtIt1[3].w + 0.5); }
int rtMapMet() { return int(rtMask[0].x + 0.5); }
bool rtMarked() { return rtConv[1].x == ${lit(DERIVED_MARK)} && rtMask[1].w == ${lit(DERIVED_MARK)}; }
bool rtMaskAt(int it, int s) {
  int met = rtMapMet();
  return it == 1 && (met == 3 || met == 4 || (met == 2 && s > 2));
}
// The blur plane and tiles keep their low halves in G while no mask, whose
// statistics G holds, runs.
bool rtLo() { return rtMapMet() == 0; }
const int RT_FIRST = 1;
int rtLastIt() { return 1; }
`,
  2: `
float rtIter(int it, int k) { return dot(rtIters[(it - 1) * 4 + (k >> 2)], rtOneHot(k & 3)); }
float rtSigma(int it, int s) { return rtIter(it, s); }
int rtScales(int it) { return int(rtIter(it, 8) + 0.5); }
float rtPond(int it) { return rtIter(it, 9); }
float rtLimit(int it) { return rtIter(it, 10); }
float rtLimitInv(int it) { return rtIter(it, 11); }
float rtVarx(int it) { return rtIter(it, 12); }
float rtStrengthx(int it) { return rtIter(it, 13); }
bool rtLogMode() { return rtFlags[1].x > 0.5; }
bool rtHasTrans() { return rtFlags[0].y > 0.5; }
bool rtMedianAt(int it) { return false; }
int rtIterCount() { return int(rtFlags[0].x + 0.5); }
bool rtMaskAt(int it, int s) { return false; }
bool rtMarked() { return rtConv[1].x == ${lit(DERIVED_MARK)} && rtIters[3].w == ${lit(DERIVED_MARK)} && rtFlags[2].w == ${lit(DERIVED_MARK)}; }
// G holds the iteration's source: the blurs are single halves.
bool rtLo() { return false; }
const int RT_FIRST = 2;
int rtLastIt() { return rtIterCount(); }
`,
  3: `
float rtIter(int it, int k) { return dot(rtIters[(it - 1) * 4 + (k >> 2)], rtOneHot(k & 3)); }
float rtVarx(int it) { return rtIter(it, 12); }
float rtStrengthx(int it) { return rtIter(it, 13); }
bool rtHasTrans() { return rtFlags[0].y > 0.5; }
int rtIterCount() { return int(rtFlags[0].x + 0.5); }
bool rtMarked() { return rtConv[1].x == ${lit(DERIVED_MARK)} && rtIters[3].w == ${lit(DERIVED_MARK)} && rtFlags[2].w == ${lit(DERIVED_MARK)}; }
`,
};

// ── the schedule (schedule.ts stepAt, levels, writes) ────────────────────────

const SCHEDULE = `
struct RtStep {
  int kind;
  int it;
  int j;
  int sub;
};
int rtScaleSlots(int it, int j) {
  return ${RED_SLOTS + 12} + (rtMaskAt(it, rtScales(it) - 1 - j) ? ${MASK_SLOTS} : 0) + 1;
}
int rtIterSlots(int it) {
  int n = rtScales(it);
  int slots = ${1 + STAT_SLOTS};
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    slots += rtScaleSlots(it, j);
  }
  if (rtHasTrans()) slots += 1 + (rtMedianAt(it) ? 1 : 0) + ${STAT_SLOTS};
  return slots;
}
int rtPassSlots() {
  int slots = 0;
  for (int it = 1; it <= 5; it++) {
    if (it < RT_FIRST || it > rtLastIt()) continue;
    slots += rtIterSlots(it);
  }
  return slots;
}
bool rtCountsFit() { return rtMarked() && rtPassSlots() == uPassCount && rtFits(); }
RtStep rtStepAt(int slot) {
  RtStep idle = RtStep(${STEP.idle}, 0, 0, 0);
  if (!rtCountsFit()) return RtStep(${STEP.flag}, 0, 0, 0);
  int o = slot;
  for (int it = 1; it <= 5; it++) {
    if (it < RT_FIRST || it > rtLastIt()) continue;
    int count = rtIterSlots(it);
    if (o >= count) {
      o -= count;
      continue;
    }
    if (o == 0) return RtStep(${STEP.start}, it, 0, 0);
    o -= 1;
    int n = rtScales(it);
    for (int j = 0; j < 8; j++) {
      if (j >= n) break;
      int size = rtScaleSlots(it, j);
      if (o < size) {
        if (o < ${RED_SLOTS}) return RtStep(${STEP.reduce}, it, j, o);
        o -= ${RED_SLOTS};
        if (o < 12) return RtStep(${STEP.box}, it, j, o);
        o -= 12;
        if (rtMaskAt(it, n - 1 - j)) {
          if (o == 0) return RtStep(${STEP.shmap1}, it, j, 0);
          if (o == 1) return RtStep(${STEP.shmap2}, it, j, 0);
          if (o < ${MASK_SLOTS}) return RtStep(${STEP.maskStats}, it, j, o - 2);
          o -= ${MASK_SLOTS};
        }
        return RtStep(${STEP.accumulate}, it, j, 0);
      }
      o -= size;
    }
    if (o < ${STAT_SLOTS}) return RtStep(${STEP.stats1}, it, 0, o);
    o -= ${STAT_SLOTS};
    if (o == 0) return RtStep(${STEP.transmission}, it, 0, 0);
    o -= 1;
    if (rtMedianAt(it)) {
      if (o == 0) return RtStep(${STEP.median}, it, 0, 0);
      o -= 1;
    }
    return RtStep(${STEP.stats2}, it, 0, o);
  }
  return idle;
}
float rtIncrement(int it, int j) {
  int s = rtScales(it) - 1 - j;
  float a = rtSigma(it, s);
  if (j == 0) return a * rtK();
  float b = rtSigma(it, s + 1);
  return sqrt(max(a * a - b * b, 0.0)) * rtK();
}
// The largest radius of chain position j's boxes.
highp int rtMaxRadius(int it, int j) {
  int wl;
  int m;
  int n = rtBoxCount(rtIncrement(it, j), wl, m);
  highp ivec2 s = rtSize();
  return min(((m < n ? wl + 2 : wl) - 1) / 2, min(s.x, s.y) - 1);
}
// schedule.ts levelAt: the finest level whose boxes stay within their reads,
// never finer than the scale before.
int rtLevel(int it, int j) {
  int level = 0;
  for (int i = 0; i < 8; i++) {
    if (i > j) break;
    highp int r = rtMaxRadius(it, i);
    if (level == 0 && r <= ${FULL_RADIUS}) continue;
    level = max(level, 1);
    for (int k = 0; k < ${MAX_LEVEL}; k++) {
      highp int limit = ${COARSE_LIMIT} << (2 * level);
      if (level >= ${MAX_LEVEL} || r * (r + 1) < limit) break;
      level++;
    }
  }
  return level;
}
// The reduction the step's sub-slot makes into chain position j: from, to (or -1).
ivec2 rtReduction(int it, int j, int sub) {
  int to = rtLevel(it, j);
  int from = j == 0 ? 0 : rtLevel(it, j - 1);
  for (int r = 0; r < ${RED_SLOTS}; r++) {
    if (to - from < 1) break;
    int next = to - from >= 2 ? from + 2 : to;
    if (r == sub) return ivec2(from, next);
    from = next;
  }
  return ivec2(-1);
}
// Rows [from, to) of a linear range, or (0, 0).
ivec2 rtRows(highp int from, highp int to) {
  if (to <= from) return ivec2(0);
  highp int w = rtSize().x;
  return ivec2(from / w, (to - 1) / w + 1);
}
const ivec2 RT_WHOLE = ivec2(-1, -1);
ivec2 rtStatsRows(highp int gw, highp int gh, int l, highp int last) {
  int depth = rtStatsDepth(gw, gh);
  if (l >= depth) return ivec2(0);
  if (l == depth - 1) return rtRows(0, last);
  return rtRows(rtTreeBase(gw, gh, l, 0), rtTreeBase(gw, gh, l, 4));
}
// The rows a step writes: (0, 0) none, RT_WHOLE the frame.
ivec2 rtWrites(RtStep st) {
  highp ivec2 s = rtSize();
  int k = st.kind;
  if (k == ${STEP.idle}) return ivec2(0);
  if (k == ${STEP.flag}) return rtRows(${FLAG_TEXEL}, ${FLAG_TEXEL + 1});
  if (k == ${STEP.start} || k == ${STEP.accumulate} || k == ${STEP.transmission} || k == ${STEP.median} || k == ${STEP.final}) return RT_WHOLE;
  if (k == ${STEP.reduce}) {
    ivec2 r = rtReduction(st.it, st.j, st.sub);
    if (r.y < 0) return ivec2(0);
    highp int base = rtTileBase(r.y);
    return rtRows(base, base + rtTileSize(r.y));
  }
  if (k == ${STEP.box}) {
    if (rtBoxRadius(rtIncrement(st.it, st.j), st.sub >> 1) < 0) return ivec2(0);
    int level = rtLevel(st.it, st.j);
    if (level == 0) return RT_WHOLE;
    highp int base = rtTileBase(level) + ((st.sub & 1) == 1 ? 0 : rtTileSize(level));
    return rtRows(base, base + rtTileSize(level));
  }
  if (k == ${STEP.shmap1} || k == ${STEP.shmap2}) return rtLevel(st.it, st.j) == 0 ? RT_WHOLE : ivec2(0);
  if (k == ${STEP.maskStats}) {
    int level = rtLevel(st.it, st.j);
    return rtStatsRows(rtCells(s.x, level), rtCells(s.y, level), st.sub, ${MASK_STATS});
  }
  return rtStatsRows(s.x, s.y, st.sub, ${LO_START});
}
`;

/** The region program: this draw's writes and the previous draw's. */
const REGION_HELPERS = `
ivec4 rtRegion() {
  highp ivec2 s = rtSize();
  if (uPassIndex == 0) return ivec4(0, 0, s);
  ivec2 now = rtWrites(rtStepAt(uPassIndex));
  ivec2 before = rtWrites(rtStepAt(uPassIndex - 1));
  if (now == RT_WHOLE || before == RT_WHOLE) return ivec4(0, 0, s);
  bool hasNow = now.y > now.x;
  bool hasBefore = before.y > before.x;
  if (!hasNow && !hasBefore) return ivec4(0);
  ivec2 rows = !hasNow ? before : !hasBefore ? now : ivec2(min(now.x, before.x), max(now.y, before.y));
  return ivec4(0, rows.x, s.x, rows.y);
}
`;

// ── colour (rawimagesource.cc 1937-2183, 2402-2577; color.cc/.h) ─────────────

const COLOUR = `
float rtUnbase(float y) {
  if (y >= 1.0) return y;
  if (y <= 0.0) return y * ${lit(BG / BC)};
  float c = y * y;
  float a = ${lit(BA)} - y * ${lit(BD)};
  float b = ${lit(BB)} - y * ${lit(BE)};
  float k = ${lit(BC)} - y * ${lit(BF)};
  for (int i = 0; i < 6; i++) {
    float p = ((a * c + b) * c + k) * c - y * ${lit(BG)};
    float dp = (3.0 * a * c + 2.0 * b) * c + k;
    c = clamp(c - p / dp, 0.0, 1.0);
  }
  return c;
}
vec3 rtLinear(vec3 lin) {
  return uApplyBaseCurve ? vec3(rtUnbase(lin.r), rtUnbase(lin.g), rtUnbase(lin.b)) : lin;
}
// gammareti (form 0) / igammareti (form 1), color.h 1284-1291, on 0..1.
float rtGammaFn(float x, vec4 g0, vec4 g1) {
  if (g0.x < 0.5) return x <= g0.z ? x * g0.w : exp(log(x) / g0.y) * g1.x - g1.y;
  return x <= g0.z * g0.w ? x / g0.w : exp(log((x + g1.y) / g1.x) * g0.y);
}
// A gamma table looked up as LUTf does: free tables clip their entries and
// their index, fixed ones extrapolate the end segments.
float rtGammaLut(float v, vec4 g0, vec4 g1) {
  bool clip = g1.z > 0.5;
  if (clip) {
    if (v < 0.0) return clamp(65535.0 * rtGammaFn(0.0, g0, g1), 0.0, 65535.0);
    if (v > 65534.0) return clamp(65535.0 * rtGammaFn(1.0, g0, g1), 0.0, 65535.0);
    return clamp(65535.0 * rtGammaFn(v / 65535.0, g0, g1), 0.0, 65535.0);
  }
  if (v > 65534.0) {
    float a = 65535.0 * rtGammaFn(${lit(65534 / 65535)}, g0, g1);
    float b = 65535.0 * rtGammaFn(1.0, g0, g1);
    return a + (b - a) * (v - 65534.0);
  }
  return 65535.0 * rtGammaFn(v / 65535.0, g0, g1);
}
vec3 rtApplyGammaIn(vec3 rgb) {
  if (rtConv[0].z < 0.5) return rgb;
  return vec3(rtGammaLut(rgb.r, rtGammaIn[0], rtGammaIn[1]), rtGammaLut(rgb.g, rtGammaIn[0], rtGammaIn[1]), rtGammaLut(rgb.b, rtGammaIn[0], rtGammaIn[1]));
}
float rtCbrt(float v) {
  float r = exp2(log2(v) / 3.0);
  return r - (r * r * r - v) / (3.0 * r * r);
}
// Color::computeXYZ2Lab / computeXYZ2LabY (color.cc 1715-1724, color.h 177-186).
float rtLabF(float v) {
  if (v <= ${lit(EPS_MAX)}) return 327.68 * ((${lit(KAPPA)} * v / 65535.0 + 16.0) / 116.0);
  return 327.68 * rtCbrt(v / 65535.0);
}
float rtLabY(float v) {
  if (v <= ${lit(EPS_MAX)}) return 327.68 * (${lit(KAPPA)} * v / 65535.0);
  return 327.68 * (116.0 * rtCbrt(v / 65535.0) - 16.0);
}
float rtAtan2(float y, float x) { return x == 0.0 && y == 0.0 ? 0.0 : atan(y, x); }
// The pixel as retinexPrepareBuffers holds it: L (RawTherapee units, before
// L=f(L)), then a, b (Lab) or h, s (HSL), and the hue buffer.
struct RtPixel {
  float L;
  float c0;
  float c1;
  float hue;
};
RtPixel rtAnalyse(vec3 rgb) {
  int space = int(rtConv[0].x + 0.5);
  if (space == 0) {
    vec3 xyz = ${mat3(XYZ_FROM_709)} * rgb;
    float fx = rtLabF(xyz.x / 0.9642);
    float fy = rtLabF(xyz.y);
    float fz = rtLabF(xyz.z / 0.8249);
    float a = 500.0 * (fx - fy);
    float b = 200.0 * (fy - fz);
    return RtPixel(rtLabY(xyz.y), a, b, rtAtan2(b, a));
  }
  float mx = max(rgb.r, max(rgb.g, rgb.b));
  float mn = min(rgb.r, min(rgb.g, rgb.b));
  float C = mx - mn;
  float sum = mx + mn;
  float l = sum * 7.6295109e-6;
  float h = 0.0;
  float s = 0.0;
  if (C >= 0.65535) {
    s = l <= 0.5 ? (sum != 0.0 ? C / sum : 0.0) : (sum >= 131070.0 ? 0.0 : C / (131070.0 - sum));
    if (rgb.r == mx) h = rgb.g - rgb.b;
    else if (rgb.g == mx) h = 2.0 * C + rgb.b - rgb.r;
    else h = 4.0 * C + rgb.r - rgb.g;
    h /= 6.0 * C;
    if (h < 0.0) h += 1.0;
  }
  return RtPixel(l * 32768.0, h, s, h);
}
RtPixel rtPixelAt(ivec2 texel) {
  return rtAnalyse(rtApplyGammaIn(65535.0 * rtLinear(fetchInput(texel))));
}
`;

/** A curve table read with Catmull-Rom between its samples: one accessor per uniform. */
const sampleReader = (name: string, key: string, count: number): string => `
float ${name}(int i) {
  int k = clamp(i, 0, ${count - 1});
  return dot(${key}[k >> 2], rtOneHot(k & 3));
}`;

const catmull = (name: string, reader: string, count: number, periodic: boolean): string => `
float ${name}(float u) {
  float x = ${periodic ? `fract(u) * ${lit(count)}` : `clamp(u, 0.0, 1.0) * ${lit(count - 1)}`};
  float i0 = floor(x);
  float t = x - i0;
  int i = int(i0);
  ${
    periodic
      ? `float p0 = ${reader}(i - 1 < 0 ? i - 1 + ${count} : i - 1);
  float p1 = ${reader}(i);
  float p2 = ${reader}(i + 1 >= ${count} ? i + 1 - ${count} : i + 1);
  float p3 = ${reader}(i + 2 >= ${count} ? i + 2 - ${count} : i + 2);`
      : `float p0 = ${reader}(max(i - 1, 0));
  float p1 = ${reader}(i);
  float p2 = ${reader}(min(i + 1, ${count - 1}));
  float p3 = ${reader}(min(i + 2, ${count - 1}));`
  }
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}`;

/** A 65536-entry diagonal table (LUT flags 0) at index x, RawTherapee units. */
const diagonal = (name: string, sampler: string, ends: string): string => `
float ${name}(float x) {
  if (x < 0.0) return 65535.0 * (${ends}.x + ${ends}.y * x);
  if (x > 65534.0) return 65535.0 * (${ends}.z + ${ends}.w * (x - 65534.0));
  return 65535.0 * ${sampler}(x / 65535.0);
}`;

/** A 501-entry flat table (LUT clip flags) at absc ∈ 0…500, as LUTf indexes it. */
const table501 = (name: string, a: string, b: string): string => `
float ${name}At(int i) {
  int k = clamp(i, 0, 503);
  return k < 252 ? dot(${a}[k >> 2], rtOneHot(k & 3)) : dot(${b}[(k - 252) >> 2], rtOneHot((k - 252) & 3));
}
float ${name}(float absc) {
  if (absc < 0.0) return ${name}At(0);
  if (absc > 499.0) return ${name}At(500);
  float i0 = floor(absc);
  int i = int(i0);
  float p1 = ${name}At(i);
  return p1 + (${name}At(i + 1) - p1) * (absc - i0);
}`;

const CURVES_P1 = `${sampleReader("rtCdAt", "rtCd", DIAGONAL_SAMPLES)}${catmull("rtCdSample", "rtCdAt", DIAGONAL_SAMPLES, false)}${diagonal("rtCdLut", "rtCdSample", "rtCdEnds")}
${sampleReader("rtMapAt", "rtMap", DIAGONAL_SAMPLES)}${catmull("rtMapSample", "rtMapAt", DIAGONAL_SAMPLES, false)}${diagonal("rtMapLut", "rtMapSample", "rtMapEnds")}
${table501("rtTrans", "rtTransA", "rtTransB")}
// The working lightness: L=f(L) as cdcurve[2L] / 2 (rawimagesource.cc:2320).
float rtWork(float L) { return rtConv[0].y > 0.5 ? 0.5 * rtCdLut(2.0 * L) : L; }
float rtSourceAt(ivec2 texel) { return (rtWork(rtPixelAt(texel).L) + 2.0) / 327.68; }
`;

const CURVES_P2 = `${table501("rtTrans", "rtTransA", "rtTransB")}
${table501("rtGain", "rtGainA", "rtGainB")}
${sampleReader("rtHueAt", "rtHue", HUE_SAMPLES)}${catmull("rtHueCurve", "rtHueAt", HUE_SAMPLES, true)}
`;

const CURVES_P3 = `${table501("rtGain", "rtGainA", "rtGainB")}
${sampleReader("rtHueAt", "rtHue", HUE_SAMPLES)}${catmull("rtHueCurve", "rtHueAt", HUE_SAMPLES, true)}
`;

// ── the statistics trees ─────────────────────────────────────────────────────

/** A bank's statistics q (0-3 stats₁ mean, std, min, max; 4-7 stats₂), the
 *  tag, and the log map read whole. */
const BANK = `
// Bank texel 2q holds statistic q's high half, 2q + 1 its low half; texel 16
// the iteration that wrote the bank.
float rtBank(int it, int q) {
  highp int base = (it & 1) * ${BANK_TEXELS} + 2 * q;
  return rtFetch(base).a + rtFetch(base + 1).a;
}
float rtBankTag(int it) { return rtFetch((it & 1) * ${BANK_TEXELS} + 16).a; }
// The log map: R holds its high half, A its low half (none on the bank texels).
float rtMapOf(vec4 v, highp int n) { return v.r + (n < ${LO_START} ? 0.0 : v.a); }
// The transmission and gain curves' abscissa (ipretinex.cc 561-593, 677-715).
float rtAbsciss(float l, float mean, float std, float mn, float mx) {
  if (abs(l - mean) < std) {
    float a = 0.166666 / std;
    return 500.0 * a * l + 500.0 * (0.5 - a * mean);
  }
  if (l >= mean) {
    float a = 0.333333 / (mx - mean - std);
    return 500.0 * a * l + 500.0 * (1.0 - a * mx);
  }
  float a = 0.333333 / (mean - std - mn);
  return 500.0 * a * l - 500.0 * a * mn;
}
// Color::huelab_to_huehsv2 (color.h:1914-1947).
float rtHueOf(float HH) {
  float hr = 0.0;
  if (HH >= 0.0 && HH < 0.6) hr = 0.11666 * HH + 0.93;
  else if (HH >= 0.6 && HH < 1.4) hr = 0.1125 * HH - 0.0675;
  else if (HH >= 1.4 && HH < 2.0) hr = 0.2666 * HH - 0.2833;
  else if (HH >= 2.0 && HH < 3.14159) hr = 0.1489 * HH - 0.04785;
  else if (HH >= -3.14159 && HH < -2.8) hr = 0.23419 * HH + 1.1557;
  else if (HH >= -2.8 && HH < -2.3) hr = 0.16 * HH + 0.948;
  else if (HH >= -2.3 && HH < -0.9) hr = 0.12143 * HH + 0.85928;
  else if (HH >= -0.9 && HH < -0.1) hr = 0.2125 * HH + 0.94125;
  else if (HH >= -0.1 && HH < 0.0) hr = 0.1 * HH + 0.93;
  if (hr < 0.0) hr += 1.0;
  else if (hr > 1.0) hr -= 1.0;
  return hr;
}
`;

/** One level of a statistics reduction over a source grid (gw × gh) whose
 *  cells hold `cell` pixels of the frame along each axis; channel `ch` of the
 *  trees (2 = B, 1 = G); level 0 reads the source. `plane` sources (cell 1)
 *  are frame texels; tile sources are linear from `tile`. */
const STATS = `
float rtChannel(vec4 v, int ch) { return dot(v, rtOneHot(ch)); }
// Pixel count of node or cell i along an axis of n pixels, blocks of b pixels.
float rtCount(highp int n, highp int b, highp int i) { return float(clamp(n - b * i, 0, b)); }
float rtSourceValue(highp int x, highp int y, highp int gw, int srcCh, bool plane, highp int tile, bool fill) {
  highp int n = plane ? y * rtSize().x + x : tile + y * gw + x;
  vec4 v = rtFetch(n);
  float s = srcCh == 4 ? rtMapOf(v, n) : rtChannel(v, srcCh);
  return fill ? max(s, 0.0) : s;
}
// A node at level 0 from up to 4 × 4 source cells, in one pass (Welford,
// count-weighted): tree 0 mean, 1 variance, 2 min, 3 max.
float rtReduceSource(int tree, highp int nx, highp int ny, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, bool fill) {
  highp ivec2 s = rtSize();
  float total = 0.0;
  float mean = 0.0;
  float m2 = 0.0;
  float mn = 3.0e38;
  float mx = -3.0e38;
  for (int i = 0; i < 16; i++) {
    highp int x = nx * 4 + (i & 3);
    highp int y = ny * 4 + (i >> 2);
    if (x >= gw || y >= gh) continue;
    float w = rtCount(s.x, 1 << cellLevel, x) * rtCount(s.y, 1 << cellLevel, y);
    float v = rtSourceValue(x, y, gw, srcCh, plane, tile, fill);
    float sum = total + w;
    float d = v - mean;
    mean += d * w / sum;
    m2 += w * d * (v - mean);
    total = sum;
    mn = min(mn, v);
    mx = max(mx, v);
  }
  if (tree == 0) return mean;
  if (tree == 1) return m2 / total;
  return tree == 2 ? mn : mx;
}
// A node at level l ≥ 1 from up to 4 × 4 children of level l − 1 (Chan's
// merge of their means and variances, count-weighted). The children are
// channel ch plus, unless loCh is −1, their low halves in channel loCh.
float rtNodeValue(vec4 v, int ch, int loCh) { return rtChannel(v, ch) + (loCh < 0 ? 0.0 : rtChannel(v, loCh)); }
float rtReduceChildren(int l, int tree, highp int nx, highp int ny, highp int gw, highp int gh, int cellLevel, int ch, int loCh) {
  highp ivec2 s = rtSize();
  highp int cw = rtGridDiv(gw, l - 1);
  highp int chh = rtGridDiv(gh, l - 1);
  highp int block = (1 << (2 * l)) << cellLevel;
  highp int meanBase = rtTreeBase(gw, gh, l - 1, 0);
  highp int ownBase = rtTreeBase(gw, gh, l - 1, tree);
  float total = 0.0;
  float mean = 0.0;
  float m2 = 0.0;
  float mn = 3.0e38;
  float mx = -3.0e38;
  for (int i = 0; i < 16; i++) {
    highp int x = nx * 4 + (i & 3);
    highp int y = ny * 4 + (i >> 2);
    if (x >= cw || y >= chh) continue;
    float own = rtNodeValue(rtFetch(ownBase + y * cw + x), ch, loCh);
    if (tree >= 2) {
      mn = min(mn, own);
      mx = max(mx, own);
      continue;
    }
    float w = rtCount(s.x, block, x) * rtCount(s.y, block, y);
    float m = tree == 0 ? own : rtNodeValue(rtFetch(meanBase + y * cw + x), ch, loCh);
    float sum = total + w;
    float d = m - mean;
    mean += d * w / sum;
    m2 += w * own + w * d * (m - mean);
    total = sum;
  }
  if (tree == 0) return mean;
  if (tree == 1) return m2 / total;
  return tree == 2 ? mn : mx;
}
float rtReduceNode(int l, int tree, highp int nx, highp int ny, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, int ch, int loCh, bool fill) {
  if (l == 0) return rtReduceSource(tree, nx, ny, gw, gh, cellLevel, srcCh, plane, tile, fill);
  return rtReduceChildren(l, tree, nx, ny, gw, gh, cellLevel, ch, loCh);
}
// A level below the last at texel self: its node as a high half and, with a
// low channel, the low half (else old.y), or old where the level has no node.
vec2 rtStatsNode(vec2 old, highp int self, int l, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, int ch, int loCh, bool fill) {
  highp int base = rtTreeBase(gw, gh, l, 0);
  highp int size = rtGridDiv(gw, l) * rtGridDiv(gh, l);
  if (self < base || self >= base + 4 * size) return old;
  int tree = int((self - base) / size);
  highp int node = self - base - tree * size;
  highp int nw = rtGridDiv(gw, l);
  highp int ny = node / nw;
  float v = rtReduceNode(l, tree, node - ny * nw, ny, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill);
  float hi = rtHalf(v);
  return vec2(hi, loCh < 0 ? old.y : rtHalf(v - hi));
}
// The texel's value after a statistics level (self is its linear index), or
// the old value when the level doesn't write it. At the last level the node
// is the whole grid: statistics [first, first + count) go to the bank as
// hi/lo pairs, with the tag (the iteration that wrote it) at bank texel 16; the mask's
// max_f, min_f and avg go to texels 0-2.
float rtStatsLevel(float old, highp int self, int l, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, int ch, int loCh, bool fill, int bank, int lastFirst, int lastCount, bool lastIsMask, int tag) {
  int depth = rtStatsDepth(gw, gh);
  if (l >= depth) return old;
  if (l == depth - 1) {
    highp int q = self - bank;
    if (lastIsMask) {
      // max_f, min_f, avg (shmap.cc: min_f starts at 65535, max_f at 0).
      if (q < 0 || q > 2) return old;
      if (q == 0) return rtHalf(max(rtReduceNode(l, 3, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill), 0.0));
      if (q == 1) return rtHalf(min(rtReduceNode(l, 2, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill), ${lit(65535 / 327.68)}));
      return rtHalf(rtReduceNode(l, 0, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill));
    }
    if (q == 16) return float(tag);
    if (q < 2 * lastFirst || q >= 2 * (lastFirst + lastCount)) return old;
    int k = int(q) / 2 - lastFirst;
    int tree = k & 3;
    float v = rtReduceNode(l, tree == 1 ? 1 : tree, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill);
    if (tree == 1) v = sqrt(max(v, 0.0));
    float hi = rtHalf(v);
    return (q & 1) == 0 ? hi : rtHalf(v - hi);
  }
  return rtStatsNode(vec2(old, 0.0), self, l, gw, gh, cellLevel, srcCh, plane, tile, ch, -1, fill).x;
}
`;

// ── the output lightness (ipretinex.cc 632-767), P2 and P3 ───────────────────

/** RawTherapee view index from the panel's (standard, unsharp, mask, auto, fixed). */
const OUTPUT = `
int rtViewMet(bool finalIt) {
  if (!finalIt) return 0;
  int v = int(view);
  return v == 1 ? 4 : v == 2 ? 1 : v == 3 ? 2 : v == 4 ? 3 : 0;
}
float rtProtection(float L0) {
  if (rtProtect.w < 0.5) return 1.0;
  float t = clamp((L0 - rtProtect.x) / rtProtect.y, 0.0, 1.0);
  return 1.0 - rtProtect.z * t * t * (3.0 - 2.0 * t);
}
// Iteration it's output lightness (RawTherapee units) from its map lum, the
// original lightness orig (units) and hue, and the copy the views keep in G.
float rtOutput(int it, float lum, float orig, float hue, int space, float copy) {
  bool finalIt = it == rtIterCount();
  int viewmet = rtViewMet(finalIt);
  float mean = rtBank(it, 4);
  float std = rtBank(it, 5);
  float mn = rtBank(it, 6);
  float mx = rtBank(it, 7);
  float varx = rtVarx(it);
  float mini = mean - varx * std;
  if (mini < mn) mini = mn + 0.1;
  float maxi = mean + varx * std;
  if (maxi > mx) maxi = mx - 0.1;
  float delta = maxi - mini;
  if (delta == 0.0) delta = 1.0;
  float aza = std != 0.0 ? 16300.0 / (2.0 * std) : 0.0;
  float azb = -aza * (mean - 2.0 * std);
  float bzb = 16300.0 - aza * mean;
  float m3 = mean - mini;
  float n3 = mn - mini;
  float x3 = mx - mini;
  float l = lum - mini;
  float gan = 0.5;
  if (rtFlags[0].z > 0.5 && m3 != 0.0 && std != 0.0) gan = 2.0 * rtGain(rtAbsciss(l, m3, std, n3, x3));
  float cd = gan * (32768.0 / delta) * l + rtFlags[1].z;
  float str = rtStrengthx(it);
  if (it == 1 && rtFlags[0].w > 0.5) {
    float h = space == 0 ? rtHueOf(hue) : hue;
    str *= 1.0 + 2.0 * (rtHueCurve(h) - 0.5);
  }
  str *= rtProtection(orig / 327.68);
  if (viewmet == 0) return str * (clamp(cd, 0.0, max(32768.0, orig)) - orig) + orig;
  if (viewmet == 1) return copy * 327.68;
  if (viewmet == 4) return orig + str * (orig - copy * 327.68);
  bool tranIsCopy = !rtHasTrans() || (it == 1 && rtFlags[2].x > 0.5);
  float tran = tranIsCopy ? (rtHasTrans() ? copy : copy * 327.68) : lum;
  if (viewmet == 2) return tran <= m3 ? azb + aza * tran : bzb + aza * tran;
  return 1000.0 + tran * 700.0;
}
`;

// ── the steps that make and blur the chain (P1, P2) ──────────────────────────

const CHAIN = `
// A blur value: B, plus its low half in G where the pass keeps one.
float rtBlurOf(vec4 v) { return v.b + (rtLo() ? v.g : 0.0); }
// A blur value to store in B and G (G kept as it was without a low half).
vec2 rtBlurPair(float v, float oldLo) {
  float hi = rtHalf(v);
  return vec2(hi, rtLo() ? rtHalf(v - hi) : oldLo);
}
// The source of the current iteration at a texel, L* units with eps: P1
// converts the input, later iterations read G.
float rtSrc(int it, ivec2 texel) {
  __SRC__
}
float rtCellCount(int axis, int level, highp int c) {
  highp ivec2 s = rtSize();
  return rtCount(axis == 0 ? s.x : s.y, 1 << level, c);
}
// A reduction draw at texel self: the from-level cells under the cell, count-weighted.
vec2 rtReduceTexel(vec2 old, highp int self, int from, int to) {
  highp ivec2 s = rtSize();
  highp int base = rtTileBase(to);
  highp int cw = rtCells(s.x, to);
  if (self < base || self >= base + rtTileSize(to)) return old;
  highp int cell = self - base;
  highp int cy = cell / cw;
  highp int cx = cell - cy * cw;
  int q = 1 << (to - from);
  highp int fw = rtCells(s.x, from);
  highp int fh = rtCells(s.y, from);
  highp int fbase = rtTileBase(from);
  float total = 0.0;
  float acc = 0.0;
  for (int i = 0; i < 16; i++) {
    int dx = i & 3;
    int dy = i >> 2;
    if (dx >= q || dy >= q) continue;
    highp int x = cx * q + dx;
    highp int y = cy * q + dy;
    if (x >= fw || y >= fh) continue;
    float w = rtCellCount(0, from, x) * rtCellCount(1, from, y);
    float v = rtBlurOf(rtFetch(from == 0 ? y * s.x + x : fbase + y * fw + x));
    total += w;
    acc += w * v;
  }
  return rtBlurPair(acc / total, old.y);
}
// A full-resolution box along an axis (boxblur.cc 505-745): the mean over the
// window inside the frame.
float rtBoxFull(ivec2 p, int axis, int r) {
  highp ivec2 s = rtSize();
  highp int n = axis == 0 ? s.x : s.y;
  highp int at = axis == 0 ? p.x : p.y;
  float acc = 0.0;
  float count = 0.0;
  for (int i = 0; i < 35; i++) {
    if (i > 2 * r) break;
    highp int q = at - r + i;
    if (q < 0 || q >= n) continue;
    acc += rtBlurOf(fetchPrev4(axis == 0 ? ivec2(q, p.y) : ivec2(p.x, q)));
    count += 1.0;
  }
  return acc / count;
}
// The coarse box of the decimated chain: variance-matched fractional weights,
// count-weighted, truncated at the frame.
vec2 rtBoxCoarse(vec2 old, highp int self, int level, int axis, int r, float prefilter) {
  highp ivec2 s = rtSize();
  highp int size = rtTileSize(level);
  highp int pBase = rtTileBase(level);
  highp int qBase = pBase + size;
  highp int dst = axis == 0 ? qBase : pBase;
  highp int src = axis == 0 ? pBase : qBase;
  if (self < dst || self >= dst + size) return old;
  highp int cw = rtCells(s.x, level);
  highp int chh = rtCells(s.y, level);
  highp int cell = self - dst;
  highp int cy = cell / cw;
  highp int cx = cell - cy * cw;
  float f = float(1 << level);
  vec2 mt = rtFractional(float(r) * float(r + 1) / 3.0 / (f * f) - prefilter);
  int m = int(mt.x);
  highp int n = axis == 0 ? cw : chh;
  highp int at = axis == 0 ? cx : cy;
  float acc = 0.0;
  float total = 0.0;
  for (int i = 0; i < ${COARSE_READS}; i++) {
    if (i > 2 * m + 2) break;
    int d = i - m - 1;
    highp int c = at + d;
    if (c < 0 || c >= n) continue;
    float w = (d == -m - 1 || d == m + 1 ? mt.y : 1.0) * rtCellCount(axis, level, c);
    highp int t = axis == 0 ? src + cy * cw + c : src + c * cw + cx;
    acc += w * rtBlurOf(rtFetch(t));
    total += w;
  }
  return rtBlurPair(acc / total, old.y);
}
float rtPrefilter(int it, int j, int box) {
  if (box != 0) return 0.0;
  int to = rtLevel(it, j);
  int from = j == 0 ? 0 : rtLevel(it, j - 1);
  return to > from ? (1.0 - pow(4.0, float(from - to))) / 12.0 : 0.0;
}
// schedule.ts readbackCell: the lower cell pixel x of an axis of n pixels
// reads between, and the upper one's weight, from the cells' true centres,
// past the outer ones along the edge cells' slope.
vec2 rtReadbackCell(highp int x, highp int n, int level) {
  highp int count = rtCells(n, level);
  if (count == 1) return vec2(0.0);
  highp int c0 = clamp(int(floor((float(x) + 0.5) / float(1 << level) - 0.5)), 0, count - 2);
  highp int c1 = c0 + 1;
  float a = float(c0 << level) + (float(min(1 << level, n - (c0 << level))) - 1.0) * 0.5;
  float b = float(c1 << level) + (float(min(1 << level, n - (c1 << level))) - 1.0) * 0.5;
  return vec2(float(c0), (float(x) - a) / (b - a));
}
// The blur of chain position j at pixel p, L* units: the B plane at full
// resolution, else the tile bilinearly.
float rtBlurAt(int it, int j, ivec2 p) {
  int level = rtLevel(it, j);
  if (level == 0) return rtBlurOf(fetchPrev4(p));
  highp ivec2 s = rtSize();
  highp int cw = rtCells(s.x, level);
  highp int chh = rtCells(s.y, level);
  highp int base = rtTileBase(level);
  vec2 cx = rtReadbackCell(p.x, s.x, level);
  vec2 cy = rtReadbackCell(p.y, s.y, level);
  ivec2 c0 = ivec2(int(cx.x), int(cy.x));
  ivec2 c1 = min(c0 + 1, ivec2(cw - 1, chh - 1));
  vec2 t = vec2(cx.y, cy.y);
  float v00 = rtBlurOf(rtFetch(base + c0.y * cw + c0.x));
  float v10 = rtBlurOf(rtFetch(base + c0.y * cw + c1.x));
  float v01 = rtBlurOf(rtFetch(base + c1.y * cw + c0.x));
  float v11 = rtBlurOf(rtFetch(base + c1.y * cw + c1.x));
  return mix(mix(v00, v10, t.x), mix(v01, v11, t.x), t.y);
}
`;

/** The mask (P1 only): SHMap's two dirpyr levels and the factor. */
const MASK = `
float rtRangeValue(int i, int size, float thresh2) {
  if (i >= size - 1) return 1e-15;
  float fi = float(i);
  return exp(-min(10.0, fi * fi / thresh2));
}
float rtRange(float d, bool truncated) {
  float thresh = 100.0 * rtMask[1].z;
  int size = int(float(int(thresh)) * ${lit(Math.fround(Math.sqrt(10)))} + 1.0);
  float thresh2 = thresh * thresh;
  if (truncated) return rtRangeValue(clamp(int(d), 0, size - 1), size, thresh2);
  if (d > float(size - 2)) return 1e-15;
  int i = int(d);
  float a = rtRangeValue(i, size, thresh2);
  return a + (rtRangeValue(i + 1, size, thresh2) - a) * (d - float(i));
}
// One dirpyr_shmap level (shmap.cc 338-450, level < 2) at p, stride s, from
// channel ch (fill: max(v, 0) first, for level 0).
float rtDirpyr(ivec2 p, int scale, int ch, bool fill) {
  highp ivec2 sz = rtSize();
  int q = max(0, (sz.x - 2 * scale - 3 + 3) / 4);
  bool truncated = p.x >= scale && p.x < scale + 4 * q;
  float centre = rtChannel(fetchPrev4(p), ch);
  if (fill) centre = max(centre, 0.0);
  int r0 = max(p.y - scale, p.y - (p.y / scale) * scale);
  int c0 = p.x < scale ? p.x - (p.x / scale) * scale : p.x - scale;
  float val = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 9; i++) {
    int y = r0 + (i / 3) * scale;
    int x = c0 + (i - (i / 3) * 3) * scale;
    if (y > min(p.y + scale, sz.y - 1) || x > min(p.x + scale, sz.x - 1)) continue;
    float v = rtChannel(fetchPrev4(ivec2(x, y)), ch);
    if (fill) v = max(v, 0.0);
    float w = rtRange(abs(v - centre) * 327.68, truncated);
    val += w * v;
    norm += w;
  }
  return val / norm;
}
// out after the map curve and the shadows/highlights factor, L* units.
float rtMasked(int it, int j, float out0, float map) {
  if (it != 1 || rtMapMet() == 0) return out0;
  float o = rtMask[0].y > 0.5 ? 0.5 * rtMapLut(2.0 * out0 * 327.68) / 327.68 : out0;
  if (!rtMaskAt(it, rtScales(it) - 1 - j)) return o;
  vec4 c = vec4(rtFetch(0).g, rtFetch(1).g, rtFetch(2).g, 0.0) * 327.68;
  float hTh = float(int(c.x - rtMask[0].w * (c.x - c.z) / 100.0));
  float sTh = float(int(rtMask[1].y * (c.z - c.y) / 100.0));
  float mapval = 1.0 + map * 327.68;
  float hW = (100.0 - rtMask[0].z) / 100.0;
  float sW = (100.0 - rtMask[1].x) / 100.0;
  float factor = 1.0;
  if (mapval > hTh) factor = (hTh + hW * (mapval - hTh)) / mapval;
  else if (mapval < sTh) factor = (sTh - sW * (sTh - mapval)) / mapval;
  return o * factor;
}
`;

const NO_MASK = `
float rtMasked(int it, int j, float out0, float map) { return out0; }
`;

const MEDIAN = `
float rtMapTexel(ivec2 t) { return rtMapOf(fetchPrev4(t), t.y * rtSize().x + t.x); }
// median.h's 9-value network.
float rtMedian9(float a0, float a1, float a2, float a3, float a4, float a5, float a6, float a7, float a8) {
  float t = min(a1, a2); a2 = max(a1, a2); a1 = t;
  t = min(a4, a5); a5 = max(a4, a5); a4 = t;
  t = min(a7, a8); a8 = max(a7, a8); a7 = t;
  t = min(a0, a1); a1 = max(a0, a1); a0 = t;
  t = min(a3, a4); a4 = max(a3, a4); a3 = t;
  t = min(a6, a7); a7 = max(a6, a7); a6 = t;
  t = min(a1, a2); a2 = max(a1, a2); a1 = t;
  t = min(a4, a5); a5 = max(a4, a5); a4 = t;
  t = min(a7, a8); a8 = max(a7, a8);
  a3 = max(a0, a3);
  a5 = min(a5, a8);
  a7 = max(a4, t);
  t = min(a4, t);
  a6 = max(a3, a6);
  a4 = max(a1, t);
  a2 = min(a2, a5);
  a4 = min(a4, a7);
  t = min(a4, a2);
  a2 = max(a4, a2);
  a4 = max(a6, t);
  return min(a4, a2);
}
`;

// ── the bodies ───────────────────────────────────────────────────────────────

/** The step bodies P1 and P2 share. `c` is the texel's own value. */
const CHAIN_BODY = `
  if (st.kind == ${STEP.reduce}) {
    ivec2 r = rtReduction(st.it, st.j, st.sub);
    if (r.y >= 0) c.bg = rtReduceTexel(c.bg, self, r.x, r.y);
  } else if (st.kind == ${STEP.box}) {
    int box = st.sub >> 1;
    int axis = st.sub & 1;
    int r = rtBoxRadius(rtIncrement(st.it, st.j), box);
    if (r >= 0) {
      int level = rtLevel(st.it, st.j);
      if (level == 0) c.bg = rtBlurPair(rtBoxFull(p, axis, r), c.g);
      else c.bg = rtBoxCoarse(c.bg, self, level, axis, r, rtPrefilter(st.it, st.j, box));
    }
  } else if (st.kind == ${STEP.accumulate}) {
    int level = rtLevel(st.it, st.j);
    float out0 = rtBlurAt(st.it, st.j, p);
    float map = level == 0 ? c.a : max(out0, 0.0);
    float used = rtMasked(st.it, st.j, out0, map);
    float src = rtSrc(st.it, p);
    float limit = rtLimit(st.it);
    float ilimit = rtLimitInv(st.it);
    float ratio = src / used;
    if (!(ratio > 0.0)) ratio = src > 0.0 && !(used > 0.0) ? limit : ilimit;
    ratio = clamp(ratio, ilimit, limit);
    bool shadowInA = level == 0 && rtMaskAt(st.it, rtScales(st.it) - 1 - st.j);
    float before = shadowInA ? c.r : rtMapOf(c, self);
    float now = before + rtPond(st.it) * (rtLogMode() ? log(ratio) : ratio);
    c.r = rtHalf(now);
    if (self >= ${LO_START}) c.a = rtHalf(now - c.r);
    int v = int(__VIEW__);
    bool last = st.j == rtScales(st.it) - 1 && st.it == rtIterCount();
    if (last && (v == 1 || v == 2 || ((v == 3 || v == 4) && !rtHasTrans()))) c.g = rtHalf(used);
  } else if (st.kind == ${STEP.stats1} || st.kind == ${STEP.stats2}) {
    bool second = st.kind == ${STEP.stats2};
    int bank = (st.it & 1) * ${BANK_TEXELS};
    highp int depth = rtStatsDepth(sz.x, sz.y);
    // The tree nodes' low halves go to G, unless G keeps the final iteration's copy.
    int lo = st.it == rtIterCount() && int(__VIEW__) != 0 ? -1 : 1;
    if (st.sub == depth - 1) {
      int first = second ? 4 : 0;
      int count = second || rtHasTrans() ? 4 : 8;
      c.a = rtStatsLevel(c.a, self, st.sub, sz.x, sz.y, 0, 4, true, 0, 2, lo, false, bank, first, count, false, second || !rtHasTrans() ? st.it : -1);
    } else {
      vec2 node = rtStatsNode(vec2(c.b, c.g), self, st.sub, sz.x, sz.y, 0, 4, true, 0, 2, lo, false);
      c.b = node.x;
      c.g = node.y;
    }
  } else if (st.kind == ${STEP.transmission}) {
    float mean = rtBank(st.it, 0);
    float std = rtBank(st.it, 1);
    if (rtHasTrans() && mean != 0.0 && std != 0.0) {
      float m = rtMapOf(c, self);
      float t = m * (-1.0 + 4.0 * rtTrans(rtAbsciss(m, mean, std, rtBank(st.it, 2), rtBank(st.it, 3))));
      c.r = rtHalf(t);
      if (self >= ${LO_START}) c.a = rtHalf(t - c.r);
      int v = int(__VIEW__);
      if (rtMedianAt(st.it) && st.it == rtIterCount() && (v == 3 || v == 4)) c.g = rtHalf(t);
    }
  }`;

const START_P1 = `
  if (st.kind == ${STEP.start}) {
    vec2 src = rtBlurPair(rtSourceAt(p), 0.0);
    c = vec4(0.0, src.y, src.x, 0.0);
  } else if (st.kind == ${STEP.shmap1}) {
    if (rtLevel(st.it, st.j) == 0) c.a = rtHalf(rtDirpyr(p, 1, 2, true));
  } else if (st.kind == ${STEP.shmap2}) {
    if (rtLevel(st.it, st.j) == 0) c.a = rtHalf(rtDirpyr(p, 2, 3, false));
  } else if (st.kind == ${STEP.maskStats}) {
    int level = rtLevel(st.it, st.j);
    highp int gw = rtCells(sz.x, level);
    highp int gh = rtCells(sz.y, level);
    bool plane = level == 0;
    c.g = rtStatsLevel(c.g, self, st.sub, gw, gh, level, plane ? 3 : 2, plane, rtTileBase(level), 1, -1, true, 0, 0, 3, true, -1);
  } else if (st.kind == ${STEP.median}) {
    float mean = rtBank(st.it, 0);
    float std = rtBank(st.it, 1);
    if (rtHasTrans() && mean != 0.0 && std != 0.0 && p.x >= 1 && p.y >= 1 && p.x < sz.x - 1 && p.y < sz.y - 1) {
      float m = rtMedian9(rtMapOf(c, self), rtMapTexel(p + ivec2(0, -1)), rtMapTexel(p + ivec2(0, 1)), rtMapTexel(p + ivec2(1, 0)),
        rtMapTexel(p + ivec2(-1, 0)), rtMapTexel(p + ivec2(-1, -1)), rtMapTexel(p + ivec2(1, -1)),
        rtMapTexel(p + ivec2(-1, 1)), rtMapTexel(p + ivec2(1, 1)));
      c.r = rtHalf(m);
      if (self >= ${LO_START}) c.a = rtHalf(m - c.r);
    }
  }`;

const START_P2 = `
  if (st.kind == ${STEP.start}) {
    RtPixel px = rtPixelAt(p);
    int space = int(rtConv[0].x + 0.5);
    float src = rtHalf((rtOutput(st.it - 1, rtMapOf(c, self), px.L, px.hue, space, c.g) + 2.0) / 327.68);
    float a = self < ${LO_START} ? c.a : 0.0;
    if (self == ${FLAG_TEXEL} && rtBankTag(st.it - 1) != float(st.it - 1)) a = ${lit(FLAG_VALUE)};
    c = vec4(0.0, src, src, a);
  }`;

const FLAG_BODY = `
  if (st.kind == ${STEP.flag}) {
    if (self == ${FLAG_TEXEL}) c.a = ${lit(FLAG_VALUE)};
  }`;

/** P3: everything from the input to the change Δ, with the sentinel in alpha. */
const FINAL = `
float rtF2xyz(float v) { return v > ${lit(6 / 29)} ? v * v * v : (116.0 * v - 16.0) / ${lit(KAPPA)}; }
// Color::gamutLchonly (color.cc 2916-3008), highlight flag on: tested in Rec.2020.
vec2 rtGamut(float HH, vec2 sincos, float L, float C) {
  for (int i = 0; i < 512; i++) {
    float a = C * sincos.y;
    float b = C * sincos.x;
    float fy = L / 116.0 + 16.0 / 116.0;
    float fx = 0.002 * a + fy;
    float fz = fy - 0.005 * b;
    float x = 65535.0 * rtF2xyz(fx) * 0.9642;
    float z = 65535.0 * rtF2xyz(fz) * 0.8249;
    float y = L > 8.0 ? 65535.0 * fy * fy * fy : 65535.0 * L / ${lit(KAPPA)};
    vec3 rgb = ${mat3(REC2020_FROM_XYZ)} * vec3(x, y, z);
    if (!(rgb.r < 0.0 || rgb.g < 0.0 || rgb.b < 0.0)) break;
    if (L < 0.1) L = 0.1;
    if (HH < -0.9 && HH > -1.55) {
      if (C > 160.0 && L < 5.0) L = 5.0;
      if (C > 140.0 && L < 3.5) L = 3.5;
      if (C > 120.0 && L < 2.0) L = 2.0;
      if (C > 105.0 && L < 1.0) L = 1.0;
      if (C > 90.0 && L < 0.7) L = 0.7;
      if (C > 50.0 && L < 0.5) L = 0.5;
      if (C > 20.0 && L < 0.4) L = 0.4;
    }
    C *= 0.96;
    if (C <= 3.0) L += 0.15;
  }
  return vec2(L, C);
}
float rtHue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 6.0;
  else if (t > 6.0) t -= 6.0;
  if (t < 1.0) return p + (q - p) * t;
  if (t < 3.0) return q;
  if (t < 4.0) return p + (q - p) * (4.0 - t);
  return p;
}
vec3 rtGammaOutRgb(vec3 rgb) {
  if (rtConv[0].z < 0.5) return rgb;
  return vec3(rtGammaLut(rgb.r, rtGammaOut[0], rtGammaOut[1]), rtGammaLut(rgb.g, rtGammaOut[0], rtGammaOut[1]), rtGammaLut(rgb.b, rtGammaOut[0], rtGammaOut[1]));
}
vec4 rtFinal(ivec2 p, vec4 c) {
  int iters = rtIterCount();
  if (!rtMarked() || iters < 1 || iters > 5 || rtFetch(${FLAG_TEXEL}).a == ${lit(FLAG_VALUE)} || !rtFits()) return vec4(0.0);
  if (rtBankTag(iters) != float(iters)) return vec4(0.0);
  vec3 x = rtLinear(fetchInput(p));
  RtPixel px = rtAnalyse(rtApplyGammaIn(65535.0 * x));
  int space = int(rtConv[0].x + 0.5);
  float Lout = rtOutput(iters, rtMapOf(c, p.y * rtSize().x + p.x), px.L, px.hue, space, c.g);
  vec3 rgb;
  if (space == 0) {
    float chroma = sqrt(px.c0 * px.c0 + px.c1 * px.c1);
    float C = chroma / 327.68;
    vec2 sincos = chroma == 0.0 ? vec2(0.0, 1.0) : vec2(px.c1 / chroma, px.c0 / chroma);
    if (rtFlags[1].w > 0.5) C *= 1.0 + 2.0 * (rtHueCurve(rtHueOf(px.hue)) - 0.5);
    vec2 lc = rtGamut(px.hue, sincos, Lout / 327.68, C);
    float L = lc.x;
    float a = 327.68 * lc.y * sincos.y / 327.68;
    float b = 327.68 * lc.y * sincos.x / 327.68;
    float fy = L / 116.0 + 16.0 / 116.0;
    float fx = 0.002 * a + fy;
    float fz = fy - 0.005 * b;
    vec3 xyz = vec3(65535.0 * rtF2xyz(fx) * 0.9642, L > 8.0 ? 65535.0 * fy * fy * fy : 65535.0 * L / ${lit(KAPPA)}, 65535.0 * rtF2xyz(fz) * 0.8249);
    rgb = ${mat3(invert(XYZ_FROM_709))} * xyz;
  } else {
    float h = px.c0;
    float s = px.c1;
    if (rtFlags[1].w > 0.5) s *= 1.0 + 2.0 * (rtHueCurve(h) - 0.5);
    float l = Lout / 32768.0;
    if (s == 0.0) rgb = vec3(65535.0 * l);
    else {
      float m2 = l <= 0.5 ? l * (1.0 + s) : l + s - l * s;
      float m1 = 2.0 * l - m2;
      rgb = 65535.0 * vec3(rtHue2rgb(m1, m2, h * 6.0 + 2.0), rtHue2rgb(m1, m2, h * 6.0), rtHue2rgb(m1, m2, h * 6.0 - 2.0));
    }
  }
  vec3 d = rtGammaOutRgb(rgb) / 65535.0 - x;
  if (any(isnan(d)) || any(isinf(d))) return vec4(0.0);
  return vec4(rtHalf(d.r), rtHalf(d.g), rtHalf(d.b), ${lit(RESULT_SENTINEL)});
}
`;

export interface PassProgram {
  helpers: string;
  glsl: string;
  region: string;
}

/** The helpers, body and region of pass `pass` (1 analysis, 2 later iterations, 3 final). */
export function passProgram(pass: PassId): PassProgram {
  if (pass === 3) {
    const helpers = `${COMMON}${PLAN[3]}${COLOUR}${CURVES_P3}${BANK}${STATS}${OUTPUT}${FINAL}`;
    return {
      helpers,
      glsl: `
  c = rtFinal(ivec2(gl_FragCoord.xy), c);
`,
      region: "return ivec4(0, 0, rtSize());",
    };
  }
  const src = pass === 1 ? "return rtSourceAt(texel);" : "return fetchPrev4(texel).g;";
  const helpers = [
    COMMON,
    PLAN[pass],
    SCHEDULE,
    REGION_HELPERS,
    COLOUR,
    pass === 1 ? CURVES_P1 : CURVES_P2,
    BANK,
    STATS,
    pass === 2 ? OUTPUT : "",
    CHAIN.replace("__SRC__", src),
    pass === 1 ? MASK : NO_MASK,
    pass === 1 ? MEDIAN : "",
  ].join("\n");
  const glsl = `
  highp ivec2 sz = rtSize();
  ivec2 p = ivec2(gl_FragCoord.xy);
  highp int self = p.y * sz.x + p.x;
  RtStep st = rtStepAt(uPassIndex);
  ${FLAG_BODY}${pass === 1 ? START_P1 : START_P2}${CHAIN_BODY.split("__VIEW__").join(pass === 1 ? VIEW_P1_KEY : VIEW_KEY)}
`;
  return { helpers, glsl, region: "return rtRegion();" };
}

// ── the inline (decode phase, main program) ──────────────────────────────────

/** The inline reads its own result sampler (`resultSampler`), so a stage that
 *  drew nothing this frame (no texture unit, a refused target) leaves lin as
 *  it was: only a result carrying the sentinel moves it. */
export function inlineGlsl(resultSampler: string): string {
  return `
{
  vec4 rtResult = textureLod(${resultSampler}, srcUv, 0.0);
  if (abs(rtResult.a - (${lit(RESULT_SENTINEL)})) < 0.5) {
    vec3 rtX = uApplyBaseCurve ? vec3(rtUnbaseInline(lin.r), rtUnbaseInline(lin.g), rtUnbaseInline(lin.b)) : lin;
    lin += uApplyBaseCurve ? baselineTone(rtX + rtResult.rgb) - baselineTone(rtX) : rtResult.rgb;
  }
}
`;
}

export const INLINE_HELPERS = `
float rtUnbaseInline(float y) {
  if (y >= 1.0) return y;
  if (y <= 0.0) return y * ${lit(BG / BC)};
  float c = y * y;
  float a = ${lit(BA)} - y * ${lit(BD)};
  float b = ${lit(BB)} - y * ${lit(BE)};
  float k = ${lit(BC)} - y * ${lit(BF)};
  for (int i = 0; i < 6; i++) {
    float p = ((a * c + b) * c + k) * c - y * ${lit(BG)};
    float dp = (3.0 * a * c + 2.0 * b) * c + k;
    c = clamp(c - p / dp, 0.0, 1.0);
  }
  return c;
}
`;
