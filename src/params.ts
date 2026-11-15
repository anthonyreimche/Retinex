// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The param-bag contract. The edit sits under the stage's qualified keys:
// switches as booleans, choices as their index, sliders as RawTherapee's
// numbers, curves as fixed-size number lists (type, count, then the points as
// RawTherapee's profile lists them). Derived keys hold the pass draw counts
// and what the passes read (model.ts derive); they are written only while
// the tool is on, and re-derived whenever they disagree with the edit.

import {
  DEFAULT_PARAMS,
  DIAGONAL_CURVES,
  FLAT_CURVES,
  GAMMAS,
  MASKS,
  METHODS,
  RANGES,
  SPACES,
  derive,
  drawCounts,
  type CurveKey,
  type NumericKey,
  type Params,
} from "./model";
import { DCT, FCT } from "./curves";
import { nodesOf, withNodes } from "./curve-edit";

export const EXT_ID = "retinex";
export const STAGE_ID = `${EXT_ID}.msr`;

export const NUMERIC_KEYS = Object.keys(RANGES) as NumericKey[];
export const CHOICE_KEYS = ["method", "space", "gamma", "maskMethod"] as const;
export type ChoiceKey = (typeof CHOICE_KEYS)[number];
export const SWITCH_KEYS = ["on", "advanced", "median"] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];
export const CURVE_KEYS: readonly CurveKey[] = [...DIAGONAL_CURVES, ...FLAT_CURVES];

export type EditKey = keyof Params;
export const EDIT_KEYS: readonly EditKey[] = [...SWITCH_KEYS, ...CHOICE_KEYS, ...NUMERIC_KEYS, ...CURVE_KEYS];

export type DrawKey = "p1Draws" | "p2Draws" | "p3Draws";
export const DRAW_KEYS: readonly DrawKey[] = ["p1Draws", "p2Draws", "p3Draws"];

/** The view value's key (api.develop.setViewValues): what P2 and P3 read. */
export const VIEW_KEY = "view";
/** The view as P1 reads it: the view with one iteration, else Standard, so
 *  that a view change with more iterations leaves P1's kept result alone. */
export const VIEW_P1_KEY = "viewP1";

export const CHOICES: Record<ChoiceKey, readonly string[]> = {
  method: METHODS,
  space: SPACES,
  gamma: GAMMAS,
  maskMethod: MASKS,
};

/** Packed sizes: vec4 counts of a diagonal and a flat curve. */
export const DIAGONAL_VEC4 = 17;
export const FLAT_VEC4 = 25;
export const isFlat = (key: CurveKey): boolean => (FLAT_CURVES as readonly string[]).includes(key);
export const curveVec4 = (key: CurveKey): number => (isFlat(key) ? FLAT_VEC4 : DIAGONAL_VEC4);

/** A curve as the bag keeps it: type, value count, values, zeros. */
export function packCurve(key: CurveKey, curve: readonly number[]): number[] {
  const size = 4 * curveVec4(key);
  const values = curve.slice(1, size - 1);
  const out = [curve[0] ?? 0, values.length, ...values];
  while (out.length < size) out.push(0);
  return out;
}

/** A packed curve back in RawTherapee's layout, or null when malformed. A
 *  curve the editor couldn't have made is put in order: nodes clamped to the
 *  unit square, sorted, one per x; an unknown type or too few nodes is null. */
export function unpackCurve(key: CurveKey, packed: unknown): number[] | null {
  if (!Array.isArray(packed) || packed.length !== 4 * curveVec4(key)) return null;
  if (!packed.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const count = Math.max(0, Math.min(Math.trunc(packed[1]), packed.length - 2));
  const type = packed[0];
  const values = packed.slice(2, 2 + count);
  const flat = isFlat(key);
  if (flat ? type === FCT.linear : type === DCT.linear) return [type];
  if (!(flat ? [FCT.controlPoints] : [DCT.spline, DCT.parametric, DCT.nurbs, DCT.catmullRom]).includes(type)) return null;
  if (type === DCT.parametric && !flat) return values.length >= 7 ? [type, ...values] : null;
  const clamp = (v: number): number => Math.min(Math.max(v, 0), 1);
  const nodes = nodesOf([type, ...values], flat)
    .map((n) => ({ x: clamp(n.x), y: clamp(n.y), left: clamp(n.left), right: clamp(n.right) }))
    .sort((a, b) => a.x - b.x)
    .filter((n, i, all) => i === 0 || n.x > all[i - 1].x);
  return nodes.length >= (flat ? 1 : 2) ? withNodes(type, nodes, flat) : null;
}

export const qualified = (key: string): string => `${STAGE_ID}.${key}`;

type Bag = Readonly<Record<string, unknown>>;
export type Patch = Record<string, number | boolean | number[] | undefined>;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The edit in `bag`; a missing or malformed value reads as the default. */
export function readParams(bag: Bag): Params {
  const out: Params = { ...DEFAULT_PARAMS };
  for (const key of SWITCH_KEYS) {
    const v = bag[qualified(key)];
    if (typeof v === "boolean") out[key] = v;
    else if (finite(v)) out[key] = v >= 0.5;
  }
  for (const key of CHOICE_KEYS) {
    const v = bag[qualified(key)];
    const options = CHOICES[key];
    const index = finite(v) ? Math.round(v) : -1;
    if (index >= 0 && index < options.length) (out[key] as string) = options[index];
  }
  for (const key of NUMERIC_KEYS) {
    const v = bag[qualified(key)];
    if (finite(v)) out[key] = Math.min(Math.max(v, RANGES[key].min), RANGES[key].max);
  }
  for (const key of CURVE_KEYS) {
    const curve = unpackCurve(key, bag[qualified(key)]);
    if (curve) out[key] = curve;
  }
  return out;
}

/** A param as the bag holds it. */
export function bagValue(p: Params, key: EditKey): number | boolean | number[] {
  if ((SWITCH_KEYS as readonly string[]).includes(key)) return p[key as SwitchKey];
  if ((CHOICE_KEYS as readonly string[]).includes(key)) return CHOICES[key as ChoiceKey].indexOf(p[key as ChoiceKey]);
  if ((CURVE_KEYS as readonly string[]).includes(key)) return packCurve(key as CurveKey, p[key as CurveKey]);
  return p[key as NumericKey];
}

/** The draw counts and, while on, every derived value; off clears them. */
export function derivedPatch(p: Params): Patch {
  const counts = drawCounts(p);
  const out: Patch = {};
  for (const key of DRAW_KEYS) out[qualified(key)] = counts[key];
  const derived = p.on ? derive(p) : null;
  for (const key of Object.keys(DERIVED_KEYS_REF)) out[qualified(key)] = derived ? derived[key] : undefined;
  return out;
}

const DERIVED_KEYS_REF = derive({ ...DEFAULT_PARAMS, on: true });

/** The derived keys, in a stable order. */
export const DERIVED_KEYS: readonly string[] = Object.keys(DERIVED_KEYS_REF);

/** The whole edit and what it derives. */
export function bagPatch(p: Params): Patch {
  const out: Patch = {};
  for (const key of EDIT_KEYS) out[qualified(key)] = bagValue(p, key);
  return { ...out, ...derivedPatch(p) };
}

/** `keys` of `p` and the derived values `p` needs: what a control writes. */
export function editPatch(p: Params, keys: readonly EditKey[]): Patch {
  const out: Patch = {};
  for (const key of keys) out[qualified(key)] = bagValue(p, key);
  return { ...out, ...derivedPatch(p) };
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || Math.abs(v - b[i]) < 1e-9);
  return a === b;
};

/** The derived values the bag's edit needs, when the bag holds others. */
export function rederivePatch(bag: Bag): Patch | null {
  if (![...EDIT_KEYS, ...DRAW_KEYS].some((key) => qualified(key) in bag)) return null;
  const want = derivedPatch(readParams(bag));
  return Object.entries(want).every(([key, value]) => sameValue(bag[key], value)) ? null : want;
}

export const resetPatch = (): Patch => bagPatch(DEFAULT_PARAMS);
