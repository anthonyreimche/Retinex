// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The processing stage: three passes (glsl.ts) and the inline that moves lin
// by their result. RawTherapee runs Retinex on the demosaiced data ahead of
// white balance, the colour matrix and exposure, so the stage sits in the
// decode phase, after the demosaic-level fixes (lens CA 0, raw denoise 5,
// capture sharpening 10/11, moiré 50) and ahead of the wavelet denoiser (60).

import { DERIVED_SIZES, RANGES } from "./model";
import { INLINE_HELPERS, inlineGlsl, passProgram, type PassId } from "./glsl";
import { CHOICES, CHOICE_KEYS, CURVE_KEYS, DRAW_KEYS, NUMERIC_KEYS, STAGE_ID, SWITCH_KEYS, VIEW_KEY, VIEW_P1_KEY, bagValue, curveVec4 } from "./params";
import { DEFAULT_PARAMS } from "./model";
import type { ProcessingStageContribution, StagePass, UniformDeclaration } from "./safelight";

export const PRIORITY = 55;
/** The most draws a pass takes (the host's cap). */
export const MAX_DRAWS = 1024;

/** The host's name for a stage's result sampler, `u_{hash}_stageResult`
 *  (shader-compiler.ts hashStageId). */
export function resultSampler(stageId: string): string {
  let h = 0;
  for (let i = 0; i < stageId.length; i++) h = ((h << 5) - h + stageId.charCodeAt(i)) | 0;
  return `u_${(h >>> 0).toString(36).slice(0, 4)}_stageResult`;
}

/** The labels the stage's uniforms carry (the panel's). */
export const LABELS: Record<string, string> = {
  on: "Enabled",
  advanced: "Advanced",
  median: "Transmission median filter",
  method: "Method",
  space: "Colour space",
  gamma: "Gamma",
  maskMethod: "Mask method",
  strength: "Strength",
  radius: "Radius",
  contrast: "Contrast",
  highlightThreshold: "Highlight threshold",
  protectFrom: "Protect from",
  protectSoftness: "Softness",
  protectAmount: "Protection",
  maskHighlights: "Highlights",
  maskHighlightsWidth: "Highlights tonal width",
  maskShadows: "Shadows",
  maskShadowsWidth: "Shadows tonal width",
  maskRadius: "Mask radius",
  gammaValue: "Free gamma",
  gammaSlope: "Free gamma slope",
  iterations: "Iterations",
  scaleGradient: "Gaussian gradient",
  transmissionGradient: "Transmission gradient",
  strengthGradient: "Strength gradient",
  scales: "Scale",
  threshold: "Threshold",
  offset: "Offset",
  lightnessCurve: "L=f(L)",
  lightnessCurveHsl: "L=f(L), HSL",
  maskCurve: "Mask L=f(L)",
  hueCurve: "Strength=f(H)",
  transmissionCurve: "Transmission map",
  gainCurve: "Gain transmission",
};

function editUniforms(): UniformDeclaration[] {
  const out: UniformDeclaration[] = [];
  for (const key of SWITCH_KEYS) out.push({ key, glslType: "bool", default: DEFAULT_PARAMS[key], label: LABELS[key] });
  for (const key of CHOICE_KEYS) {
    out.push({ key, glslType: "int", default: bagValue(DEFAULT_PARAMS, key) as number, range: { min: 0, max: CHOICES[key].length - 1, step: 1 }, label: LABELS[key] });
  }
  for (const key of NUMERIC_KEYS) out.push({ key, glslType: "float", default: DEFAULT_PARAMS[key], range: { ...RANGES[key] }, label: LABELS[key] });
  for (const key of CURVE_KEYS) out.push({ key, glslType: "vec4", length: curveVec4(key), default: bagValue(DEFAULT_PARAMS, key) as number[], label: LABELS[key] });
  for (const key of DRAW_KEYS) out.push({ key, glslType: "int", default: 0 });
  return out;
}

const derived = (key: string): UniformDeclaration => {
  const n = DERIVED_SIZES[key];
  return n === 1 ? { key, glslType: "vec4", default: [0, 0, 0, 0] } : { key, glslType: "vec4", length: n, default: new Array<number>(4 * n).fill(0) };
};

const view = (id: PassId): UniformDeclaration => ({ key: id === 1 ? VIEW_P1_KEY : VIEW_KEY, glslType: "int", default: 0 });

/** What each pass reads: a change to one of these reruns that pass. */
export const PASS_KEYS: Record<PassId, readonly string[]> = {
  1: ["rtIt1", "rtMask", "rtConv", "rtGammaIn", "rtCd", "rtCdEnds", "rtMap", "rtMapEnds", "rtTransA", "rtTransB"],
  2: ["rtIters", "rtFlags", "rtProtect", "rtConv", "rtGammaIn", "rtTransA", "rtTransB", "rtGainA", "rtGainB", "rtHue"],
  3: ["rtIters", "rtFlags", "rtProtect", "rtConv", "rtGammaIn", "rtGammaOut", "rtGainA", "rtGainB", "rtHue"],
};

const DRAW_OF: Record<PassId, (typeof DRAW_KEYS)[number]> = { 1: "p1Draws", 2: "p2Draws", 3: "p3Draws" };

function pass(id: PassId): StagePass {
  const program = passProgram(id);
  return {
    channels: 4,
    glsl: program.glsl,
    helpers: program.helpers,
    region: program.region,
    iterations: { key: DRAW_OF[id], max: MAX_DRAWS },
    uniforms: [...PASS_KEYS[id].map(derived), view(id)],
    ...(id === 1 ? { keep: true } : {}),
  };
}

export function retinexStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Retinex",
    phase: "decode",
    priority: PRIORITY,
    reads: "current",
    glsl: inlineGlsl(resultSampler(STAGE_ID)),
    helpers: INLINE_HELPERS,
    uniforms: editUniforms(),
    passes: [pass(1), pass(2), pass(3)],
    dormantWhen: { p1Draws: 0, p2Draws: 0, p3Draws: 0 },
    presetScope: "global",
  };
}
