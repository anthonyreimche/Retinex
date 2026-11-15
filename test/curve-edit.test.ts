// The graph's gestures on a curve as its profile lists it (src/curve-edit.ts):
// nodes added inside the unit square and never on top of another, the node
// limits the bag's packed lists hold, the last nodes kept, a dragged node kept
// between its neighbours, and tangents in range.

import { describe, expect, it } from "vitest";
import { DCT, FCT } from "../src/curves";
import { MAX_NODES, MIN_GAP, addNode, moveNode, nodesOf, removeNode, setTangents, startCurve, withNodes } from "../src/curve-edit";

const diagonal = startCurve(DCT.spline, false, 0);
const flat = startCurve(FCT.controlPoints, true, 0.5);

function spread(count: number, isFlat: boolean): number[] {
  const nodes = Array.from({ length: count }, (_, i) => ({ x: i / (count - 1), y: 0.5, left: 0.35, right: 0.35 }));
  return withNodes(isFlat ? FCT.controlPoints : DCT.spline, nodes, isFlat);
}

describe("adding a node", () => {
  it("adds one where the click is and says where it went", () => {
    const added = addNode(diagonal, false, 0.25, 0.4);
    expect(added.index).toBe(1);
    expect(nodesOf(added.curve, false).map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [0.25, 0.4],
      [0.5, 0.5],
      [1, 1],
    ]);
  });

  it("clamps a click in the margin into the square, and refuses it on top of an end node", () => {
    expect(addNode(diagonal, false, -0.05, 0.2)).toEqual({ curve: diagonal, index: -1 });
    expect(addNode(diagonal, false, 1.08, 0.9)).toEqual({ curve: diagonal, index: -1 });
    const open = withNodes(FCT.controlPoints, nodesOf(flat, true).slice(0, 2), true);
    const added = addNode(open, true, 1.2, -0.3);
    expect(nodesOf(added.curve, true).at(-1)).toEqual({ x: 1, y: 0, left: 0.35, right: 0.35 });
  });

  it("keeps the least gap to every node", () => {
    expect(addNode(diagonal, false, 0.5 + MIN_GAP / 2, 0.3).index).toBe(-1);
    expect(addNode(diagonal, false, 0.5 + 2 * MIN_GAP, 0.3).index).toBe(2);
  });

  it("stops at the nodes the bag holds: 33 on a diagonal curve, 24 on a flat one", () => {
    expect(MAX_NODES).toEqual({ diagonal: 33, flat: 24 });
    expect(addNode(spread(32, false), false, 0.01, 0.5).index).toBeGreaterThan(-1);
    expect(addNode(spread(33, false), false, 0.01, 0.5).index).toBe(-1);
    expect(addNode(spread(23, true), true, 0.01, 0.5).index).toBeGreaterThan(-1);
    expect(addNode(spread(24, true), true, 0.01, 0.5).index).toBe(-1);
  });
});

describe("removing a node", () => {
  it("keeps two nodes on a diagonal curve and one on a flat one", () => {
    const two = removeNode(diagonal, false, 1);
    expect(nodesOf(two, false)).toHaveLength(2);
    expect(removeNode(two, false, 0)).toEqual(two);
    const one = removeNode(removeNode(flat, true, 0), true, 0);
    expect(nodesOf(one, true)).toHaveLength(1);
    expect(removeNode(one, true, 0)).toEqual(one);
  });
});

describe("moving a node", () => {
  it("keeps it between its neighbours and in the square", () => {
    const moved = moveNode(diagonal, false, 1, 1.5, 1.4);
    expect(nodesOf(moved, false)[1]).toMatchObject({ x: 1 - MIN_GAP, y: 1 });
    const back = moveNode(diagonal, false, 1, -2, -1);
    expect(nodesOf(back, false)[1]).toMatchObject({ x: MIN_GAP, y: 0 });
    expect(moveNode(diagonal, false, 0, 0.6, 0.3)).toEqual([DCT.spline, 0.5 - MIN_GAP, 0.3, 0.5, 0.5, 1, 1]);
  });

  it("leaves the curve alone for a node it doesn't have", () => {
    expect(moveNode(diagonal, false, 7, 0.3, 0.3)).toEqual(diagonal);
  });
});

describe("tangents", () => {
  it("keeps a flat node's tangents in 0…1", () => {
    const set = setTangents(flat, 1, -0.2, 1.7);
    expect(nodesOf(set, true)[1]).toMatchObject({ left: 0, right: 1 });
    expect(setTangents(flat, 9, 0.1, 0.1)).toEqual(flat);
  });
});
