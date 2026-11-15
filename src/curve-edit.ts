// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// Editing a RawTherapee curve as its profile lists it: the graph's gestures
// (move, add, remove a node, set a flat node's tangents), switching a curve's
// type, and the curve as the graph draws it, through curves.ts, so what is
// drawn is what is applied.

import { DCT, DiagonalCurve, FCT, FlatCurve } from "./curves";

export interface Node {
  x: number;
  y: number;
  /** Flat curves: the node's left and right tangents. */
  left: number;
  right: number;
}

/** Node lists by curve kind; parametric curves have none. */
export function nodesOf(curve: readonly number[], flat: boolean): Node[] {
  const type = curve[0] ?? 0;
  if (flat) {
    if (type !== FCT.controlPoints) return [];
    const out: Node[] = [];
    for (let i = 1; i + 3 < curve.length; i += 4) out.push({ x: curve[i], y: curve[i + 1], left: curve[i + 2], right: curve[i + 3] });
    return out;
  }
  if (type === DCT.linear || type === DCT.parametric) return [];
  const out: Node[] = [];
  for (let i = 1; i + 1 < curve.length; i += 2) out.push({ x: curve[i], y: curve[i + 1], left: 0, right: 0 });
  return out;
}

export function withNodes(type: number, nodes: readonly Node[], flat: boolean): number[] {
  const sorted = [...nodes].sort((a, b) => a.x - b.x);
  return [type, ...sorted.flatMap((n) => (flat ? [n.x, n.y, n.left, n.right] : [n.x, n.y]))];
}

/** The curve a type switch starts from: RawTherapee's editors start a custom
 *  curve on the diagonal and a flat one level at its identity value. */
export function startCurve(type: number, flat: boolean, identity: number): number[] {
  if (flat) {
    if (type !== FCT.controlPoints) return [FCT.linear];
    return [FCT.controlPoints, 0, identity, 0.35, 0.35, 0.5, identity, 0.35, 0.35, 1, identity, 0.35, 0.35];
  }
  if (type === DCT.linear) return [DCT.linear];
  if (type === DCT.parametric) return [DCT.parametric, 0.25, 0.5, 0.75, 0, 0, 0, 0];
  return [type, 0, 0, 0.5, 0.5, 1, 1];
}

/** Max nodes the bag's packed list holds. */
export const MAX_NODES = { flat: 24, diagonal: 33 } as const;

/** The least distance in x between two nodes. */
export const MIN_GAP = 1e-3;

/** How far an arrow key moves a node. */
export const KEY_STEP = 0.01;

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** Node k moved to (x, y), kept between its neighbours. */
export function moveNode(curve: readonly number[], flat: boolean, k: number, x: number, y: number): number[] {
  const nodes = nodesOf(curve, flat);
  if (!nodes[k]) return [...curve];
  const lo = k > 0 ? nodes[k - 1].x + MIN_GAP : 0;
  const hi = k < nodes.length - 1 ? nodes[k + 1].x - MIN_GAP : 1;
  nodes[k] = { ...nodes[k], x: Math.min(Math.max(x, lo), hi), y: clamp01(y) };
  return withNodes(curve[0], nodes, flat);
}

/** A node added at (x, y), clamped to the unit square; its index in the new
 *  curve, or -1 when the curve is full or a node sits within MIN_GAP of x. */
export function addNode(curve: readonly number[], flat: boolean, x: number, y: number): { curve: number[]; index: number } {
  const nodes = nodesOf(curve, flat);
  const at = clamp01(x);
  if (nodes.length >= (flat ? MAX_NODES.flat : MAX_NODES.diagonal) || nodes.some((n) => Math.abs(n.x - at) < MIN_GAP)) return { curve: [...curve], index: -1 };
  const node: Node = { x: at, y: clamp01(y), left: 0.35, right: 0.35 };
  const next = withNodes(curve[0], [...nodes, node], flat);
  return { curve: next, index: nodesOf(next, flat).findIndex((n) => n.x === node.x) };
}

/** Node k removed; a diagonal curve keeps two, a flat one one. */
export function removeNode(curve: readonly number[], flat: boolean, k: number): number[] {
  const nodes = nodesOf(curve, flat);
  if (nodes.length <= (flat ? 1 : 2)) return [...curve];
  return withNodes(curve[0], nodes.filter((_, i) => i !== k), flat);
}

/** A flat node's tangents. */
export function setTangents(curve: readonly number[], k: number, left: number, right: number): number[] {
  const nodes = nodesOf(curve, true);
  if (!nodes[k]) return [...curve];
  nodes[k] = { ...nodes[k], left: clamp01(left), right: clamp01(right) };
  return withNodes(curve[0], nodes, true);
}

/** The value a curve gives at x ∈ [0, 1], as the passes apply it. */
export function curveFunction(curve: readonly number[], flat: boolean, periodic: boolean, identity: number): (x: number) => number {
  if (flat) {
    const c = new FlatCurve(curve, periodic, periodic ? 1000 : 500);
    c.setIdentityValue(identity);
    return (x) => c.getVal(x);
  }
  const c = new DiagonalCurve(curve);
  return (x) => c.getVal(x);
}
