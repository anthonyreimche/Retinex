# Retinex: specification

A port of RawTherapee 5.13's Retinex tool (commit `1924179`) to a Safelight
processing stage: multi-scale Retinex on the lightness of the photo, which
lifts haze and compresses dynamic range by dividing each pixel by blurred
copies of the image at several scales, then renormalizing the result from the
image's own statistics. GPL-3.0-or-later, as RawTherapee is.

Sources read (in the core checkout's
`.claude/cycle/ext-reference/upstream-rt/`):

| file | what it holds | copyright lines to carry |
|---|---|---|
| `rtengine/ipretinex.cc` | `retinex_scales`, `mean_stddv2`, `MSR` | (c) 2004-2010 Gabor Horvath; 2015 Jacques Desmis; 2015 Ingo Weyrich (adaptation) |
| `rtengine/rawimagesource.cc` | `retinexPrepareBuffers`, `retinexPrepareCurves`, `retinex` | (c) 2004-2010 Gabor Horvath |
| `rtengine/gauss.cc` | `gaussianBlur`, its iterated-box branch | (c) 2004-2010 Gabor Horvath |
| `rtengine/boxblur.cc` | `boxblur` | (C) 2010 Emil Martinec; (C) 2019 Ingo Weyrich |
| `rtengine/shmap.cc` | `SHMap::updateL`, `dirpyr_shmap` | (c) 2004-2010 Gabor Horvath |
| `rtengine/color.cc`, `color.h` | gamma tables, HSL, Lab, `gamutLchonly`, `huelab_to_huehsv2` | (c) 2004-2010 Gabor Horvath |
| `rtengine/curves.cc`, `flatcurves.cc`, `diagonalcurves.cc` | curve LUTs and the two curve kinds | (c) 2004-2010 Gabor Horvath |
| `rtengine/LUT.h` | LUT indexing, interpolation, clipping | (c) 2011 Jan Rinze Peterzon |
| `rtengine/median.h` | 9-value median | (c) 2004-2010 Gabor Horvath |
| `rtengine/iccmatrices.h` | working-space matrices | (c) 2004-2010 Gabor Horvath |
| `rtengine/procparams.cc` | defaults (674-748) | (c) 2004-2010 Gabor Horvath |
| `rtgui/tools/retinex.cc`, `rtdata/languages/default` | ranges, visibility, labels | (no line in the GUI file's header) |
| `rtengine/simpleprocess.cc` | where the CLI runs it (245-260) | |
| `rtengine/sleef.h` | `xlogf`, `xatan2f` | Naoki Shibata and contributors 2010-2021 |

Every `file:line` below refers to those files.

**Fidelity bar.** The same numbers as RawTherapee where the GPU's half-float
storage allows, with three stated exceptions: the decimated blur chain (§4.3,
measured at ≤ 0.02 L\* at the 99th percentile), the curves sampled into
uniforms (§3.4), and the deliberate deviations listed in §0, §1.12 and §2.

---

## 0. Decisions and deviations (revision 4)

Settled after the design review and Anthony's answers; the sections below
follow them.

- **Owner decisions.** (1) Process views apply at the final iteration only
  (deviation: RawTherapee applies them every iteration); P1 reads its own
  view value, `viewP1` (the view with one iteration, Standard otherwise), so
  P1 keeps only what the chosen view needs and a view change with more
  iterations leaves P1's kept result alone. (2) `cd` is clamped to
  `[0, max(32768, original L)]` instead of `[0, 32768]` (deviation), so Retinex
  never pulls a pixel below its own lightness above white and core's clipped
  highlight recovery still sees blown channels. (3) Runs on every photo, RAW
  or not; the README says it was designed for RAW data. (4) Curve UI: every
  kind; spline and flat first, parametric and control cage last, all in
  1.0.0.
- **Coordinator decisions.** `keepsDetail` off; gamut check against Rec.2020
  with the highlight flag on; statistics over every pass pixel, no fixed
  analysis grid (the preview/export difference is documented, §4.4); the DNG
  rig time-boxed, the g++ layer is the reference; no statistics labels.
- **Review fixes.** Result sentinel in alpha (FINAL writes `a = −1e4`; the
  inline reads its own result sampler with `textureLod` and applies Δ only
  when `|a + 1e4| < 0.5`). View values reach pass uniforms (core merges them over
  the bag; cleared on photo change; live-view captures see them). P1 holds raw
  statistics only, so Contrast never reruns it; iteration-1 constants are
  their own uniforms. Idle slot regions cover the previous draw's writes;
  every pass's first slot is drawn whole. Back to RGB through the inverse of
  the same `xyz_sRGB` matrix; Rec.2020 only for the gamut test. NaN/≤ 0
  guards before the ratio clamp. Uniforms only (passes can't sample stage
  textures), packed as vec4 arrays; transmission and gain curves pass
  RawTherapee's exact 501-entry LUTs; diagonal curves and Strength=f(H) 256
  samples. No uniform array passed to a helper; a scalar 9-value median
  network; `highp int` in region arithmetic. Iteration k ≥ 2 materializes its
  `src` with one full-frame draw; FINAL is a pass of its own (P3). One mean
  tree (no low part). `nei = trunc(fround(2.8)·neigh)` in float; SHMap's
  `min_f`/`max_f` start at 65535 and 0. Derived arrays are written only while
  Enabled.
- **Second review fixes (revision 3).** The log map is kept as a high half
  (R) and a low half (A), so it no longer loses bits every scale; the banks'
  statistics are high/low pairs too, with the iteration that wrote them as a
  tag (§4.2). Every pass checks a layout-version mark (1001) in each plan
  array it reads; P2 checks the previous iteration's tag and flags the frame
  when it's wrong, and FINAL draws only with 1 to 5 iterations and the last
  iteration's tag in place, so a P2 that didn't run leaves the frame alone. Δ
  is rounded like every other stored value, and FINAL hands back nothing for
  a NaN or infinite Δ; HSL saturation and the auto transmission view's scale
  are guarded against a zero sum and a zero deviation. The box count's `m`
  rounds with a 1e-5 tolerance (an integer σ puts `mIdeal` exactly on .5).
  The last statistics level's rows cover the banks on frames narrower than
  them. Out-of-range choice indices are rounded before they are checked, and
  a hand-made curve is normalized when read (nodes clamped, sorted, unique; an
  unknown type reads as the default).
- **Large radii on small frames (revision 4).** The decimated chain picks the
  finest level its boxes' reads allow (coarse boxes up to 67 reads) instead
  of 8 cells per σ, and reads tiles back between true cell centres and past
  the outer ones along the edge slope; the statistics trees, and iteration
  1's blurs without a mask, keep low halves in G. HSL linear at Radius 80 on a
  640 × 400 frame went from p99 1.37 L* to 0.014 (§4.3, §4.4, §5).

---

## 1. What the tool does

RawTherapee runs Retinex in `RawImageSource`, on the demosaiced camera RGB
before white balance, the colour matrix and exposure (simpleprocess.cc:245-260;
improccoordinator.cc:511-534). It is therefore a raw-only tool there. The
pipeline, per photo:

1. **Gamma in** (rawimagesource.cc:1945-2055). Optional per-channel curve on
   RGB in 0..65535.
2. **To a lightness channel** (rawimagesource.cc:2057-2183). L\*a\*b\*
   (L in RawTherapee units, 0..32768) or HSL (lightness × 32768). A fourth
   buffer keeps the hue: `atan2(b, a)` in radians for Lab, HSL hue in [0, 1)
   for HSL.
3. **L=f(L) curve** (rawimagesource.cc:2317-2329) gives the working lightness;
   the unchanged lightness is kept as `originalLuminance`.
4. **MSR** (ipretinex.cc:189-779), on lightness only, possibly iterated.
5. **Back to RGB** (rawimagesource.cc:2359-2555), with the original hue and
   chroma (or saturation), an optional chroma-by-hue curve, and a gamut
   control in Lab.
6. **Gamma out** (rawimagesource.cc:2561-2577).

### 1.1 Gamma in and out

`gammaretinex` ∈ {none, low, mid, hig, fre}. Low, middle and high use fixed
tables built from analytic curves (color.h:1254-1281; tables color.cc:192-197,
369-409, 65536 entries, LUT flags 0 = no clipping, so they extrapolate):

| | forward (in) | inverse (out) |
|---|---|---|
| low | `x ≤ 0.001692 ? 2x : 1.000508·x^(1/1.15) − 0.000508` | `x ≤ 0.003384 ? x/2 : ((x + 0.000508)/1.000508)^1.15` |
| mid | `x ≤ 0.016613 ? 2x : 1.009968·x^(1/1.3) − 0.009968` | `x ≤ 0.033226 ? x/2 : ((x + 0.009968)/1.009968)^1.3` |
| high | `x ≤ 0.009115 ? 3x : 1.012305·x^(1/1.45) − 0.012305` | `x ≤ 0.027345 ? x/3 : ((x + 0.012305)/1.012305)^1.45` |

with `x = value/65535` and the table entry `65535·f(x)`.

Free gamma (`gam` 0.6..3, `slope` 1..20) builds both tables from
`Color::calcGamma` (color.cc:1578-1622, dcraw's bisection for the linear
toe), with `gammareti`/`igammareti` (color.h:1285-1291):

- In (rawimagesource.cc:1954-1995): `pwr = 1/gam`, `gamm = gam`, swapped
  when `gam < 1`; `start = g[3]` (g[2] when gam < 1), `add = g[4]`,
  `mul = 1 + g[4]`; entry `CLIP(65535·f(i/65535))` with `f = gammareti`
  (`igammareti` when gam < 1).
- Out (rawimagesource.cc:2224-2263): `start = g[2]`, `add = g[4]` for
  gam ≥ 1, but `start = g[3]`, **`add = g[3]`** for gam < 1; `f = igammareti`
  (gammareti when gam < 1).

**Quirk, ported:** the out table is not the inverse of the in table.
`igammareti` switches branch at `x ≤ start·slope`, and with `start = g[2]`
that is `g[2]·slope`, not `g[2]`; for gam < 1 `add` is `g[3]`, not `g[4]`. A
free gamma therefore does not round-trip; RawTherapee's output carries that
error and so does ours.

Both gammas run only when `gammaretinex != "none"` **and** `str != 0`
(rawimagesource.cc:2037, 2561). LUT indexing is `LUT.h:460-482`: a float
index interpolates linearly between entries; with flags 0, an index above
65534 or below 0 extrapolates along the last (first) segment.

### 1.2 Lightness and hue

- **Lab** (rawimagesource.cc:2127-2183): `Color::rgbxyz` with the working
  profile matrix (iccstore.cc `workingSpaceMatrix`) applied to the **camera**
  RGB (a quirk: there is no camera matrix yet at this point), then
  `Color::XYZ2Lab` (color.cc:1874-1889): `x = X/0.9642`, `z = Z/0.8249`,
  `f = cachef[...]` (a 65536-entry LUT of 327.68·cbrt, linear below
  ε·65535, exact cbrt above 65535; color.cc:200-220, 1715-1724), `L =
  computeXYZ2LabY(Y)` (color.h:177-186), `a = 500(fx − fy)`, `b = 200(fy −
  fz)`. The hue buffer holds `xatan2f(b, a)`.
- **HSL** (rawimagesource.cc:2057-2126): `rgb2hsl` on 0..65535 (color.h:
  273-306 scalar, color.cc:629-650 SSE, the same arithmetic): `l = (max +
  min)/131070`, `s = C/(max + min)` or `C/(131070 − max − min)` above l =
  0.5, hue by the max channel (red first), h = s = 0 when `C < 0.65535`.
  L = 32768·l. The hue buffer holds h. **Quirk, not ported:** only the SSE
  loop stores the hue buffer; the scalar tail of each row (the last `W mod
  4` columns) leaves it unset, so Strength=f(H) sees hue 0 there. We store
  the hue everywhere.
- `HSLLOG` and `HSLLIN` differ only inside MSR (§1.4).

### 1.3 The L=f(L) curve and the working buffers

`retinexPrepareCurves` (rawimagesource.cc:2189-2202) builds `cdcurve` from
`cdcurve` (Lab) or `cdHcurve` (HSL), and `mapcurve`, through
`CurveFactory::diagonalCurve2Lut` (curves.cc:368-393): 65536 entries of
`65535·curve(i/65535)`, identity when the curve is linear, LUT flags 0 (the
CLI makes them with `LUTf cdcurve(65536, 0)`, simpleprocess.cc:249).
`mapcurve *= 0.5` (rawimagesource.cc:2200).

`LBuffer = cdcurve[2·L]/2` when the curve is not the identity, else `L`
(rawimagesource.cc:2317-2329). MSR then receives `luminance = LBuffer`,
`originalLuminance = L` (before the curve), `exLuminance = hue`
(rawimagesource.cc:2357).

### 1.4 MSR: scales

Constants (ipretinex.cc:197-249):

- `eps = 2`; `nei = int(2.8·neigh)` (Radius 6..100 → 16..280); `vart =
  vart/100`; `strength = str/100`; `limD = limd^1.7`, ×10 for HSL-linear;
  `ilimD = 1/limD`; `hig = highl/100`.
- `moderetinex`: `uni` → 0, `low` → 1, `highliplus` → 3 (and `higplus`),
  everything else (`high`, `highli`) → 3. **Quirk:** mode 2 is never used;
  the comment says High is 2, the code makes it 3.
- `high = 50/99 + (49/99)·highl` (2.4848 at the default highl 4). The
  Highlight threshold slider therefore also sizes the High method's scales,
  although the GUI shows it only for Highlight (retinex.cc:1127-1135).

Per iteration `it = 1..iter` (ipretinex.cc:251-370), from `gradient =
deh.scal` ("Gaussian gradient", −1..6) and the running `scal` (starts at
`skal`, "Scale", 1..8):

| gradient | grad | sc |
|---|---|---|
| 0 | 1 | 3 |
| 1 | 0.25·it + 0.75 | −0.5·it + 4.5 |
| 2 | 0.5·it + 0.5 | −0.75·it + 5.75 |
| 3 | 0.666·it + 0.333 | −0.75·it + 5.75 |
| 4 | 0.8·it + 0.2 | −0.75·it + 5.75 |
| 5 | mode ≠ 3: 2.5·it − 1.5; mode 3: aa·it + 1 − aa, aa = (11·high − 1)/4 | −0.75·it + 5.75 |
| 6 | mode ≠ 3: 5·it − 4; mode 3: aa·it + 1 − aa, aa = (21·high − 1)/4 | −0.75·it + 5.75 |
| −1 | −0.125·it + 1.125 | 3 |

Then `sc = scal` when `iter == 1`; otherwise `sc −= 1` (floor 1) when `scal
< 3`, `sc += 1` when `scal > 4`; finally `scal = round(sc)`. **The running
`scal` carries into the next iteration**, so the scale count of iteration k
depends on k − 1's.

`gradvart` ("Transmission gradient", −2..2) scales `varx = vart·g`, `limdx =
limD·g` (`ilimdx = 1/limdx`) with g = −0.125·it + 1.125 (1), −0.2·it + 1.2
(2), 0.125·it + 0.875 (−1), 0.4·it + 0.6 (−2) (ipretinex.cc:310-332).

`gradstr` ("Strength gradient", −2..2) gives `ks` (ipretinex.cc:334-363):
it ≤ 3: −0.3·it + 1.6 (1), −0.6·it + 2.2 (2), 0.2·it + 0.6 (−1), 0.4·it +
0.2 (−2); it > 3: 0.5, 0.3, 1.2, 1.5. `strengthx = ks·strength`. **Quirk,
ported:** at it = 1 the default gradstr 1 gives ks = 1.3, so the default
Strength 20 acts as 26 %, although the GUI greys the gradient sliders out
while Iterations is 1 (retinex.cc:751-758).

`retinex_scales(scales, scal, mode, int(nei/grad), high)`
(ipretinex.cc:103-141), with `s ≥ 3`:

- 1 scale: `s/2`; 2 scales: `{s, s/2}`.
- mode 0: `scales[n−1−i] = 2 + i·s/n`.
- mode 1: `scales[n−1−i] = 2 + e^(i·ln(s−2)/n)`.
- mode 3: `scales[i] = high·s − e^(i·ln(s−2)/n)`.

(`pow(10, x/log(10)) = eˣ`.) Index 0 is the largest σ. Default (High, 3
scales, Radius 80): σ = 555.6, 550.6, 519.9 px.

`pond = ln(16384)/scal`, divided by `ln(2.71828)` unless HSL-linear
(ipretinex.cc:415-420).

### 1.5 MSR: the blurs

**Correction to the brief: the blurs are not Gaussians.** MSR calls
`gaussianBlur(src, out, W, H, σ, true)` (ipretinex.cc:436, 451); the last
argument selects the iterated box blur (gauss.cc:1379-1418):

```
n = 1; w = sqrt(12σ² + 1)
while (w > W || w > H) { n++; w = sqrt(12σ²/n + 1) }
if (n < 3) { n = 3; w = sqrt(12σ²/3 + 1) } else if (n > 6) n = 6   // w kept
wl = int(w), made odd (wl−1 if even); wu = wl + 2
m = round((12σ² − n·wl² − 4n·wl − 3n) / (−4wl − 4))
box i < m: radius (wl−1)/2, else (wu−1)/2
```

Each box (boxblur.cc:505-745) is a horizontal then a vertical running mean
with radius `min(r, W−1, H−1)`, **truncated at the edges and normalized by
the pixels inside the window**. The double loop is in double for `w`, `m`,
float for the running sums.

The scales are blurred **incrementally**, smallest σ first (ipretinex.cc:
434-451): `out = blur(src, σ[n−1])`, then `out = blur(out, sqrt(σ[k]² −
σ[k+1]²))` for k = n−2 … 0. Default increments: 519.9, 181.0, 74.8 px, each
three boxes (radii 519/519/520, 180/181/181, 74/74/75 at 6000 × 4000).

`src = luminance + eps` (ipretinex.cc:406-410), and `luminance` is zeroed to
become the accumulator.

### 1.6 MSR: the mask (`mapMethod`) and the accumulation

`mapmet`: `map` (sharp mask, wavelet partial) 2, `mapT` (wavelet total) 3,
`gaus` (Gaussian mask) 4, otherwise 0 (ipretinex.cc:375-385). Only on
**it = 1**:

- `mapcurve`: when `mapmet > 0` and the map curve isn't the identity, `out =
  mapcurve[2·out]` for every scale (ipretinex.cc:476-487).
- Shadows/highlights mask, for `mapmet == 3 || 4` at every scale, or `mapmet
  == 2` at **scale index > 2** (ipretinex.cc:470-512; with the default 3
  scales "partial" never fires):
  - `SHMap::updateL(out, shradius, hq = true, skip = 1)` (shmap.cc:207-330),
    `shradius = radius` for `gaus`, 40 otherwise. With hq the map is two
    levels of `dirpyr_shmap` (shmap.cc:338-450, `levrad = 2` at 227): a 3 × 3
    range-weighted mean at stride 1, then at stride 2, windows truncated at
    the edges (no domain kernel below level 2), weight `rangefn[|d|]`,
    `rangefn[i] = exp(−min(10, i²/(100·radius)²))`, size
    `int(100·radius)·√10 + 1`, last entry 1e-15. The SSE middle columns
    index the LUT by truncation; the scalar edge columns interpolate. The
    radius only shapes the range weight; it is not a spatial radius.
  - `max_f`, `min_f`, `avg` of the map (shmap.cc:292-324).
  - `h_th = int(max_f − htonalwidth·(max_f − avg)/100)`, `s_th =
    int(stonalwidth·(avg − min_f)/100)`.
  - Per pixel, `mapval = 1 + map`; `factor = (h_th + hW(mapval − h_th))/mapval`
    above h_th, `(s_th − sW(s_th − mapval))/mapval` below s_th, 1 between,
    `hW = (100 − highlights)/100`, `sW = (100 − shadows)/100`; `out *=
    factor` (map curve first, then factor).
  - The modified `out` serves only this scale's log ratio; the chain
    continues from the unmodified blur (the store/restore of
    ipretinex.cc:439-465 has exactly that effect).

Accumulation (ipretinex.cc:518-547):

`luminance += pond · log(clamp(src/out, ilimdx, limdx))` (HSL-linear: without
the log).

### 1.7 MSR: statistics, transmission, normalization

`mean_stddv2` (ipretinex.cc:143-181): mean, `sqrt(E[x²] − mean²)` in double,
min and max over every pixel.

1. **stats₁** of `luminance` (557).
2. If the transmission curve is set and `mean ≠ 0`, `stddv ≠ 0`
   (561-630): abscissa (×500, so 0..500 indexes the 501-entry curve LUT):
   - `|l − mean| < std`: `500·(0.166666/std)·l + 500·(0.5 − (0.166666/std)·mean)`
   - `l ≥ mean`: `amax = 0.333333/(max − mean − std)`, `500·(amax·l + 1 − amax·max)`
   - else: `amin = 0.333333/(mean − std − min)`, `500·(amin·l − amin·min)`

   `luminance *= −1 + 4·T[absc]` (`tran = luminance` for the transmission
   views). Then, on it = 1 with the median switch on, a 3 × 3 median, the
   one-pixel border untouched (601-625). Then **stats₂** (629). Without the
   curve, stats₂ = stats₁.
3. `mini = mean − varx·std`, raised to `min + 0.1` if below `min`; `maxi =
   mean + varx·std`, lowered to `max − 0.1`; `delta = maxi − mini` (1 if 0)
   (632-651). Auto-transmission view constants from stats₂: `aza = bza =
   16300/(2·std)`, `azb = −aza·(mean − 2std)`, `bzb = 16300 − bza·mean`
   (653-657).
4. `luminance −= mini`, **stats₃** (664-674). (stats₃ = stats₂ shifted by
   −mini; we derive it rather than reduce again, §4.4.)
5. Gain (677-724): with the gain curve set and stats₃ mean, std ≠ 0, the same
   abscissa on stats₃ and `gan = 2·G[absc]`, else `gan = 0.5`. `cd = gan ·
   (32768/delta) · luminance + offs`.
6. Strength (729-748): `str = strengthx`; on it = 1 with a Strength=f(H)
   curve, `str *= 1 + 2(curve(h) − 0.5)` with h the HSL hue or
   `huelab_to_huehsv2(atan2(b,a))` (color.h:1914-1947); then the Highlights+
   test (§1.12).
7. Output (750-764), by `viewMethod`:
   - none: `intp(str, clamp(cd, 0, 32768), originalLuminance)` = `str·(cd' −
     orig) + orig` (rt_math.h:115-122);
   - mask: `out` (the last scale's, modified if the mask touched it);
   - unsharp: `orig + str·(orig − out)`;
   - tran (auto): `tran ≤ mean₃ ? azb + aza·tran : bzb + bza·tran` (**quirk:**
     constants from stats₂, comparison against stats₃'s mean);
   - tran2 (fixed): `1000 + 700·tran`.

   `tran` and `out` share a buffer (413), so without a transmission curve the
   transmission views show the blurred `out`. Ported.

### 1.8 Iterations

Each iteration's output `luminance` is the next iteration's input `src`
(ipretinex.cc:406-410). The blend and the unsharp view always use the
**original** lightness. Steps that run on it = 1 only: the map curve and
shadows/highlights mask, the median, Strength=f(H). Everything else repeats
with the iteration's own scale count, σ list, `pond`, `limdx`, `varx` and
`strengthx`.

### 1.9 Back to RGB

- **Chroma-by-hue** (method Highlight only, rawimagesource.cc:2283-2297,
  2360-2375, 2496-2499): HSL `S *= 1 + 2(curve(h) − 0.5)`; Lab `C *=
  1 + 2(curve(huelab_to_huehsv2(h)) − 0.5)`, on the original a, b.
- **HSL** (2377-2400): `hsl2rgb(h, s, LBuffer/32768)` (color.h:324-344,
  color.cc:672-689, 734-755).
- **Lab** (2402-2555): `L* = LBuffer/327.68`, `C = |ab|/327.68`, h =
  `atan2(b, a)` of the original; `gamutLchonly(h, sincos, L*, C, …,
  inverse working matrix, highlight = Tc.hrenabled, 0.15, 0.96)`
  (color.cc:2916-3008): loop while out of gamut — any channel < 0: L\* ≥
  0.1, ultra-blue floor on L\* (h ∈ (−1.55, −0.9)), `C *= 0.96`, `L* += 0.15`
  once `C ≤ 3`; or, when the highlight flag is off, `max > 65535 ≥ min`:
  L\* capped at 99.98, `C *= 0.96`, `L* −= 0.15` once `C ≤ 3`. Then
  `Lab2XYZ` (color.h:624-637) and `xyz2rgb` with the inverse matrix.
- **Gamma out** (§1.1).

Note the gamut control runs whenever Retinex is on, in Lab, at any strength:
Retinex at strength 0 in Lab is not an identity in RawTherapee either.

### 1.10 RawTherapee behaviour ported deliberately

All of these are in `rtref.ts` and the shaders, each with a test:

1. High uses mode 3, not 2 (§1.4).
2. Highlight threshold sizes High's scales while hidden.
3. Strength gradient applies at Iterations 1 (ks = 1.3 by default).
4. The running `scal` across iterations.
5. `int(nei/grad)`; `s ≥ 3`; `pow(10, x/ln 10)`.
6. Iterated truncated boxes with RawTherapee's box sizes and `n` rule,
   including `w` not recomputed when `n` is capped at 6.
7. Wavelet-partial mask only at scale index > 2.
8. `h_th`, `s_th` truncated to int.
9. Free gamma out-table quirks (§1.1).
10. The transmission views' constants (§1.7) and `tran` = `out` without a
    transmission curve.
11. LUT extrapolation of the gamma, L=f(L) and map curves (flags 0).
12. Lab gamut control at every strength; chroma curve only for Highlight.

### 1.11 Not ported

- The read-only statistics labels ("Restored data Min/Max", "TM Datas…",
  retinex.cc:666-712): they need the GPU's numbers on the CPU (not in 1.0.0).
- The histograms behind the L=f(L) curves (CPU histograms of the buffers).
- RawTherapee's 4-pixel (Bayer) or 7-pixel (X-Trans) border that Retinex
  skips (rawimagesource.cc:1332-1337): Safelight's stage covers the whole
  frame.
- The HSL hue-buffer gap of §1.2.
- Local (Locallab) Retinex, the rest of ipretinex.cc (782-1669).

### 1.12 Highlights+ (a deliberate deviation)

RawTherapee 5.13 has a fifth method, `highliplus`, commented out of the GUI
(retinex.cc:70, 885). Its only effect besides mode 3 is
`if (higplus && exLuminance > 65535·hig) str *= hig` (ipretinex.cc:746-748):
`exLuminance` is the **hue** buffer (radians or 0..1), never above
65535·hig, so the test never fires; and `hig = highl/100` would serve as
both the threshold and the factor. The preparation code that was meant to
fill that buffer with a highlight signal is commented out
(rawimagesource.cc:2014-2036).

We port Low, Uniform, High and Highlight faithfully and add a **working
Highlights+**: High's scales (mode 3, `high` from Highlight threshold), no
chroma-by-hue curve (as RawTherapee's `highliplus` branch has none), and a
strength that eases off smoothly over the photo's **original** lightness:

```
L0  = originalLuminance / 327.68          // L* or HSL lightness × 100, before
                                          // the L=f(L) curve, after gamma in
t   = clamp((L0 − from) / softness, 0, 1)
w   = t² (3 − 2t)                         // smoothstep, C¹, no step
str = str · (1 − amount · w)              // after Strength=f(H), every iteration
```

Controls, shown only for Highlights+:

| label | key | range | default |
|---|---|---|---|
| Protect from | `protectFrom` | 0..100 (L\*) | 70 |
| Softness | `protectSoftness` | 1..50 (L\*) | 20 |
| Protection | `protectAmount` | 0..100 % | 100 |

At the defaults, lightness above 90 keeps its original value and the effect
fades in below it to full at 70. Because the blend is with the original
lightness (§1.7), strength 0 there means the pixel's lightness is unchanged
(the Lab gamut control still runs). It applies at every iteration with the
same L0, and in the unsharp view (which uses `str`). This is our design, not
RawTherapee's; the manifest, panel and README describe it without claiming
otherwise. `rtref.ts` keeps RawTherapee's dead test when its `safelight`
option is off, so the compiled-source fixture pins it.

---

## 2. Placement in Safelight

### 2.1 Phase, priority, reads

- **Phase `decode`**, priority **55**, `reads: "current"`: after the
  demosaic-level fixes (Lens CA 0, RAW Denoise 5, Capture Sharpening 10/11,
  Moiré Reduction 50), before Wavelet Noise Reduction (60-62), the core
  denoiser, white balance, exposure and the tone block, as RawTherapee orders
  it. A `decode` reader redraws only when the stages before it, the source
  or retouching change (contributions.md "Reading the current image"); the
  built-in denoiser and Wavelet NR rerun after every Retinex change.
- Default `space` (linear Rec.709). Not maskable (decode stages can't be).
  `keepsDetail` off (Retinex changes detail contrast at every scale).
  `presetScope: "global"`. Not `viewOnly` (it reads the current image).

### 2.2 What `lin` holds, and the baseline round trip

In the decode phase a RAW's `lin` is `baselineTone(src)`: linear Rec.709
(D65), camera matrix and as-shot white balance applied, white near 1 with
headroom above, out-of-gamut colours as negative channels
(`src/rendering/webgl/shaders.ts` ~818-834). The camera refit and gain and
clipped-channel reconstruction come after decode stages. A non-RAW photo has
`uApplyBaseCurve` false.

The passes undo the baseline (Newton inverse with `baseline-tone.ts`'s
constants), work on `65535·x` (RawTherapee's raw scale), and the final draw
hands back **Δ = output − input** in that linear space. The inline applies
`lin += baselineTone(x + Δ) − baselineTone(x)`, with core's own
`baselineTone`, so the pixel's full-precision value passes through where Δ
is 0.

### 2.3 Colour spaces, gamut and the "highlight" flag

- **Lab** from the real Rec.709 data with `xyz_sRGB` (D50, Bradford), not
  "the working profile's matrix on camera RGB".
- **Gamut control** (`gamutLchonly`) tests RGB in **Rec.2020**
  (`rec2020_xyz`, RawTherapee 5.13's default working profile); the result goes
  back to RGB through the inverse of the same `xyz_sRGB` (so strength 0 is an
  identity up to the gamut test).
- **Highlight flag on** (no over-white chroma cut).
- **HSL** guard: where `max + min ≥ 131070` the saturation is 0 instead of
  RawTherapee's division by zero or below.
- **NaN guard**: where `src ≤ 0` or the blur ≤ 0 the ratio takes the clamp
  bound (`ilimdx`, or `limdx` for a positive source over a non-positive blur)
  instead of a NaN that would spread.

### 2.4 Which photos

Every photo, RAW or not (owner decision); the README says it was designed for
RAW data.

### 2.5 Off state, dormancy, derived values

Off by default. Off writes the three draw counts 0 and clears the derived
values; `dormantWhen: { p1Draws: 0, p2Draws: 0, p3Draws: 0 }`. Derived values
are written only while Enabled (§3.4).

### 2.6 Process views

The panel's **Process** selector writes `retinex.msr.view` (what P2 and P3
read) and `retinex.msr.viewP1` (the view with one iteration, Standard
otherwise; updated when the iteration count changes) through
`api.develop.setViewValues`. Core merges view values over the bag for the
live view and binds them to pass uniforms (`use-develop-renderer.ts` 63-71 →
`setContributedParams` → frame bag → pass bindings, signed into the pass
cache). So the views show in Develop and never in exports, thumbnails or
presets; captures of the live photo (pickers, Auto) do see them. View values
aren't per photo: the view returns to Standard when another photo opens
(`index.tsx`), and the panel forgets it when the extension stops (core clears
the values). Deviation from RawTherapee, which saves `viewMethod`; and
(owner decision) views apply at the **final iteration only**, where
RawTherapee applies them at every iteration.

### 2.7 Process versions

New extension; nothing is version-gated. `dormantWhen` acts on version 2
photos' live view. On version 1 photos with the core denoiser on, core drops
what decode stages did, Retinex included.

### 2.8 Radii and pass size

σ per iteration and scale is computed on the CPU in source pixels with
RawTherapee's float arithmetic (`src/rt-plan.ts`, pinned by the fixture) and
scaled in the shader by `k = passLong / sourceLong`; box counts and radii then
follow `gaussianBlur`'s rule at the pass's W × H. An export at full size is
RawTherapee's computation; Develop at 4096 px is the same operator on a
smaller image (§4.4 measures the difference).

---

## 3. Parameters and panel

### 3.1 Controls

Labels carry no program names; Canadian spelling. Ranges and defaults are
RawTherapee's (retinex.cc 86-106, 184-207, 335-343, 366-388, 426-436, 481;
procparams.cc 674-748). Visibility mirrors retinex.cc 732-760, 1127-1255.

| control | bag key | range / options | default | shown |
|---|---|---|---|---|
| Enabled | `on` | Toggle | off | always |
| Standard / Advanced | `advanced` | SegmentedControl | Standard | always |
| Method | `method` | Low, Uniform, High, Highlight, Highlights+ | High | always |
| Colour space | `space` | L\*a\*b\*, HSL logarithmic, HSL linear | L\*a\*b\* | always |
| Strength / Radius / Contrast | `strength` / `radius` / `contrast` | 0-100 / 6-100 / 50-500 | 20 / 80 / 200 | always |
| Highlight threshold | `highlightThreshold` | 1-20 | 4 | Highlight, Highlights+ |
| Protect from / Softness / Protection | `protectFrom` / `protectSoftness` / `protectAmount` | 0-100 / 1-50 / 0-100 % | 70 / 20 / 100 | Highlights+ |
| Process | view value | Standard, Unsharp mask, Mask, Transmission (auto), Transmission (fixed) | Standard | Advanced |
| Mask method | `maskMethod` | None, Gaussian mask, Sharp mask (partial), Sharp mask (total) | None | Advanced (section "Mask") |
| Mask L=f(L), Highlights, Highlights tonal width, Shadows, Shadows tonal width | `maskCurve`, `maskHighlights`, … | diagonal curve; 0-100, 10-100, 0-100, 10-100 | linear, 0, 80, 0, 80 | mask ≠ None |
| Mask radius | `maskRadius` | 5-100 | 40 | Gaussian mask |
| L=f(L) / L=f(L), HSL | `lightnessCurve` / `lightnessCurveHsl` | diagonal curve | linear | Advanced, by colour space ("Equalizer") |
| Strength=f(H) | `hueCurve` | flat periodic curve, hue bar | linear | Advanced, Process Standard |
| Gamma, Free gamma, Free gamma slope | `gamma`, `gammaValue`, `gammaSlope` | None…Free; 0.6-3; 1-20 | None, 1.3, 3 | Advanced; Free |
| Iterations, Gaussian / Transmission / Strength gradient | `iterations`, `scaleGradient`, `transmissionGradient`, `strengthGradient` | 1-5; −1-6; −2-2; −2-2 | 1, 3, 1, 1 | Advanced, Process not Unsharp/Mask; gradients greyed at 1 iteration |
| Transmission map | `transmissionCurve` | flat curve | RawTherapee's | Advanced, Process not Unsharp/Mask |
| Scale / Threshold | `scales` / `threshold` | 1-8 / 2-100 | 3 / 8 | always / Process not Unsharp/Mask |
| Transmission median filter | `median` | Toggle | off | Advanced, Process not Unsharp/Mask |
| Gain transmission / Offset | `gainCurve` / `offset` | flat curve / −1000-5000 | RawTherapee's / 0 | always / Process Standard |
| Reset | — | Button | — | always |

Switching to Standard resets Iterations, Mask method, both L=f(L) curves,
Strength=f(H), the transmission curve and the median filter, and the view
(retinex.cc 713-729). Reset restores every default but Enabled and the
complexity (retinex.cc 590-618).

### 3.2 Curves

Kept in the bag as fixed-size number lists (`type, count, values…`, zero
padded): diagonal `vec4[17]` (33 nodes), flat `vec4[25]` (24 nodes), in
RawTherapee's profile layout once unpacked. They are stage-level uniforms so
presets carry them; the main program never names them. `src/curves.ts` is
RawTherapee's `DiagonalCurve` (linear, custom spline, parametric, control
cage, flexible) and `FlatCurve` (control points with tangents, periodic or
not), used for drawing, for the passes' tables and by `rtref.ts`.

### 3.3 Curve editing UI

`Graph.tsx`, in Colour Zones' look: canvas, grid, identity line, the curve as
the passes apply it, nodes; drag, click to add, right-click to remove,
double-click to reset; a type `Select` per curve; flat curves show the
selected node's tangents as two `NumberInput`s; parametric curves show four
region sliders and three split points; the Strength=f(H) graph has a hue bar.

### 3.4 Derived bag values

Written with every edit while Enabled, cleared when off, re-derived by a
store subscription whenever they disagree with the edit (`params.ts`
`rederivePatch`):

- `p1Draws`, `p2Draws`, `p3Draws` (stage-level ints): the passes' slot counts
  from the params alone.
- Pass-level vec4 arrays (`model.ts derive`, sizes in `DERIVED_SIZES`):
  `rtIt1` (iteration 1's σ, scale count, pond, limits, flags), `rtMask`,
  `rtIters` (every iteration's σ, pond, limits, `varx`, `strengthx`),
  `rtFlags`, `rtProtect`, `rtConv` (colour space, L=f(L) on, gamma on), `rtGammaIn`/`rtGammaOut`, `rtCd`/`rtMap`
  (256 samples, Catmull-Rom) with their end lines, `rtTransA/B` and
  `rtGainA/B` (RawTherapee's exact 501-entry tables), `rtHue` (256 periodic
  samples).
- The layout-version mark, 1001 (`DERIVED_MARK`, 1000 + the layout's
  version), in `rtConv[1].x`, `rtMask[1].w`, `rtIters[3].w` and
  `rtFlags[2].w`: P1 checks the first two, P2 and P3 the first and the last
  two. A bag without its derived values, or with another version's, draws
  nothing. The subscription re-derives only when one of the stage's own keys
  changed.

---

## 4. GPU architecture

### 4.1 Passes

| pass | slots | does | `keep` | reads (uniforms) |
|---|---|---|---|---|
| **P1** | iteration 1's | start, blur chains, mask, accumulation, stats₁, transmission (+ the views' pre-median copy), median, stats₂ — raw statistics only | **yes** | `rtIt1`, `rtMask`, `rtConv`, `rtGammaIn`, `rtCd(+Ends)`, `rtMap(+Ends)`, `rtTransA/B`, `viewP1` |
| **P2** | iterations 2…5 | each: `src_k` materialized in one full-frame draw, then as P1 without mask/median | no | `rtIters`, `rtFlags`, `rtProtect`, `rtConv`, `rtGammaIn`, `rtTransA/B`, `rtGainA/B`, `rtHue`, `view` |
| **P3** | 1 | FINAL: Δ with the sentinel | no | `rtIters`, `rtFlags`, `rtProtect`, `rtConv`, `rtGammaIn/Out`, `rtGainA/B`, `rtHue`, `view` |

Contrast, Strength, Offset, the gain and hue curves and Highlights+ are not
in P1, so at one iteration dragging them reruns P3's one draw; P2/P3 derive
`mini`, `maxi`, `delta` and stats₃ from P1's raw stats₂. Iteration-1
constants are their own uniform, so editing later iterations doesn't touch
P1's signature.

### 4.2 Target layout

Lightness is stored in L\* units (RawTherapee L / 327.68).

| channel | role |
|---|---|
| R | the iteration's log-retinex map, its high half |
| G | iteration ≥ 2: its `src`; iteration 1 without a mask: the blur plane's and tiles' low halves; with one: the mask's statistics trees and constants; during the statistics: the trees' low halves (except at the final iteration with a process view); at the end: the views' copy (the last scale's blur, or the pre-median transmission) |
| B | the full-resolution blur plane (iteration's `src` at the start), and the atlas: tiles P/Q per level 1…6 at linear addresses, then the statistics trees |
| A | from texel 35 on, the log map's low half (the map is R + A), except while a mask scale is built at full resolution, when it holds that scale's shadow map; texels 0-33 the statistics banks (17 a bank, by iteration parity: 8 statistics as high/low pairs, then the tag, the iteration that wrote it); texel 34 the schedule flag |

Every value is rounded to the nearest half in the shader before it is stored
(the target is RGBA16F); the map, the banks' statistics and the statistics
trees keep a second half for what the first one loses, so they hold about 22
significant bits, and so do iteration 1's source, blur plane and tiles when
no mask runs. Later iterations' source and blurs, and iteration 1's with a
mask, are single halves. At a full-resolution mask scale the
shadow map takes A, so that scale's accumulation starts from the high half
alone; on the bank texels (0-34) the map has no low half.
`schedule.ts` mirrors the GLSL's addressing; `schedule.test.ts` sweeps frame
sizes (256 px to 8192 px, aspects 1:4 to 4:1) and parameter sets for fit and
region coverage, and a narrow frame (8 px wide) for the last statistics
level's rows. A frame too small for the atlas (under about 40 px, or fewer
than 35 texels) draws nothing.

### 4.3 The blur chain

RawTherapee's chain: smallest σ first, increments `sqrt(σk² − σk+1²)`, each
increment `n` truncated boxes sized by `gaussianBlur`'s rule at the pass's
W × H.

- **Full resolution, exact** (every box radius of the increment ≤ 17 pass
  px): each box is an H then a V draw on the B plane, the exact truncated
  mean (≤ 35 reads).
- **Decimated**: the level is the finest whose boxes stay within 67 reads
  (fractional m ≤ 32, i.e. r(r + 1) < 1122 · 4^ℓ for the largest radius r),
  never finer than the previous scale's, at most 6. Count-weighted block
  means (4×4 then 2×2 steps, ≤ 3 reductions); each box becomes a fractional
  box on the cells (ones to m, t at m + 1) with variance equal to the
  full-resolution box's, less what the reduction already put in for the first
  box; count-weighted truncation at the frame edges; read back to full
  resolution bilinearly between the cells' true centres (a partial last
  cell's sits within its pixels), and past the outer centres along the edge
  cells' slope (4 reads).

Why the level follows the boxes, not σ: RawTherapee's boxes are truncated at
the frame, and each leaves a kink in its result r pixels in from each edge
and a slope all the way to the edge. Cells must be fine next to r to follow
the kinks, and a read back held flat past the outer cell centres misses the
slope. The first rule (the coarsest level with σ/2^ℓ ≥ 8, a read back
clamped at the outer centres) put 64-px cells under σ ≈ 520 px boxes of
radius ≈ 370 px on a 640 × 400 frame: the blur was off by up to 1.8 %
at the edges and 0.8 % at the kinks. `test/reference/gpu-chain.ts` models
the chain on the CPU and `chain.test.ts` holds it to RawTherapee's exact
boxes (§5).

### 4.4 Whole-image statistics

Four trees per reduction (mean, variance, min, max), 4×4 per level, the last
level writing the bank as high/low pairs and the tag: level 0 reads the source (the map as R + A) in one Welford pass (16
reads); later levels merge children with Chan's formula (≤ 32 reads, a mean
and a variance per child). Every node is a high half in B and its low half
in G (single halves while a process view keeps its copy in G at the final
iteration): Retinex normalizes by the map's minimum, maximum, mean and
deviation, and a half-rounded maximum alone moves the result by p99 0.16-0.29
L\* (HSL linear) through the gain curve's steep top end. Statistics are over
every pass pixel, as RawTherapee does.
Prototype measurements of Develop (4096 px of a 24 MP photo) against the
full-size render: L\* p50 0.10-0.19, p99 0.7-2.8, global offset under 0.1
L\*, and forcing the full-size statistics into the small render doesn't
reduce the p99: the difference is the operator's resolution dependence, not
the statistics, so no fixed analysis grid.

### 4.5 The mask (iteration 1)

Full-resolution scales: SHMAP1 and SHMAP2 are RawTherapee's two dirpyr levels
(3×3 at stride 1 then 2, truncated windows, range weights with the SSE
column span's truncated index and the scalar columns' interpolated one) into
A, then a statistics reduction into G (`min_f` from 65535, `max_f` from 0).
Decimated scales: the map is the blurred tile (the dirpyr's ~1.6 px is below
the cell). The accumulation applies the map curve, then the factor, to the
blur used for that scale's ratio.

### 4.6 The schedule

Each pass is a fixed sequence of slots from the params (`stepAt`): per
iteration a start slot; per scale 3 reductions, 12 box slots (6 boxes × H/V),
the mask's 2 + 8 slots where the mask runs, and an accumulation; then 8
stats₁ slots, transmission, median (iteration 1 with the switch), 8 stats₂
slots. A slot with no work at this pass size is idle. The fragment decodes its
step from `uPassIndex` (ALU only); the region (vertex program) is the union
of this slot's writes and the previous slot's; a pass's first slot is drawn
whole. If `uPassCount` doesn't match the params, or a plan array lacks the
version mark, every slot writes only the flag texel and FINAL hands back no
sentinel. An iteration ≥ 2's start draw flags the frame too when the
previous iteration's bank doesn't carry its tag.

### 4.7 FINAL and the inline

FINAL recomputes from `fetchInput`: unbaseline, gamma in, Lab/HSL, the output
lightness (`rtOutput`: mini/maxi from `varx`, gain abscissa on stats₃, cd
clamped to `[0, max(32768, original L)]`, Strength=f(H), Highlights+, views at
the final iteration), the chroma curve (Highlight), `gamutLchonly` (Rec.2020
test, ≤ 512 rounds of ALU), back through inverse `xyz_sRGB`, gamma out; it
writes `vec4(Δ, −1e4)`, Δ rounded to halves, unless the marks, the iteration
count (1 to 5), the flag or the last iteration's tag say otherwise, or Δ isn't
finite. The inline reads its own result sampler (`u_<hash>_stageResult`,
`textureLod`) and applies Δ only when `|a + 1e4| < 0.5`, so a stage that drew
nothing (no texture unit, a refused target) leaves `lin` alone.

### 4.8 Cost

Reads per texel per draw (static, `stage.test.ts`, every helper whatever it
returns): full-resolution box ≤ 35, coarse box ≤ 67 (its draw covers only its
tile, at most a quarter of the frame), reduction 16, statistics ≤ 32,
accumulation ≤ 11, dirpyr 10, final ≤ 13.

Measured on an RTX 4070 Ti (ANGLE D3D11), 4096 × 2731, frame time including
an 18.5 ms read-back that an idle frame also takes:

| case | slots | median frame |
|---|---|---|
| idle (off) | 0 | 18.5 ms |
| defaults, Radius drag (P1 + P3) | 66 + 1 | 26.4 ms (24.9 before the level rule of §4.3) |
| defaults, Strength drag (P3) | 1 | 26.0 ms (24.7) |
| worst (Low, Radius 100, Scale 8, gradient 6, 5 iterations, Gaussian mask, median), Strength drag (P2 + P3) | 328 + 1 | 218 ms (177) |
| worst, Radius drag (P1 + P2 + P3) | 175 + 328 + 1 | 220 ms (178) |

The finer levels add 1.5 ms at the defaults and about 41 ms in the worst
case (bigger tiles, up to 67 reads a coarse cell); slots are unchanged. A
cap of 51 reads (m ≤ 24) timed back to back saves nothing (worst case 222 ms
against 220) and doubles HSL linear's p99 at 1600 × 1000 (0.10 against
0.04), so the worst case's cost lies in its slots, not its box reads. So
about 8 ms over idle at the defaults and about 200 ms in the worst case on a
discrete GPU; expect several times that on an integrated GPU. Idle slots
cost tens of µs each (every draw rebinds every uniform). Each draw stays far
under a GPU-reset watchdog.

### 4.9 Direct3D 11 discipline

`fetchPrev4`, `fetchInput` only; no `texture()`, no `readPrev`; no `const`
or local arrays; uniform arrays read by one accessor per array, never passed
to a helper; a scalar 9-value median network (median.h's); literal-bounded
loops that break early; `highp int` for address arithmetic.

---

## 5. Fidelity (measured)

| layer | what | result |
|---|---|---|
| 2 | `rtref.ts` vs RawTherapee 5.13 compiled from its own source (`rt_ref.cpp`: verbatim `MSR`, `retinex*`, `gauss.cc`, `boxblur.cc`, `shmap.cc`, `LUT.h`, `median.h`, curves; 35 cases, 2 images) | relative RGB p99 ≤ 8.4e-6, max ≤ 4.2e-5 |
| 4 | `rtref.ts` vs `rawtherapee-cli` 5.13 (16-bit LinearRaw DNG, raw preprocess WB set to Camera, 8 cases) | \|ΔL\*\| p99 ≤ 9.7e-4, max ≤ 1.0e-3 |
| 3 | GPU (SwiftShader) vs `rtref.ts` with Safelight's options, 320 × 200, 25 cases at strength 50-100 | \|ΔL\*\| p99 ≤ 0.16 (most ≤ 0.045), max ≤ 0.98; 5 iterations of 8 small scales: p99 0.065, max 1.2 at one pixel |
| 3 | GPU (SwiftShader), 640 × 400, defaults at strength 100 | p99 0.11, max 0.31 |
| 3 | GPU, a fine texture without noise at strength 100 (below), SwiftShader and D3D11 (RTX 4070 Ti) | p99 ≤ 0.066 on every case on both; D3D11 and SwiftShader within 0.015 |
| 1-3 | `chain.test.ts`: the CPU model of the chain (no half floats) through the whole of Retinex, the same scene | p99 ≤ 0.031 |
| 3 | RAW baseline round trip (frame vs the reference rendered through core) | relative p99 1.3e-2 |

Pixels at or above 0.97 are left out of the GPU comparisons (core rebuilds
such channels after decode stages), and negative channels are compared at 0
(core holds them there after decode stages).

Large radii on small frames, the fine-texture scene at strength 100, p99
|ΔL\*| against the reference (before: the first level rule and clamped read
back of §4.3, single-half statistics trees and chain; GPU where it was
measured, else the CPU chain model):

| frame, space | Radius 10 before → now | Radius 30 | Radius 80 |
|---|---|---|---|
| 640 × 400, HSL linear | 0.16 → 0.013 | 0.58 → 0.022 | 1.37 → 0.014 |
| 640 × 400, L\*a\*b\* | 0.136 → 0.062 | 0.058 → 0.024 | 0.47 → 0.027 |
| 1600 × 1000, HSL linear | (model 0.35) → 0.027 | (model 0.046) → 0.016 | 0.97 → 0.032 |
| 1600 × 1000, L\*a\*b\* | (model 0.10) → 0.066 | (model 0.076) → 0.061 | 0.12 → 0.024 |

(SwiftShader; D3D11 within 0.015 of it on every case.) The gap had three
parts, isolated one at a time on the CPU: the read back held flat past the
outer cell centres and the cells too coarse for the truncated boxes' kinks
(§4.3; the exact blur, only reduced and read back, already gave p99 1.38 of
the 1.45 the full chain model gave at HSL linear Radius 80); then, once those
were fixed, half-float statistics trees (a half-rounded maximum alone: p99
0.16-0.29 in the model) and half-float tiles (p99 0.05-0.07). HSL linear
suffers most because its map sums the ratio src/blur instead of its log: a
relative blur error ε moves a log map by ε but a linear one by ε · src/blur,
and src/blur reaches 2.6 in the bright areas where the error showed (p99
2.4). The ×10 limit in HSL linear isn't what does it: no ratio there reaches
either limit (343 in HSL linear; 34 in L\*a\*b\*, where it clamps the 9 % of
pixels at the scene's dark floor, whose errors it then hides).

Where the error comes from, by `rtref`'s `half` option (the passes' storage
modelled on the CPU, 320 × 200, against the exact transcription):

| case | map single half (before revision 3) | source and blurs single halves (now) |
|---|---|---|
| 5 iterations of 8 small scales | p99 0.19, max 6.2 | p99 0.080, max 2.0 (9 pixels over 1 L\*) |
| High, radius 6 | p99 0.017, max 0.18 | — |
| 3 iterations | p99 0.026, max 0.27 | — |
| defaults, radius 10 | — | p99 0.011, max 0.06 |

So the hi/lo map halved the 5-iteration p99 (0.22 → 0.105), and the hi/lo
statistics trees and iteration 1's hi/lo chain took it to 0.065 with one
pixel over 1 L\* (max 7.0 → 1.2). Its outliers sit at the rim of a region
flat at the scene's floor (0.001), where the reference itself flips between
0.0008 and 0.024 from one pixel to the next. The earlier D3D11 gap (0.50
against SwiftShader's 0.19) compared two different scenes: on one scene the
backends agree.

## 6. Tests

- `test/reference/rtref.test.ts` (71): rtref vs `vectors.json` (made by
  `build.cjs` with `C:\Strawberry\c\bin\g++`).
- `test/reference/cli.test.ts` (8): rtref vs `cli.json` (made by
  `make_cli_fixture.py` with `rawtherapee-cli`).
- `test/plan.test.ts` (12): RawTherapee's plan quirks.
- `test/reference/chain.test.ts` (7): `gpu-chain.ts`, the CPU model of the
  passes' blur chain, through the whole of Retinex against RawTherapee's exact
  boxes (Radius 10-80, 640 × 400 and 1600 × 1000, p99 < 0.05 L*).
- `test/schedule.test.ts` (20), `test/params.test.ts` (8),
  `test/stage.test.ts` (16, with the per-helper fetch budget),
  `test/panel.test.tsx` (20), `test/activate.test.ts` (8),
  `test/curve-edit.test.ts` (8), `test/graph.test.tsx` (9, a stubbed canvas
  context), `test/bundle.test.ts` (4).
- `test/gpu/retinex.webgl.test.ts` (36, `npm run test:gpu`, SwiftShader;
  arguments go on to vitest, e.g. `npm run test:gpu -- -t "5 iterations"`).
- Hardware timing and D3D11 accuracy: a scratch spec in the core checkout's
  `.superpowers/sdd/2026-11-14-retinex-speed/` (not part of the package).

## 7. Package

`D:\Repositories\Safelight Project\Retinex`: id `retinex`, version 1.0.1,
`minAppVersion` 3.2.5, repository `anthonyreimche/Retinex` (assumed),
GPL-3.0-or-later. `src/`: `index.tsx`, `stage.ts`, `glsl.ts`, `schedule.ts`,
`model.ts`, `rt-plan.ts`, `curves.ts`, `curve-edit.ts`, `params.ts`,
`view.ts`, `Panel.tsx`, `Graph.tsx`, `rt.ts`, `safelight.d.ts`. `test/`: as §6,
`test/reference/rt/` (RawTherapee sources, whole files and verbatim
fragments, with stubs).

## 8. Open questions and risks

1. **Large Radius on small frames: fixed.** Radius 80 on a 640 × 400 frame
   was p99 1.37 L\* (HSL linear) and 0.47 (Lab) off the reference; now 0.014
   and 0.027 (§5). Root cause and fix in §4.3 and §4.4; the cost is in §4.8.
   Still single halves: later iterations' blurs and source, and iteration 1's
   with a mask (G holds the iteration's source or the mask's statistics).
2. **Five iterations of small scales** reach 1.2 L\* at one pixel against
   the reference (p99 0.065), at the rim of a region flat at the floor where
   the reference itself flips between two outcomes; later iterations' source
   and blurs, single halves, move the rim.
3. **Curve uniforms at stage level.** The six curve node arrays are declared on
   the stage so presets carry them; the main program never names them, so
   drivers should drop them, but they add to its declared uniforms.
4. **Captures of the live view see the process view** (pickers, Auto Tone).
5. **Preview vs export** differ by the operator's resolution dependence
   (§4.4).
6. **Worst-case speed**: ~155 ms a change on a discrete GPU, several times
   that on an integrated one.
7. **Not ported**: the read-only statistics labels; the histograms behind the
   L=f(L) curves; RawTherapee's Bayer/X-Trans border skip; the HSL hue-buffer
   gap of §1.2.
8. **Safelight vs `rawtherapee-cli` end to end** on the real renderer (the rig's
   `run.py`) isn't wired; the chain GPU → rtref → CLI covers it.
