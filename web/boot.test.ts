/**
 * Boot resilience (regression). A session persisted by an older build can carry
 * a screen kind this build no longer renders (e.g. "confidence"). Booting must
 * discard it and show a clean Welcome rather than crash on SCREENS[kind](...).
 *
 * main.ts runs its boot on import, so this seeds localStorage + the #app mount
 * BEFORE importing it. One boot scenario per file (module side effects run once).
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Another test file in the same run may have registered already.
try { GlobalRegistrator.register(); } catch { /* already registered */ }

import { describe, it, expect } from "bun:test";

describe("boot resilience", () => {
  it("discards a stale session pointing at a removed screen and shows Welcome", async () => {
    document.body.innerHTML = '<div id="app"></div>';

    // Exactly the shape the previous build wrote: schemaVersion 1, an in-progress
    // run parked on the now-removed "confidence" screen, old capture fields.
    localStorage.setItem(
      "unprompted.diagnostic.v2",
      JSON.stringify({
        schemaVersion: 1,
        current: {
          runId: "old",
          startedAt: "2026-06-03T00:00:00.000Z",
          screen: { kind: "confidence", i: 2 },
          intake: { timeline: 1, delegation: 1, recency: 1, reserve: 1, confidence: 1 },
          classPriors: { T1: "confident" },
          batteryId: "demo-v2",
          captures: [
            { repId: "x", confidence: "confident", confidenceLocked: true, repStartedAt: null, submission: null, elapsedSeconds: null, assisted: false },
          ],
          result: null,
        },
        history: [],
      }),
    );

    // Importing boots the app; must not throw.
    await import("./main.ts");

    const app = document.getElementById("app")!;
    expect(app.textContent ?? "").toContain("How sharp"); // Welcome rendered
    expect(app.textContent ?? "").not.toContain("Resume in-progress"); // stale resume not offered
    expect(app.querySelector(".ordinal")).toBeNull(); // not a confidence screen
  });
});
