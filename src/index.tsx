// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// A port of RawTherapee 5.13's Retinex: multi-scale Retinex on lightness.
// Registers the decode stage (stage.ts) and the Develop panel (Panel.tsx),
// keeps the bag's derived values in step with its edit, and puts the process
// view back to Standard when another photo opens.
//
// ipretinex.cc: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>;
//   adaptation 2015 Jacques Desmis <jdesmis@gmail.com>, 2015 Ingo Weyrich
//   <heckflosse67@gmx.de>
// rawimagesource.cc: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>

import { RetinexPanel, TITLE } from "./Panel";
import { EXT_ID, STAGE_ID, readParams, rederivePatch, resetPatch } from "./params";
import { api, initRuntime, type DevelopView, type Host } from "./rt";
import { retinexStage } from "./stage";
import { forgetView, setView, setViewIterations } from "./view";

export const PANEL_ID = `${EXT_ID}.panel`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api.stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  setView("standard");
  void dev.commitEdit(`${TITLE} reset`);
}

const PREFIX = `${STAGE_ID}.`;

/** Whether a key of this stage differs between two bags. */
function ownChange(a: DevelopView["paramBag"], b: DevelopView["paramBag"]): boolean {
  for (const key in a) if (key.startsWith(PREFIX) && a[key] !== b[key]) return true;
  for (const key in b) if (key.startsWith(PREFIX) && !(key in a)) return true;
  return false;
}

export function activate(host: Host): void {
  initRuntime(host);
  host.registerProcessingStage(retinexStage());
  host.registerPanel({
    id: PANEL_ID,
    title: TITLE,
    component: RetinexPanel,
    defaultDock: { module: "develop", direction: "right", width: 280 },
    onReset: reset,
  });

  unsubscribe?.();
  setViewIterations(readParams(host.stores.useDevelopStore.getState().paramBag).iterations);
  // A bag whose derived values disagree with its edit (a preset or paste that
  // carried only the edit, an edit from an older version) is re-derived live.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopView, prev: DevelopView) => {
    const photo = state.photoId !== prev.photoId;
    if (photo) setView("standard");
    if (state.paramBag === prev.paramBag || (!photo && !ownChange(state.paramBag, prev.paramBag))) return;
    setViewIterations(readParams(state.paramBag).iterations);
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

/** The host sweeps the stage and the panel after every deactivate, and
 *  clears the view values. */
export function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
  forgetView();
}
