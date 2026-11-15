// Retinex, a Safelight extension (GPL-3.0-or-later).
//
// The process view (mask, unsharp mask, transmission maps) is a live-view aid,
// not part of the edit: it reaches the passes as view values
// (api.develop.setViewValues), so exports, thumbnails and presets never show
// it. View values aren't per photo, so the view goes back to Standard when
// another photo opens (index.tsx). P1 reads its own copy, which is the view
// only with one iteration: with more, the views show the last iteration's
// maps and P1's kept result stays as it is when the view changes.

import { VIEWS, type View } from "./model";
import { VIEW_KEY, VIEW_P1_KEY, qualified } from "./params";
import { React, api } from "./rt";

let view: View = "standard";
let iterations = 1;
const listeners = new Set<() => void>();

function values(): Record<string, number> | null {
  if (view === "standard") return null;
  const index = VIEWS.indexOf(view);
  return { [qualified(VIEW_KEY)]: index, [qualified(VIEW_P1_KEY)]: iterations === 1 ? index : 0 };
}

export function setView(next: View): void {
  if (next === view) return;
  view = next;
  api.develop.setViewValues(values());
  for (const listener of listeners) listener();
}

/** The photo's iteration count, which decides what P1 sees of the view. */
export function setViewIterations(next: number): void {
  if (next === iterations) return;
  iterations = next;
  if (view !== "standard") api.develop.setViewValues(values());
}

/** Back to Standard without telling the host, which clears an extension's
 *  view values itself when it stops. */
export function forgetView(): void {
  iterations = 1;
  if (view === "standard") return;
  view = "standard";
  for (const listener of listeners) listener();
}

export const currentView = (): View => view;

export function useView(): View {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
  );
}
