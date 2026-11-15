// A stand-in for the part of Safelight's API this extension uses (src/rt.ts
// Host), over real React and zustand. Reading a member it lacks throws, naming
// it, so a test shows what to add here when the extension starts using more.
//
// The photo's edit is a param bag in a zustand store, so a panel re-renders
// when it changes. Reads fall back to the defaults of the registered stages'
// uniforms, as Safelight's do. Core's Slider is a stub that keeps the props it
// was last drawn with, so a test can drive a drag and its release; the kit's
// controls are plain DOM. View values are recorded.

import * as React from "react";
import { create } from "zustand";
import type { DevelopView, Host } from "../../src/rt";
import type {
  ButtonProps,
  FieldProps,
  NumberInputProps,
  PanelContribution,
  ParamScope,
  ProcessingStageContribution,
  RowProps,
  SegmentedControlProps,
  SelectProps,
  SliderProps,
  StackProps,
  ToggleProps,
} from "../../src/safelight";

export interface Rig {
  api: Host;
  panels: PanelContribution[];
  stages: ProcessingStageContribution[];
  /** The photo's param bag, by qualified key, without defaults. */
  params(): Readonly<Record<string, unknown>>;
  /** The labels of the undo steps the extension made, in order. */
  commits: string[];
  /** Every setViewValues call, in order. */
  viewValues: (Record<string, unknown> | null)[];
  /** The latest props of each slider drawn in `root`, in document order. */
  sliders(root: ParentNode): SliderProps[];
  /** Replaces the photo's bag from outside the panel, as an undo or a paste would. */
  replace(params: Record<string, unknown>): void;
  /** Opens another photo. */
  openPhoto(id: string): void;
}

export function fakeApi(initial: Record<string, unknown> = {}): Rig {
  const panels: PanelContribution[] = [];
  const stages: ProcessingStageContribution[] = [];
  const commits: string[] = [];
  const viewValues: (Record<string, unknown> | null)[] = [];
  const defaults = new Map<string, unknown>();
  const develop = create<DevelopView>()((set) => ({
    paramBag: { ...initial },
    photoId: "p1",
    setDynParams: (patch) =>
      set((s) => {
        const next = { ...s.paramBag, ...patch };
        for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
        return { paramBag: next };
      }),
    commitEdit: async (label) => void commits.push(label),
  }));
  const sliderProps = new Map<number, SliderProps>();
  let nextSlider = 0;

  function useParamScope(): ParamScope {
    const params = develop((s) => s.paramBag);
    return {
      maskId: null,
      getParam: (key) => (key in params ? params[key] : defaults.get(key)),
      getParams: () => develop.getState().paramBag,
      setParams: (patch) => develop.getState().setDynParams(patch),
      commit: (label) => void commits.push(label),
    };
  }

  function Slider(props: SliderProps) {
    const id = React.useRef(nextSlider++).current;
    sliderProps.set(id, props);
    return React.createElement("div", { "data-slider": id }, `${props.label} ${props.value}`);
  }

  const host: Host = {
    react: React,
    registerPanel: (c) => void panels.push(c),
    registerProcessingStage: (c) => {
      stages.push(c);
      for (const u of c.uniforms) defaults.set(`${c.id}.${u.key}`, u.default);
    },
    components: { Slider },
    ui,
    develop: { useParamScope, setViewValues: (values) => void viewValues.push(values) },
    stores: { useDevelopStore: develop },
  };

  return {
    api: strict(host, "api"),
    panels,
    stages,
    params: () => develop.getState().paramBag,
    commits,
    viewValues,
    replace: (params) => develop.setState({ paramBag: { ...params } }),
    openPhoto: (id) => develop.setState({ photoId: id }),
    sliders: (root) =>
      [...root.querySelectorAll("[data-slider]")].map((el) => {
        const props = sliderProps.get(Number(el.getAttribute("data-slider")));
        if (!props) throw new Error("a slider without props");
        return props;
      }),
  };
}

const e = React.createElement;

const ui: Host["ui"] = {
  Stack: (props: StackProps) => e("div", { "data-stack": "" }, props.children),
  Row: (props: RowProps) => e("div", { "data-row": "" }, props.children),
  Field: (props: FieldProps) => e("label", { "data-field": "" }, e("span", null, props.label), props.children),
  Section: (props) => e("section", { "aria-label": String(props.title) }, e("h3", null, props.title), props.children),
  Button: (props: ButtonProps) => e("button", { onClick: props.onClick }, props.children),
  NumberInput: (props: NumberInputProps) =>
    e("input", { type: "number", value: props.value, "aria-label": props["aria-label"], onChange: (ev: { target: { value: string } }) => props.onChange(Number(ev.target.value)) }),
  Toggle: (props: ToggleProps) =>
    e(
      "label",
      null,
      e("input", { type: "checkbox", checked: props.checked, onChange: (ev: { target: { checked: boolean } }) => props.onChange(ev.target.checked) }),
      props.label,
    ),
  SegmentedControl: (props: SegmentedControlProps) =>
    e(
      "div",
      { role: "radiogroup" },
      props.options.map((o) =>
        e("button", { key: o.value, role: "radio", "aria-checked": o.value === props.value, onClick: () => props.onChange(o.value) }, o.label),
      ),
    ),
  Select: (props: SelectProps) =>
    e(
      "select",
      { value: props.value, "aria-label": props.ariaLabel, title: props.title, onChange: (ev: { target: { value: string } }) => props.onChange(ev.target.value) },
      e("option", { value: "" }, props.placeholder),
      (props.options ?? []).map((o) => e("option", { key: o.value, value: o.value }, o.label)),
    ),
};

/** Wraps a plain object so reading a member it lacks throws, naming the member. */
function strict<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (typeof key === "symbol" || key === "then" || key === "toJSON") return Reflect.get(obj, key, receiver);
      if (!(key in obj)) throw new Error(`The fake API has no ${path}.${key}. Add it to test/support/fake-api.ts.`);
      const value: unknown = Reflect.get(obj, key, receiver);
      const isPlainObject = typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
      return isPlainObject && key !== "react" ? strict(value, `${path}.${key}`) : value;
    },
  });
}
