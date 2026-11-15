// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// A curve graph in Colour Zones' look: a grid with the identity drawn faint,
// the curve as the passes apply it (curve-edit.ts curveFunction, RawTherapee's
// own interpolation), its nodes, and under a hue curve a bar of hues. Hover
// picks the node within reach, a drag moves it, a click away from every node
// adds one there, right-click removes the hovered node, and double-click
// resets the curve. With the graph focused, the arrow keys move the selected
// node and Delete removes it. Flat curves show the selected node's tangents.
// The gestures are the original's curve editors'.

import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { KEY_STEP, addNode, curveFunction, moveNode, nodesOf, removeNode, setTangents } from "./curve-edit";
import { React, api } from "./rt";

const WIDTH = 252;
const HEIGHT = 168;
const INSET = 8;
const BAR = 8;
const SAMPLES = 256;
const REACH = 8;

export interface GraphProps {
  label: string;
  curve: readonly number[];
  flat: boolean;
  periodic: boolean;
  /** The value that changes nothing (diagonal curves: the diagonal). */
  identity: number;
  hueBar?: boolean;
  onChange: (curve: number[]) => void;
  onCommit: () => void;
  onReset: () => void;
}

const plotW = WIDTH - 2 * INSET;

const sameCurve = (a: readonly number[], b: readonly number[] | null): boolean => b !== null && a.length === b.length && a.every((v, i) => v === b[i]);

function hueColour(h: number): string {
  return `hsl(${Math.round(h * 360)}, 55%, 50%)`;
}

export function CurveGraph(props: GraphProps) {
  const { curve, flat, periodic, identity, hueBar } = props;
  const height = HEIGHT + (hueBar ? BAR + 4 : 0);
  const plotH = HEIGHT - 2 * INSET;
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = React.useState(-1);
  const [selected, setSelected] = React.useState(-1);
  const drag = React.useRef<{ node: number; moved: boolean } | null>(null);
  const own = React.useRef<readonly number[] | null>(null);
  const seen = React.useRef<readonly number[]>(curve);
  const nodes = nodesOf(curve, flat);
  const value = curveFunction(curve, flat, periodic, identity);

  // A curve from elsewhere (undo, a preset, a reset) drops the selection.
  React.useEffect(() => {
    if (sameCurve(curve, seen.current)) return;
    seen.current = curve;
    if (sameCurve(curve, own.current)) return;
    drag.current = null;
    setSelected(-1);
    setHover(-1);
  });

  const change = (next: number[]) => {
    own.current = next;
    props.onChange(next);
  };

  const toPlot = (x: number, y: number): [number, number] => [INSET + x * plotW, INSET + (1 - y) * plotH];
  const fromEvent = (e: MouseEvent<HTMLCanvasElement>): [number, number] | null => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    const sx = WIDTH / r.width;
    const sy = height / r.height;
    return [((e.clientX - r.left) * sx - INSET) / plotW, 1 - ((e.clientY - r.top) * sy - INSET) / plotH];
  };
  const nearest = (x: number, y: number): number => {
    let best = -1;
    let dist = REACH;
    nodes.forEach((n, k) => {
      const [px, py] = toPlot(n.x, n.y);
      const [qx, qy] = toPlot(x, y);
      const d = Math.hypot(px - qx, py - qy);
      if (d < dist) {
        dist = d;
        best = k;
      }
    });
    return best;
  };

  React.useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fillRect(INSET, INSET, plotW, plotH);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.beginPath();
    for (let k = 1; k < 4; k++) {
      const [x] = toPlot(k / 4, 0);
      const [, y] = toPlot(0, k / 4);
      ctx.moveTo(x, INSET);
      ctx.lineTo(x, INSET + plotH);
      ctx.moveTo(INSET, y);
      ctx.lineTo(INSET + plotW, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    if (flat) {
      const [, y] = toPlot(0, identity);
      ctx.moveTo(INSET, y);
      ctx.lineTo(INSET + plotW, y);
    } else {
      ctx.moveTo(...toPlot(0, 0));
      ctx.lineTo(...toPlot(1, 1));
    }
    ctx.stroke();
    const path = new Path2D();
    for (let k = 0; k < SAMPLES; k++) {
      const x = k / (SAMPLES - 1);
      const [px, py] = toPlot(x, Math.min(Math.max(value(x), 0), 1));
      if (k === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.stroke(path);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(240, 240, 240, 0.95)";
    ctx.stroke(path);
    nodes.forEach((n, k) => {
      const [px, py] = toPlot(n.x, n.y);
      const lit = k === hover || k === selected;
      ctx.beginPath();
      ctx.arc(px, py, lit ? 5 : 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = lit ? "rgba(240, 240, 240, 1)" : "rgba(30, 30, 30, 0.9)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = lit ? "rgba(30, 30, 30, 0.9)" : "rgba(240, 240, 240, 0.95)";
      ctx.stroke();
    });
    if (hueBar) {
      const cells = 48;
      for (let i = 0; i < cells; i++) {
        ctx.fillStyle = hueColour((i + 0.5) / cells);
        ctx.fillRect(INSET + (i * plotW) / cells, HEIGHT + 2, plotW / cells + 0.5, BAR);
      }
    }
  });

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = fromEvent(e);
    if (e.button !== 0 || !at) return;
    const [x, y] = at;
    const k = nearest(x, y);
    if (k >= 0) {
      drag.current = { node: k, moved: false };
      setSelected(k);
    } else if (nodes.length > 0 || flat) {
      const added = addNode(curve, flat, x, y);
      if (added.index < 0) return;
      change(added.curve);
      drag.current = { node: added.index, moved: true };
      setSelected(added.index);
    } else return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = fromEvent(e);
    if (!at) return;
    const [x, y] = at;
    const d = drag.current;
    if (!d) {
      setHover(nearest(x, y));
      return;
    }
    d.moved = true;
    change(moveNode(curve, flat, d.node, x, y));
  };
  // Release, cancel and a lost capture all end the drag.
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) props.onCommit();
  };
  const remove = (k: number) => {
    change(removeNode(curve, flat, k));
    props.onCommit();
    setSelected(-1);
    setHover(-1);
  };
  const onContextMenu = (e: MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const at = fromEvent(e);
    const k = at ? nearest(at[0], at[1]) : -1;
    if (k >= 0) remove(k);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const k = selected >= 0 ? selected : hover;
    const n = nodes[k];
    if (!n || drag.current) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(k);
      return;
    }
    const step = { ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP], ArrowRight: [KEY_STEP, 0], ArrowLeft: [-KEY_STEP, 0] }[e.key];
    if (!step) return;
    e.preventDefault();
    setSelected(k);
    change(moveNode(curve, flat, k, n.x + step[0], n.y + step[1]));
    props.onCommit();
  };

  const { NumberInput, Row } = api.ui;
  const node = flat && selected >= 0 ? nodes[selected] : undefined;
  return (
    <div>
      <canvas
        ref={ref}
        width={WIDTH}
        height={height}
        role="img"
        aria-label={props.label}
        tabIndex={0}
        style={{ width: "100%", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onPointerLeave={() => {
          if (!drag.current) setHover(-1);
        }}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          setSelected(-1);
          props.onReset();
        }}
      />
      {node ? (
        <Row gap={6}>
          <NumberInput
            aria-label="Left tangent"
            value={node.left}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => {
              change(setTangents(curve, selected, v, node.right));
              props.onCommit();
            }}
          />
          <NumberInput
            aria-label="Right tangent"
            value={node.right}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => {
              change(setTangents(curve, selected, node.left, v));
              props.onCommit();
            }}
          />
        </Row>
      ) : null}
    </div>
  );
}
