// The curve graph (src/Graph.tsx): a click adds a node and a drag moves it,
// one commit a gesture, whether the pointer is released, cancelled or loses
// its capture; right-click and Delete remove a node, the arrow keys move it,
// double-click resets; a flat node's tangents; a curve changed from elsewhere
// drops the selection; a canvas with no size takes no gesture.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DCT, FCT } from "../src/curves";
import { KEY_STEP, nodesOf, startCurve } from "../src/curve-edit";
import { CurveGraph } from "../src/Graph";
import { React, initRuntime } from "../src/rt";
import { fakeApi } from "./support/fake-api";

const WIDTH = 252;
const HEIGHT = 168;
const INSET = 8;
const plotW = WIDTH - 2 * INSET;
const plotH = HEIGHT - 2 * INSET;

beforeAll(() => {
  initRuntime(fakeApi().api);
  const context = new Proxy({}, { get: (_t, key) => (key === "canvas" ? null : () => undefined), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
  vi.stubGlobal(
    "Path2D",
    class {
      moveTo(): void {}
      lineTo(): void {}
    },
  );
});

afterEach(cleanup);

function setup(start: number[], flat: boolean, size = { width: WIDTH, height: HEIGHT }) {
  const changes: number[][] = [];
  let commits = 0;
  let resets = 0;
  let setOutside: (c: number[]) => void = () => undefined;
  function Harness() {
    const [curve, setCurve] = React.useState(start);
    setOutside = setCurve;
    return (
      <CurveGraph
        label="Curve"
        curve={curve}
        flat={flat}
        periodic={false}
        identity={flat ? 0.5 : 0}
        onChange={(next) => {
          changes.push(next);
          setCurve(next);
        }}
        onCommit={() => void commits++}
        onReset={() => {
          resets++;
          setCurve(start);
        }}
      />
    );
  }
  render(<Harness />);
  const canvas = screen.getByLabelText("Curve") as HTMLCanvasElement;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: size.width, bottom: size.height, x: 0, y: 0, width: size.width, height: size.height, toJSON: () => ({}) }) as DOMRect;
  const at = (x: number, y: number) => ({ clientX: INSET + x * plotW, clientY: INSET + (1 - y) * plotH, pointerId: 1 });
  return {
    canvas,
    at,
    changes,
    commits: () => commits,
    resets: () => resets,
    last: () => changes.at(-1) ?? start,
    outside: (c: number[]) => act(() => setOutside(c)),
  };
}

const diagonal = startCurve(DCT.spline, false, 0);
const flat = startCurve(FCT.controlPoints, true, 0.5);

describe("the curve graph", () => {
  it("adds a node where a click lands and commits when the gesture ends", () => {
    const g = setup(diagonal, false);
    fireEvent.pointerDown(g.canvas, { ...g.at(0.25, 0.6), button: 0 });
    expect(nodesOf(g.last(), false).map((n) => n.x)).toEqual([0, 0.25, 0.5, 1]);
    expect(g.commits()).toBe(0);
    fireEvent.pointerUp(g.canvas, g.at(0.25, 0.6));
    expect(g.commits()).toBe(1);
  });

  it("takes no node from a click in the margin on top of an end node", () => {
    const g = setup(diagonal, false);
    fireEvent.pointerDown(g.canvas, { clientX: 2, clientY: 60, pointerId: 1, button: 0 });
    expect(g.changes).toEqual([]);
  });

  it("drags a node and commits once, also when the pointer is cancelled or loses its capture", () => {
    for (const end of ["pointerUp", "pointerCancel", "lostPointerCapture"] as const) {
      const g = setup(diagonal, false);
      fireEvent.pointerDown(g.canvas, { ...g.at(0.5, 0.5), button: 0 });
      fireEvent.pointerMove(g.canvas, g.at(0.6, 0.7));
      fireEvent.pointerMove(g.canvas, g.at(0.62, 0.72));
      fireEvent[end](g.canvas, g.at(0.62, 0.72));
      fireEvent.pointerMove(g.canvas, g.at(0.9, 0.1));
      const moved = nodesOf(g.last(), false)[1];
      expect(moved.x).toBeCloseTo(0.62, 6);
      expect(moved.y).toBeCloseTo(0.72, 6);
      expect(g.commits()).toBe(1);
      cleanup();
    }
  });

  it("removes the node under a right-click", () => {
    const g = setup(diagonal, false);
    fireEvent.contextMenu(g.canvas, g.at(0.5, 0.5));
    expect(nodesOf(g.last(), false).map((n) => n.x)).toEqual([0, 1]);
    expect(g.commits()).toBe(1);
  });

  it("resets on double-click", () => {
    const g = setup(diagonal, false);
    fireEvent.doubleClick(g.canvas, g.at(0.3, 0.3));
    expect(g.resets()).toBe(1);
  });

  it("moves the selected node with the arrow keys and removes it with Delete, a commit each", () => {
    const g = setup(diagonal, false);
    expect(g.canvas.tabIndex).toBe(0);
    fireEvent.pointerDown(g.canvas, { ...g.at(0.5, 0.5), button: 0 });
    fireEvent.pointerUp(g.canvas, g.at(0.5, 0.5));
    fireEvent.keyDown(g.canvas, { key: "ArrowUp" });
    fireEvent.keyDown(g.canvas, { key: "ArrowLeft" });
    const n = nodesOf(g.last(), false)[1];
    expect(n.x).toBeCloseTo(0.5 - KEY_STEP, 9);
    expect(n.y).toBeCloseTo(0.5 + KEY_STEP, 9);
    expect(g.commits()).toBe(2);
    fireEvent.keyDown(g.canvas, { key: "Delete" });
    expect(nodesOf(g.last(), false)).toHaveLength(2);
    expect(g.commits()).toBe(3);
  });

  it("shows a selected flat node's tangents and writes them in range", () => {
    const g = setup(flat, true);
    expect(screen.queryByLabelText("Left tangent")).toBeNull();
    fireEvent.pointerDown(g.canvas, { ...g.at(0.5, 0.5), button: 0 });
    fireEvent.pointerUp(g.canvas, g.at(0.5, 0.5));
    fireEvent.change(screen.getByLabelText("Left tangent"), { target: { value: "0.2" } });
    fireEvent.change(screen.getByLabelText("Right tangent"), { target: { value: "1.5" } });
    expect(nodesOf(g.last(), true)[1]).toMatchObject({ left: 0.2, right: 1 });
    expect(g.commits()).toBe(2);
  });

  it("drops the selection when the curve changes from elsewhere, and keeps it through its own edits", () => {
    const g = setup(flat, true);
    fireEvent.pointerDown(g.canvas, { ...g.at(0.5, 0.5), button: 0 });
    fireEvent.pointerUp(g.canvas, g.at(0.5, 0.5));
    fireEvent.change(screen.getByLabelText("Left tangent"), { target: { value: "0.2" } });
    expect(screen.queryByLabelText("Left tangent")).not.toBeNull();
    g.outside([FCT.controlPoints, 0, 0.5, 0.35, 0.35, 1, 0.5, 0.35, 0.35]);
    expect(screen.queryByLabelText("Left tangent")).toBeNull();
  });

  it("takes no gesture on a canvas with no size", () => {
    const g = setup(diagonal, false, { width: 0, height: 0 });
    fireEvent.pointerDown(g.canvas, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.contextMenu(g.canvas, { clientX: 10, clientY: 10 });
    expect(g.changes).toEqual([]);
  });
});
