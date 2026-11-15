// Runtime bindings. JSX in every module compiles (classic transform) to
// React.createElement, resolved against the `React` exported here: the
// instance Safelight passes to activate(). The bundle never imports React
// itself: Safelight loads it without an import map, and a second React would
// break hooks.
//
// `Host` is the part of the API this extension uses. Safelight's full API is
// one, and the unit tests' fake is another, with nothing cast.

import type { DevelopState, SafelightAPI } from "./safelight";

/** The develop store as this extension reads it. */
export type DevelopView = Pick<DevelopState, "paramBag" | "photoId" | "setDynParams" | "commitEdit">;

export interface DevelopStore {
  getState(): DevelopView;
  subscribe(listener: (state: DevelopView, prev: DevelopView) => void): () => void;
}

export type Host = Pick<SafelightAPI, "react" | "registerPanel" | "registerProcessingStage"> & {
  components: Pick<SafelightAPI["components"], "Slider">;
  ui: Pick<SafelightAPI["ui"], "Button" | "Field" | "NumberInput" | "Row" | "Section" | "SegmentedControl" | "Select" | "Stack" | "Toggle">;
  develop: Pick<SafelightAPI["develop"], "useParamScope" | "setViewValues">;
  stores: { useDevelopStore: DevelopStore };
};

export let React!: Host["react"];
export let api!: Host;

export function initRuntime(host: Host): void {
  api = host;
  React = host.react;
}
