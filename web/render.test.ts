/**
 * DOM render-through (v2.1). happy-dom renders every screen across a full
 * playthrough — including the new class-priors screen and ordinal confidence —
 * asserting no runtime errors + key content.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Another test file in the same run may have registered already.
try { GlobalRegistrator.register(); } catch { /* already registered */ }

import { describe, it, expect } from "bun:test";

import { computeDiagnostic, TIERS } from "../diagnostic.ts";
import type { IntakeResponses, Submission, BaselineRep } from "../diagnostic.ts";
import { initialState, reduce, toRepResults, toClassPriors, classPriorsComplete, type SessionState } from "./state.ts";
import { DEMO_BATTERY, BATTERY_ID, REP_CODE } from "./battery.ts";
import type { ScreenCtx, ScreenView } from "./screen.ts";

import { welcome } from "./screens/welcome.ts";
import { intake } from "./screens/intake.ts";
import { classpriors } from "./screens/classpriors.ts";
import { rep } from "./screens/rep.ts";
import { computing } from "./screens/computing.ts";
import { results } from "./screens/results.ts";

const SCREENS: Record<SessionState["screen"]["kind"], ScreenView> = {
  welcome,
  intake,
  classpriors,
  rep,
  computing,
  results,
};

const NOW = "2026-06-03T12:00:00.000Z";
const ALL_ONE: IntakeResponses = { timeline: 1, delegation: 1, recency: 1, reserve: 1, confidence: 1 };
const FIELDS = ["timeline", "delegation", "recency", "reserve", "confidence"] as const;

function ctx(state: SessionState): ScreenCtx {
  return { state, battery: DEMO_BATTERY, emit: () => {}, elapsedSeconds: () => 0, history: [], pendingResume: null, restart: () => {} };
}
function renderOf(state: SessionState): HTMLElement {
  return SCREENS[state.screen.kind](ctx(state));
}
function demoSubmissionFor(r: BaselineRep): Submission {
  switch (r.format) {
    case "mcq": return { kind: "mcq", choiceIndex: 0 };
    case "exact": return { kind: "exact", value: "x" };
    case "numeric_tol": return { kind: "numeric_tol", value: 1 };
    case "rubric_program": return { kind: "rubric_program", satisfied: [] };
    default: return { kind: "mcq", choiceIndex: 0 };
  }
}

describe("DOM render-through (v2.1)", () => {
  it("renders every screen across a full playthrough without throwing", () => {
    let s = initialState("run", NOW, DEMO_BATTERY, BATTERY_ID);

    // Welcome
    expect(renderOf(s).textContent).toContain("How sharp");

    // Intake
    s = reduce(s, { type: "startIntake" }, NOW);
    expect(renderOf(s).querySelectorAll("input[type=radio]").length).toBe(15);
    for (const field of FIELDS) s = reduce(s, { type: "answerIntake", field, value: 1 }, NOW);
    s = reduce(s, { type: "submitIntake" }, NOW);

    // Class priors — 3 rows (one per tier), with examples, captured before any items
    expect(s.screen.kind).toBe("classpriors");
    const priorsEl = renderOf(s);
    expect(priorsEl.querySelectorAll(".prior-row").length).toBe(3);
    expect(priorsEl.querySelectorAll(".ordinal").length).toBe(3);
    for (const t of TIERS) s = reduce(s, { type: "setClassPrior", tier: t, label: "fairlySure" }, NOW);
    s = reduce(s, { type: "submitClassPriors" }, NOW);

    // Baseline loop — rep shown directly, no per-item confidence screen
    const seenFormats = new Set<string>();
    DEMO_BATTERY.forEach((repDef, i) => {
      expect(s.screen.kind).toBe("rep");
      const repEl = renderOf(s);
      expect(repEl.querySelector(".rep-prompt")?.textContent).toContain(repDef.prompt.slice(0, 12));
      expect(repEl.querySelector(".locked-conf")).toBeNull(); // removed
      assertWidget(repEl, repDef.format);
      if (REP_CODE[repDef.id]) {
        // code snippet is rendered and syntax-highlighted
        expect(repEl.querySelector(".code-block .tok-kw")).not.toBeNull();
      }
      seenFormats.add(repDef.format);

      s = reduce(s, { type: "setSubmission", i, submission: demoSubmissionFor(repDef) }, NOW);
      s = reduce(s, { type: "submitRep", i, elapsedSeconds: 10 }, NOW);
    });
    expect([...seenFormats].sort()).toEqual(["exact", "mcq", "numeric_tol", "rubric_program"]);

    // Computing
    expect(s.screen.kind).toBe("computing");
    expect(renderOf(s).querySelector(".spinner")).not.toBeNull();

    // Results
    const result = computeDiagnostic(ALL_ONE, DEMO_BATTERY, toRepResults(s, DEMO_BATTERY), toClassPriors(s), NOW);
    s = reduce(s, { type: "setResult", result }, NOW);
    const resEl = renderOf(s);
    const text = resEl.textContent ?? "";
    expect(text).toContain("atrophy");
    expect(text).toContain(result.riskBand);
    expect(text).toContain("globalGap"); // calibration headline
    expect(resEl.querySelectorAll(".cluster-cell").length).toBe(9);
    expect(resEl.querySelectorAll(".tier-card").length).toBe(3);
    expect(resEl.querySelectorAll(".calib-cell").length).toBe(3); // one per tier prior
    expect(resEl.querySelectorAll(".review-item").length).toBe(15); // withheld feedback, now shown
    expect(resEl.querySelector(".gauge-marker")).not.toBeNull();
    expect(resEl.querySelector(".transparency .json")?.textContent).toContain("lastRepAt");
  });
});

function assertWidget(repEl: HTMLElement, format: string): void {
  if (format === "mcq") expect(repEl.querySelectorAll("input[type=radio]").length).toBeGreaterThan(1);
  else if (format === "exact") expect(repEl.querySelector("input[type=text]")).not.toBeNull();
  else if (format === "numeric_tol") expect(repEl.querySelector("input[type=number]")).not.toBeNull();
  else if (format === "rubric_program") expect(repEl.querySelectorAll("input[type=checkbox]").length).toBeGreaterThan(1);
}
