import { describe, expect, it } from "vitest";
import manifest from "../safelight.json";
import pkg from "../package.json";
import { PANEL_ID, activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS, drawCounts } from "../src/model";
import { EXT_ID, STAGE_ID, qualified } from "../src/params";
import { fakeApi } from "./support/fake-api";

describe("activate", () => {
  it("registers the stage and the panel", () => {
    const rig = fakeApi();
    activate(rig.api);
    expect(rig.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(rig.panels.map((p) => p.id)).toEqual([PANEL_ID]);
    deactivate();
  });

  it("names its contributions under the manifest's id and versions both files alike", () => {
    expect(EXT_ID).toBe(manifest.id);
    expect(PANEL_ID.startsWith(`${manifest.id}.`)).toBe(true);
    expect(STAGE_ID.startsWith(`${manifest.id}.`)).toBe(true);
    expect(pkg.version).toBe(manifest.version);
    expect(manifest.minAppVersion).toBe("3.2.5");
  });

  it("names no other program in what users read", () => {
    const text = [manifest.name, manifest.description, ...manifest.keywords].join(" ");
    expect(text).not.toMatch(/rawtherapee|darktable|lightroom|photoshop/i);
  });

  it("re-derives the derived values of a pasted edit", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.replace({ [qualified("on")]: true, [qualified("radius")]: 20 });
    expect(rig.params()[qualified("p1Draws")]).toBe(drawCounts({ ...DEFAULT_PARAMS, on: true, radius: 20 }).p1Draws);
    expect(Array.isArray(rig.params()[qualified("rtIt1")])).toBe(true);
    deactivate();
  });

  it("re-derives a preset's stale derived values", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.replace({ [qualified("on")]: true, [qualified("radius")]: 20, [qualified("rtIt1")]: new Array<number>(16).fill(0), [qualified("p1Draws")]: 3 });
    expect(rig.params()[qualified("p1Draws")]).toBe(drawCounts({ ...DEFAULT_PARAMS, on: true, radius: 20 }).p1Draws);
    expect((rig.params()[qualified("rtIt1")] as number[]).some((v) => v !== 0)).toBe(true);
    deactivate();
  });

  it("leaves the bag alone when only other tools' keys change", () => {
    const rig = fakeApi();
    activate(rig.api);
    deactivate();
    rig.replace({ [qualified("on")]: true });
    activate(rig.api);
    rig.replace({ ...rig.params(), "other.tool.amount": 3 });
    expect(rig.params()[qualified("p1Draws")]).toBeUndefined();
    rig.replace({ ...rig.params(), [qualified("strength")]: 30 });
    expect(rig.params()[qualified("p1Draws")]).toBeGreaterThan(0);
    deactivate();
  });

  it("stops re-deriving once deactivated", () => {
    const rig = fakeApi();
    activate(rig.api);
    deactivate();
    rig.replace({ [qualified("on")]: true });
    expect(rig.params()[qualified("p1Draws")]).toBeUndefined();
  });

  it("resets the photo in one undo step", () => {
    const rig = fakeApi({ [qualified("on")]: true, [qualified("strength")]: 70 });
    activate(rig.api);
    rig.panels[0].onReset?.();
    expect(rig.params()[qualified("on")]).toBe(false);
    expect(rig.params()[qualified("strength")]).toBe(DEFAULT_PARAMS.strength);
    expect(rig.commits).toEqual(["Retinex reset"]);
    deactivate();
  });
});
