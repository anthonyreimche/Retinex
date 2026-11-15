// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The panel, in the order of the tool it ports: the switch and complexity,
// method and colour space, the main sliders, the process view, the mask, then
// the settings (equalizer, tone mapping, transmission, gain and offset) and a
// reset. Which controls show follows the original's rules (docs/SPEC.md §3.1):
// by complexity, method, colour space, gamma, mask method and process view.
//
// A drag writes the value and the derived values live and commits on release,
// so one gesture is one undo step; switches, choices and curve gestures
// commit when they end. The process view is a view value, never part of the
// edit (view.ts). Tooltips paraphrase the original's.

import { DCT, FCT } from "./curves";
import { startCurve } from "./curve-edit";
import { CurveGraph } from "./Graph";
import { DEFAULT_PARAMS, RANGES, VIEWS, type CurveKey, type NumericKey, type Params } from "./model";
import { editPatch, readParams, type EditKey } from "./params";
import { React, api } from "./rt";
import { LABELS } from "./stage";
import { setView, useView } from "./view";

export const TITLE = "Retinex";

const METHOD_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "uniform", label: "Uniform" },
  { value: "high", label: "High" },
  { value: "highlight", label: "Highlight" },
  { value: "highlightsPlus", label: "Highlights+" },
];
const SPACE_OPTIONS = [
  { value: "lab", label: "L*a*b*" },
  { value: "hslLog", label: "HSL logarithmic" },
  { value: "hslLinear", label: "HSL linear" },
];
const GAMMA_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "middle", label: "Middle" },
  { value: "high", label: "High" },
  { value: "free", label: "Free" },
];
const MASK_OPTIONS = [
  { value: "none", label: "None" },
  { value: "gaussian", label: "Gaussian mask" },
  { value: "partial", label: "Sharp mask (partial)" },
  { value: "total", label: "Sharp mask (total)" },
];
const VIEW_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "unsharp", label: "Unsharp mask" },
  { value: "mask", label: "Mask" },
  { value: "transmissionAuto", label: "Transmission (auto)" },
  { value: "transmissionFixed", label: "Transmission (fixed)" },
];
const DIAGONAL_TYPES = [
  { value: String(DCT.linear), label: "Linear" },
  { value: String(DCT.spline), label: "Custom" },
  { value: String(DCT.parametric), label: "Parametric" },
  { value: String(DCT.nurbs), label: "Control cage" },
  { value: String(DCT.catmullRom), label: "Flexible" },
];
const FLAT_TYPES = [
  { value: String(FCT.linear), label: "Linear" },
  { value: String(FCT.controlPoints), label: "Control points" },
];
const PARAMETRIC = ["Highlights", "Lights", "Darks", "Shadows"];
const SPLITS = ["Shadows split", "Midtones split", "Highlights split"];

/** Tooltips, by control. */
export const TIPS: Partial<Record<NumericKey | "method" | "space" | "gamma" | "maskMethod" | "view", string>> = {
  method:
    "Where Retinex acts most: Low on dark tones, Uniform evenly, High on bright tones. Highlight, for the magenta cast of highlights, also scales chroma by the Strength=f(H) curve; Highlights+ eases the effect off over the brightest tones.",
  space: "The lightness Retinex works on: L*a*b* lightness, or HSL lightness through a logarithmic or a linear map.",
  gamma: "Restores tones with a gamma applied before Retinex and undone after it. Free sets your own gamma and slope.",
  maskMethod: "Limits the effect by the photo's own tones, against halos: a blurred mask, or a sharp mask on the smaller scales (partial) or on every scale (total).",
  view: "Shows a step of the process in place of the result, to tune it: the unsharp mask, the mask, or the transmission map, scaled to its range (auto) or not (fixed). Only the live view shows it.",
  strength: "How much of the result is mixed into the photo.",
  radius: "The largest blur Retinex compares each pixel with. Larger radii take in more of the surroundings.",
  contrast: "Low values raise local contrast and saturation but can bring artifacts; high values give a softer result.",
  scales: "How many blur sizes Retinex combines, from the smallest to the radius.",
  threshold: "Limits how far a pixel may differ from its surroundings in each blur. Higher values allow stronger local changes.",
  iterations: "Runs Retinex again on its own result, up to five times. The gradients then change the radius, the transmission and the strength from one run to the next.",
  offset: "Moves the result's lightness up or down.",
};

/** What switching to Standard resets (retinex.cc 713-729). */
const STANDARD_RESET: readonly EditKey[] = ["iterations", "maskMethod", "lightnessCurve", "lightnessCurveHsl", "hueCurve", "transmissionCurve", "median"];

export function RetinexPanel() {
  const { Slider } = api.components;
  const { Button, Field, Section, SegmentedControl, Select, Stack, Toggle } = api.ui;
  const scope = api.develop.useParamScope();
  const p = readParams(scope.getParams());
  const view = useView();

  const current = (): Params => readParams(scope.getParams());
  const write = (next: Params, keys: readonly EditKey[]) => scope.setParams(editPatch(next, keys));
  const commit = (what: string) => scope.commit(`${TITLE}: ${what}`);

  const slider = (key: NumericKey) => {
    const range = RANGES[key];
    const control = (
      <Slider
        label={LABELS[key]}
        value={p[key]}
        min={range.min}
        max={range.max}
        step={range.step}
        defaultValue={DEFAULT_PARAMS[key]}
        onChange={(v) => write({ ...current(), [key]: Math.min(Math.max(v, range.min), range.max) }, [key])}
        onCommit={() => commit(LABELS[key].toLowerCase())}
      />
    );
    return TIPS[key] ? (
      <div key={key} title={TIPS[key]}>
        {control}
      </div>
    ) : (
      <React.Fragment key={key}>{control}</React.Fragment>
    );
  };

  const choice = <K extends "method" | "space" | "gamma" | "maskMethod">(key: K, options: { value: string; label: string }[]) => (
    <Field key={key} label={LABELS[key]}>
      <Select
        ariaLabel={LABELS[key]}
        title={TIPS[key]}
        value={p[key]}
        options={options}
        onChange={(v) => {
          if (!options.some((o) => o.value === v)) return;
          write({ ...current(), [key]: v }, [key]);
          commit(LABELS[key].toLowerCase());
        }}
      />
    </Field>
  );

  const curve = (key: CurveKey, flat: boolean, periodic: boolean, identity: number, hueBar = false) => {
    const value = p[key];
    const type = value[0] ?? 0;
    const label = LABELS[key];
    return (
      <Stack key={key} gap={4}>
        <Field label={label}>
          <Select
            ariaLabel={`${label} type`}
            value={String(type)}
            options={flat ? FLAT_TYPES : DIAGONAL_TYPES}
            onChange={(v) => {
              write({ ...current(), [key]: startCurve(Number(v), flat, identity) }, [key]);
              commit(label);
            }}
          />
        </Field>
        {type === DCT.parametric && !flat ? (
          parametric(key)
        ) : type !== 0 ? (
          <CurveGraph
            label={label}
            curve={value}
            flat={flat}
            periodic={periodic}
            identity={identity}
            hueBar={hueBar}
            onChange={(next) => write({ ...current(), [key]: next }, [key])}
            onCommit={() => commit(label)}
            onReset={() => {
              write({ ...current(), [key]: DEFAULT_PARAMS[key] }, [key]);
              commit(label);
            }}
          />
        ) : null}
      </Stack>
    );
  };

  const parametric = (key: CurveKey) => {
    const value = p[key];
    const set = (i: number, v: number) => {
      const next = [...current()[key]];
      next[i] = v;
      write({ ...current(), [key]: next }, [key]);
    };
    return (
      <Stack gap={4}>
        {PARAMETRIC.map((name, k) => (
          <Slider
            key={name}
            label={name}
            value={value[4 + k] ?? 0}
            min={-100}
            max={100}
            step={1}
            defaultValue={0}
            onChange={(v) => set(4 + k, v)}
            onCommit={() => commit(`${LABELS[key]} ${name.toLowerCase()}`)}
          />
        ))}
        {SPLITS.map((name, k) => (
          <Slider
            key={name}
            label={name}
            value={Math.round((value[1 + k] ?? 0) * 100)}
            min={5}
            max={95}
            step={1}
            defaultValue={[25, 50, 75][k]}
            onChange={(v) => {
              const splits = [value[1], value[2], value[3]];
              splits[k] = v / 100;
              if (splits[0] < splits[1] && splits[1] < splits[2]) set(1 + k, v / 100);
            }}
            onCommit={() => commit(`${LABELS[key]} ${name.toLowerCase()}`)}
          />
        ))}
      </Stack>
    );
  };

  const advanced = p.advanced;
  const plainView = view === "standard";
  const maskOrUnsharp = view === "mask" || view === "unsharp";
  const highlightMethod = p.method === "highlight" || p.method === "highlightsPlus";

  const gradient = (key: NumericKey) => (
    <div key={key} aria-disabled={p.iterations <= 1} style={p.iterations <= 1 ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
      {slider(key)}
    </div>
  );

  return (
    <Stack gap={6} style={{ padding: 8 }}>
      <Toggle
        checked={p.on}
        label={LABELS.on}
        onChange={(checked) => {
          write({ ...current(), on: checked }, ["on"]);
          commit(checked ? "on" : "off");
        }}
      />
      <SegmentedControl
        size="sm"
        value={advanced ? "advanced" : "standard"}
        options={[
          { value: "standard", label: "Standard" },
          { value: "advanced", label: "Advanced" },
        ]}
        onChange={(v) => {
          const on = v === "advanced";
          const next: Params = on ? { ...current(), advanced: true } : { ...current(), ...pick(DEFAULT_PARAMS, STANDARD_RESET), advanced: false };
          write(next, on ? ["advanced"] : ["advanced", ...STANDARD_RESET]);
          if (!on) setView("standard");
          commit(on ? "advanced" : "standard");
        }}
      />
      {choice("method", METHOD_OPTIONS)}
      {choice("space", SPACE_OPTIONS)}
      {slider("strength")}
      {slider("radius")}
      {slider("contrast")}
      {highlightMethod ? slider("highlightThreshold") : null}
      {p.method === "highlightsPlus" ? (
        <>
          {slider("protectFrom")}
          {slider("protectSoftness")}
          {slider("protectAmount")}
        </>
      ) : null}
      {advanced ? (
        <Field label="Process">
          <Select
            ariaLabel="Process"
            title={TIPS.view}
            value={view}
            options={VIEW_OPTIONS}
            onChange={(v) => {
              const next = VIEWS.find((option) => option === v);
              if (next) setView(next);
            }}
          />
        </Field>
      ) : null}
      {advanced ? (
        <Section title="Mask">
          <Stack gap={6}>
            {choice("maskMethod", MASK_OPTIONS)}
            {p.maskMethod !== "none" ? (
              <>
                {curve("maskCurve", false, false, 0)}
                {slider("maskHighlights")}
                {slider("maskHighlightsWidth")}
                {slider("maskShadows")}
                {slider("maskShadowsWidth")}
                {p.maskMethod === "gaussian" ? slider("maskRadius") : null}
              </>
            ) : null}
          </Stack>
        </Section>
      ) : null}
      <Section title="Settings">
        <Stack gap={6}>
          {advanced ? (
            <Section title="Equalizer">
              <Stack gap={6}>
                {p.space === "lab" ? curve("lightnessCurve", false, false, 0) : curve("lightnessCurveHsl", false, false, 0)}
                {plainView ? curve("hueCurve", true, true, 0.5, true) : null}
                {choice("gamma", GAMMA_OPTIONS)}
                {p.gamma === "free" ? (
                  <>
                    {slider("gammaValue")}
                    {slider("gammaSlope")}
                  </>
                ) : null}
              </Stack>
            </Section>
          ) : null}
          {advanced && !maskOrUnsharp ? (
            <Section title="Tone mapping">
              <Stack gap={6}>
                {slider("iterations")}
                {gradient("scaleGradient")}
                {gradient("transmissionGradient")}
                {gradient("strengthGradient")}
              </Stack>
            </Section>
          ) : null}
          <Section title="Transmission">
            <Stack gap={6}>
              {advanced && !maskOrUnsharp ? curve("transmissionCurve", true, false, 0) : null}
              {slider("scales")}
              {!maskOrUnsharp ? slider("threshold") : null}
              {advanced && !maskOrUnsharp ? (
                <Toggle
                  checked={p.median}
                  label={LABELS.median}
                  onChange={(checked) => {
                    write({ ...current(), median: checked }, ["median"]);
                    commit(LABELS.median.toLowerCase());
                  }}
                />
              ) : null}
            </Stack>
          </Section>
          <Section title="Gain and offset">
            <Stack gap={6}>
              {curve("gainCurve", true, false, 0)}
              {plainView ? slider("offset") : null}
            </Stack>
          </Section>
        </Stack>
      </Section>
      <Button
        size="sm"
        onClick={() => {
          const next: Params = { ...DEFAULT_PARAMS, on: current().on, advanced: current().advanced };
          write(next, Object.keys(DEFAULT_PARAMS).filter((k) => k !== "on" && k !== "advanced") as EditKey[]);
          setView("standard");
          commit("reset");
        }}
      >
        Reset
      </Button>
    </Stack>
  );
}

function pick(p: Params, keys: readonly EditKey[]): Partial<Params> {
  const out: Partial<Params> = {};
  for (const key of keys) (out as Record<string, unknown>)[key] = p[key];
  return out;
}
