# Retinex for Safelight

A [Safelight](https://github.com/anthonyreimche/SafeLight) extension: multi-scale
Retinex on the photo's lightness. It divides each pixel by blurred copies of
the photo at several scales, then renormalizes the result from the photo's
own statistics, which lifts haze and fog, opens shadows and compresses
dynamic range. Transmission and gain curves shape the result, iterations turn
it into a tone mapper, a shadow/highlight mask tames halos, and a
highlight-protecting method keeps bright areas as they were.

It was designed for RAW data: it runs early, on the decoded image, before
noise reduction, white balance and exposure. It also runs on JPEG, PNG and
other photos.

## The controls

- **Enabled**: off by default, because the tool's defaults already change the
  photo.
- **Standard / Advanced**: Advanced adds the process view, the mask, the
  equalizer and tone mapping. Going back to Standard resets what it hides.
- **Method**: **Low** reinforces dark areas, **Uniform** evens the action out,
  **High** reinforces bright areas, **Highlight** also scales chroma by the
  Strength=f(H) curve, **Highlights+** fades the effect out over the bright
  tones (see below).
- **Colour space**: **L\*a\*b\***, **HSL logarithmic**, **HSL linear**.
- **Strength** (0 to 100, default 20), **Radius** (6 to 100, default 80, in
  pixels of the full photo), **Contrast** (50 to 500, default 200; lower
  means more local contrast).
- **Highlight threshold** (1 to 20, default 4): sizes the High-type methods'
  scales.
- Highlights+ only: **Protect from** (L\*, default 70), **Softness** (L\*,
  default 20) and **Protection** (%, default 100). Above *Protect from*, the
  strength eases off smoothly; at *Protect from + Softness* the photo's own
  lightness is kept, by the *Protection* amount.
- **Process** (Advanced): **Standard**, **Unsharp mask**, **Mask**,
  **Transmission (auto)**, **Transmission (fixed)**. The views are for looking
  only: they show in Develop and never in exports, thumbnails or presets, and
  go back to Standard when another photo opens.
- **Mask** (Advanced): **Gaussian mask** or **Sharp mask (partial / total)**,
  a mask curve, **Highlights**, **Shadows**, their tonal widths, and the
  Gaussian mask's **radius**.
- **Settings**:
  - *Equalizer* (Advanced): **L=f(L)** (one for L\*a\*b\*, one for HSL),
    **Strength=f(H)**, **Gamma** (None, Low, Middle, High, Free with **Free
    gamma** and **slope**).
  - *Tone mapping* (Advanced): **Iterations** (1 to 5) and the **Gaussian**,
    **Transmission** and **Strength gradients**, which act from the second
    iteration on (shown greyed at one iteration; the strength gradient still
    scales the first iteration's strength).
  - *Transmission*: the **transmission map** curve (Advanced), **Scale** (1 to
    8 scales), **Threshold**, and a **median filter** (Advanced).
  - *Gain and offset*: the **gain transmission** curve and **Offset**.
- **Reset**: every value back to its default but the switch and complexity.

Curves are edited on the graph: drag a node, click to add one, right-click to
remove it, double-click to reset the curve; with the graph focused, the arrow
keys move the selected node and Delete removes it. Control-point curves show the
selected node's tangents; parametric curves show their region sliders and
split points.

## Notes

- Heavy settings cost time: at a 4096-pixel render, the defaults take a few
  milliseconds a change on a discrete GPU, while five iterations of eight
  small scales with the mask take about 150 ms. Dragging Strength, Contrast,
  Offset or the gain and hue curves at one iteration redraws only the last
  step.
- Develop's render is smaller than the photo, and the effect depends on the
  pixel scale, so an export at full size can differ slightly from what
  Develop shows (typically 0.1-0.2 L\*).

## Licence

GPL-3.0-or-later. See `LICENSE` and the copyright lines in the source files.
