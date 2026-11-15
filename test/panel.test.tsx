// The panel draws core's Slider and the kit's controls over the scope's bag,
// shows what the original shows for the current complexity, method, colour
// space, gamma, mask method and process view, writes the edit and its derived
// values live, and keeps the process view out of the edit.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { nodesOf } from "../src/curve-edit";
import { activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS, DEFAULT_TRANSMISSION } from "../src/model";
import { RetinexPanel, TIPS } from "../src/Panel";
import { packCurve, qualified, readParams } from "../src/params";
import { React } from "../src/rt";
import { currentView, setView } from "../src/view";
import { fakeApi } from "./support/fake-api";

beforeAll(() => {
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

function setup(params: Record<string, unknown> = {}) {
  const rig = fakeApi(params);
  activate(rig.api);
  const view = render(<RetinexPanel />);
  const labels = () => rig.sliders(view.container).map((s) => s.label);
  const slider = (label: string) => {
    const found = rig.sliders(view.container).find((s) => s.label === label);
    if (!found) throw new Error(`no slider ${label}`);
    return found;
  };
  const select = (label: string) => {
    const found = view.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    if (!found) throw new Error(`no select ${label}`);
    return found;
  };
  const button = (label: string) => {
    const found = [...view.container.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no button ${label}`);
    return found;
  };
  const sections = () => [...view.container.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
  return { rig, view, labels, slider, select, button, sections };
}

afterEach(() => {
  act(() => setView("standard"));
  cleanup();
  deactivate();
});

describe("the panel", () => {
  it("shows Standard's controls by default", () => {
    const { labels, sections, view } = setup();
    expect(labels()).toEqual(["Strength", "Radius", "Contrast", "Scale", "Threshold", "Offset"]);
    expect(sections()).toEqual(["Settings", "Transmission", "Gain and offset"]);
    expect(view.container.querySelector('select[aria-label="Process"]')).toBeNull();
  });

  it("shows the Highlight threshold for Highlight and Highlights+, and Highlights+'s protection", () => {
    const { labels, select } = setup();
    fireEvent.change(select("Method"), { target: { value: "highlight" } });
    expect(labels()).toContain("Highlight threshold");
    expect(labels()).not.toContain("Protect from");
    fireEvent.change(select("Method"), { target: { value: "highlightsPlus" } });
    expect(labels()).toEqual(expect.arrayContaining(["Highlight threshold", "Protect from", "Softness", "Protection"]));
  });

  it("shows Advanced's mask, equalizer and tone mapping", () => {
    const { button, sections, select, labels } = setup();
    fireEvent.click(button("Advanced"));
    expect(sections()).toEqual(["Mask", "Settings", "Equalizer", "Tone mapping", "Transmission", "Gain and offset"]);
    fireEvent.change(select("Mask method"), { target: { value: "gaussian" } });
    expect(labels()).toEqual(expect.arrayContaining(["Highlights", "Highlights tonal width", "Shadows", "Shadows tonal width", "Mask radius"]));
    fireEvent.change(select("Mask method"), { target: { value: "total" } });
    expect(labels()).not.toContain("Mask radius");
    fireEvent.change(select("Gamma"), { target: { value: "free" } });
    expect(labels()).toEqual(expect.arrayContaining(["Free gamma", "Free gamma slope"]));
  });

  it("shows the L=f(L) curve of the colour space in use", () => {
    const { button, select, view } = setup();
    fireEvent.click(button("Advanced"));
    expect(view.container.querySelector('select[aria-label="L=f(L) type"]')).not.toBeNull();
    fireEvent.change(select("Colour space"), { target: { value: "hslLog" } });
    expect(view.container.querySelector('select[aria-label="L=f(L), HSL type"]')).not.toBeNull();
    expect(view.container.querySelector('select[aria-label="L=f(L) type"]')).toBeNull();
  });

  it("hides what the mask and unsharp views don't use", () => {
    const { button, select, labels, sections } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("Process"), { target: { value: "mask" } });
    expect(sections()).not.toContain("Tone mapping");
    expect(labels()).not.toContain("Threshold");
    expect(labels()).not.toContain("Offset");
  });

  it("keeps the process view out of the edit, as a view value", () => {
    const { rig, button, select } = setup();
    fireEvent.click(button("Advanced"));
    const before = { ...rig.params() };
    fireEvent.change(select("Process"), { target: { value: "transmissionFixed" } });
    expect(rig.viewValues.at(-1)).toEqual({ [qualified("view")]: 4, [qualified("viewP1")]: 4 });
    expect(rig.params()).toEqual(before);
  });

  it("gives the first pass the view only with one iteration, following the count", () => {
    const { rig, select } = setup({ [qualified("on")]: true, [qualified("advanced")]: true, [qualified("iterations")]: 3 });
    fireEvent.change(select("Process"), { target: { value: "transmissionFixed" } });
    expect(rig.viewValues.at(-1)).toEqual({ [qualified("view")]: 4, [qualified("viewP1")]: 0 });
    act(() => rig.replace({ ...rig.params(), [qualified("iterations")]: 1 }));
    expect(rig.viewValues.at(-1)).toEqual({ [qualified("view")]: 4, [qualified("viewP1")]: 4 });
    const calls = rig.viewValues.length;
    act(() => rig.replace({ ...rig.params(), [qualified("strength")]: 30 }));
    expect(rig.viewValues).toHaveLength(calls);
  });

  it("ignores a view the list doesn't have", () => {
    const { rig, button, select } = setup();
    fireEvent.click(button("Advanced"));
    const calls = rig.viewValues.length;
    fireEvent.change(select("Process"), { target: { value: "" } });
    expect(rig.viewValues).toHaveLength(calls);
    expect(currentView()).toBe("standard");
  });

  it("labels every choice where it can be read, with a tooltip on the tool's own", () => {
    const { button, select } = setup();
    fireEvent.click(button("Advanced"));
    for (const label of ["Method", "Colour space", "Process", "Mask method", "Gamma", "L=f(L) type", "Gain transmission type"]) {
      const field = select(label).closest("[data-field]");
      expect(field?.querySelector("span")?.textContent, label).toBe(label.replace(/ type$/, ""));
    }
    for (const label of ["Method", "Colour space", "Process", "Mask method", "Gamma"]) expect(select(label).title, label).not.toBe("");
  });

  it("writes its tooltips in Canadian English, naming no other program", () => {
    const text = Object.values(TIPS).join(" ");
    expect(text).not.toMatch(/rawtherapee|darktable|lightroom|photoshop/i);
    expect(text).not.toMatch(/\b(?:color|center|gray|behavior|analyse)s?\b/i);
  });

  it("puts the view back to Standard on Reset", () => {
    const { rig, button, select } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("Process"), { target: { value: "mask" } });
    fireEvent.click(button("Reset"));
    expect(rig.viewValues.at(-1)).toBeNull();
    expect(select("Process").value).toBe("standard");
  });

  it("forgets the view when the extension stops", () => {
    const { button, select } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("Process"), { target: { value: "mask" } });
    act(() => deactivate());
    expect(currentView()).toBe("standard");
  });

  it("edits a parametric curve's sliders and keeps its splits in order", () => {
    const { rig, button, select, labels, slider } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("L=f(L) type"), { target: { value: "2" } });
    expect(labels()).toEqual(expect.arrayContaining(["Highlights", "Lights", "Darks", "Shadows", "Shadows split", "Midtones split", "Highlights split"]));
    act(() => slider("Lights").onChange(30));
    expect(readParams(rig.params()).lightnessCurve[5]).toBe(30);
    act(() => slider("Shadows split").onChange(60));
    expect(readParams(rig.params()).lightnessCurve[1]).toBe(0.25);
    act(() => slider("Shadows split").onChange(40));
    expect(readParams(rig.params()).lightnessCurve[1]).toBe(0.4);
    act(() => slider("Lights").onCommit?.());
    expect(rig.commits.at(-1)).toBe("Retinex: L=f(L) lights");
  });

  it("writes a flat node's tangents from the transmission graph", () => {
    const { rig, button, view } = setup({ [qualified("on")]: true });
    fireEvent.click(button("Advanced"));
    const canvas = view.container.querySelector<HTMLCanvasElement>('canvas[aria-label="Transmission map"]');
    if (!canvas) throw new Error("no transmission graph");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 252, bottom: 168, x: 0, y: 0, width: 252, height: 168, toJSON: () => ({}) }) as DOMRect;
    const node = nodesOf(DEFAULT_TRANSMISSION, true)[1];
    const at = { clientX: 8 + node.x * 236, clientY: 8 + (1 - node.y) * 152, pointerId: 1 };
    fireEvent.pointerDown(canvas, { ...at, button: 0 });
    fireEvent.pointerUp(canvas, at);
    const left = view.container.querySelector<HTMLInputElement>('input[aria-label="Left tangent"]');
    if (!left) throw new Error("no tangent input");
    fireEvent.change(left, { target: { value: "0.1" } });
    expect(nodesOf(readParams(rig.params()).transmissionCurve, true)[1].left).toBe(0.1);
    expect(rig.commits.at(-1)).toBe("Retinex: Transmission map");
  });

  it("puts the view back to Standard when another photo opens", () => {
    const { rig, button, select } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("Process"), { target: { value: "mask" } });
    act(() => rig.openPhoto("p2"));
    expect(rig.viewValues.at(-1)).toBeNull();
  });

  it("greys the gradients out at one iteration but keeps them", () => {
    const { button, view, labels } = setup();
    fireEvent.click(button("Advanced"));
    expect(labels()).toEqual(expect.arrayContaining(["Gaussian gradient", "Transmission gradient", "Strength gradient"]));
    expect(view.container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(3);
  });

  it("writes a drag live with its derived values and commits on release", () => {
    const { rig, slider } = setup({ [qualified("on")]: true });
    act(() => slider("Strength").onChange(55));
    expect(rig.params()[qualified("strength")]).toBe(55);
    expect(Array.isArray(rig.params()[qualified("rtIters")])).toBe(true);
    expect(rig.commits).toEqual([]);
    act(() => slider("Strength").onCommit?.());
    expect(rig.commits).toEqual(["Retinex: strength"]);
  });

  it("resets what Standard hides when switching back to it, as the original does", () => {
    const { rig, button, select } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("Mask method"), { target: { value: "gaussian" } });
    act(() => rig.replace({ ...rig.params(), [qualified("iterations")]: 3, [qualified("transmissionCurve")]: packCurve("transmissionCurve", [0]) }));
    fireEvent.click(button("Standard"));
    const p = readParams(rig.params());
    expect(p.advanced).toBe(false);
    expect(p.iterations).toBe(1);
    expect(p.maskMethod).toBe("none");
    expect(p.transmissionCurve).toEqual(DEFAULT_TRANSMISSION);
  });

  it("resets everything but the switch and complexity", () => {
    const { rig, button, slider } = setup({ [qualified("on")]: true });
    act(() => slider("Radius").onChange(30));
    fireEvent.click(button("Reset"));
    const p = readParams(rig.params());
    expect(p.on).toBe(true);
    expect(p.radius).toBe(DEFAULT_PARAMS.radius);
  });

  it("switches a curve's type and starts it as the original's editor does", () => {
    const { rig, button, select } = setup();
    fireEvent.click(button("Advanced"));
    fireEvent.change(select("L=f(L) type"), { target: { value: "1" } });
    expect(readParams(rig.params()).lightnessCurve).toEqual([1, 0, 0, 0.5, 0.5, 1, 1]);
    fireEvent.change(select("L=f(L) type"), { target: { value: "2" } });
    expect(readParams(rig.params()).lightnessCurve[0]).toBe(2);
  });
});
