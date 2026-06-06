/**
 * Web UI state-machine tests (v2.1). Headless: only state.ts + battery.ts +
 * diagnostic.ts (no DOM). Covers the class-prior flow, ordinal confidence,
 * interleaving, and the worked scripted-run fixture (globalGap).
 */

import { describe, it, expect } from "bun:test";

import { computeDiagnostic, ALL_CLUSTERS, CLUSTER_TIER, TIERS, ILLUSTRATIVE_REPS, ILLUSTRATIVE_SUBMISSIONS } from "../diagnostic.ts";
import type { IntakeResponses, Submission, BaselineRep, ConfidenceLabel, Tier } from "../diagnostic.ts";
import {
  initialState,
  reduce,
  toRepResults,
  toClassPriors,
  restampActiveRep,
  classPriorsComplete,
  isComplete,
  type SessionState,
} from "./state.ts";
import { DEMO_BATTERY, BATTERY_ID, interleaveByCluster, type RubricUiPayload } from "./battery.ts";

const NOW = "2026-06-03T12:00:00.000Z";
const ALL_ONE: IntakeResponses = { timeline: 1, delegation: 1, recency: 1, reserve: 1, confidence: 1 };
const FIELDS = ["timeline", "delegation", "recency", "reserve", "confidence"] as const;

function demoSubmissionFor(rep: BaselineRep): Submission {
  switch (rep.format) {
    case "mcq": return { kind: "mcq", choiceIndex: 0 };
    case "exact": return { kind: "exact", value: "x" };
    case "numeric_tol": return { kind: "numeric_tol", value: 1 };
    case "rubric_program": return { kind: "rubric_program", satisfied: [] };
    default: return { kind: "mcq", choiceIndex: 0 };
  }
}

/** Drive the full flow (intake → class priors → rep loop) to `computing`. */
function driveToComputing(battery: BaselineRep[] = DEMO_BATTERY): SessionState {
  let s = initialState("run", NOW, battery, BATTERY_ID);
  s = reduce(s, { type: "startIntake" }, NOW);
  for (const field of FIELDS) s = reduce(s, { type: "answerIntake", field, value: 1 }, NOW);
  s = reduce(s, { type: "submitIntake" }, NOW); // → classpriors
  for (const t of TIERS) s = reduce(s, { type: "setClassPrior", tier: t, label: "fairlySure" }, NOW);
  s = reduce(s, { type: "submitClassPriors" }, NOW); // → rep(0)
  battery.forEach((rep, i) => {
    s = reduce(s, { type: "setSubmission", i, submission: demoSubmissionFor(rep) }, NOW);
    s = reduce(s, { type: "submitRep", i, elapsedSeconds: 10 }, NOW);
  });
  return s;
}

// ── flow ─────────────────────────────────────────────────────────────────────

describe("flow", () => {
  it("drives Welcome → Intake → ClassPriors → reps → Computing", () => {
    const s = driveToComputing();
    expect(s.screen.kind).toBe("computing");
    expect(isComplete(s)).toBe(true);
    expect(toClassPriors(s)).toHaveLength(3); // one per tier
  });

  it("submitIntake routes to class priors, not straight to reps", () => {
    let s = initialState("r", NOW, DEMO_BATTERY, BATTERY_ID);
    s = reduce(s, { type: "startIntake" }, NOW);
    for (const field of FIELDS) s = reduce(s, { type: "answerIntake", field, value: 1 }, NOW);
    s = reduce(s, { type: "submitIntake" }, NOW);
    expect(s.screen.kind).toBe("classpriors");
  });

  it("submitClassPriors goes directly to rep(0), no confidence screen", () => {
    let s = initialState("r", NOW, DEMO_BATTERY, BATTERY_ID);
    s = reduce(s, { type: "startIntake" }, NOW);
    for (const field of FIELDS) s = reduce(s, { type: "answerIntake", field, value: 1 }, NOW);
    s = reduce(s, { type: "submitIntake" }, NOW);
    for (const t of TIERS) s = reduce(s, { type: "setClassPrior", tier: t, label: "fairlySure" }, NOW);
    s = reduce(s, { type: "submitClassPriors" }, NOW);
    expect(s.screen).toEqual({ kind: "rep", i: 0 });
    expect(s.captures[0].repStartedAt).toBe(NOW);
  });

  it("results is reachable ONLY via setResult", () => {
    const s = driveToComputing();
    const stuck = reduce(s, { type: "submitRep", i: 0, elapsedSeconds: 5 }, NOW);
    expect(stuck.screen.kind).toBe("computing");
    expect(stuck.result).toBeNull();
    const result = computeDiagnostic(ALL_ONE, DEMO_BATTERY, toRepResults(s, DEMO_BATTERY), toClassPriors(s), NOW);  // 3 tier priors
    const done = reduce(s, { type: "setResult", result }, NOW);
    expect(done.screen.kind).toBe("results");
    expect(done.result).not.toBeNull();
  });

  it("is deterministic", () => {
    expect(driveToComputing()).toEqual(driveToComputing());
  });
});

// ── rep timing ───────────────────────────────────────────────────────────────

describe("rep timing", () => {
  it("repStartedAt is stamped when entering rep(0) and each subsequent rep", () => {
    const s = driveToComputing([DEMO_BATTERY[0]!, DEMO_BATTERY[1]!]);
    expect(s.captures[0].repStartedAt).toBe(NOW);
    expect(s.captures[1].repStartedAt).toBe(NOW);
  });

  it("restampActiveRep restarts the timer on resume", () => {
    let s = driveToComputing([DEMO_BATTERY[0]!, DEMO_BATTERY[1]!]);
    // resume mid-session at rep 1
    const mid = reduce(initialState("run", NOW, [DEMO_BATTERY[0]!, DEMO_BATTERY[1]!], BATTERY_ID), { type: "resume", persisted: { ...s, screen: { kind: "rep", i: 1 } } }, NOW);
    const later = "2026-06-04T10:00:00.000Z";
    expect(restampActiveRep(mid, later).captures[1].repStartedAt).toBe(later);
  });
});

// ── battery (§7) + interleaving ──────────────────────────────────────────────

describe("demo battery", () => {
  it("matches §6.1 composition: 15 reps, all 9 clusters, no unit_test", () => {
    expect(DEMO_BATTERY).toHaveLength(15);
    expect(new Set(DEMO_BATTERY.map((r) => r.cluster)).size).toBe(9);
    for (const c of ALL_CLUSTERS) expect(DEMO_BATTERY.some((r) => r.cluster === c)).toBe(true);
    expect(DEMO_BATTERY.some((r) => r.format === "unit_test")).toBe(false);
    for (const r of DEMO_BATTERY) expect(r.tier).toBe(CLUSTER_TIER[r.cluster]);
  });

  it("interleaving spreads clusters: first pass hits each cluster once", () => {
    const order = interleaveByCluster(DEMO_BATTERY);
    expect(order).toHaveLength(15);
    expect(new Set(order.map((r) => r.id)).size).toBe(15); // same items, no loss
    const first9 = order.slice(0, 9).map((r) => r.cluster);
    expect(new Set(first9).size).toBe(9); // 9 distinct clusters up front
  });

  it("rubric_program reps carry display options (correct + distractors)", () => {
    for (const r of DEMO_BATTERY.filter((r) => r.format === "rubric_program")) {
      const p = r.payload as RubricUiPayload;
      expect(p.options.length).toBeGreaterThan(p.checks.length);
      for (const id of p.checks) expect(p.options.some((o) => o.id === id)).toBe(true);
    }
  });
});

// ── resume / retake (§8, §12.4) ──────────────────────────────────────────────

describe("resume", () => {
  it("resume replaces state and SessionState round-trips through JSON", () => {
    const mid = driveToComputing();
    const fresh = initialState("other", NOW, DEMO_BATTERY, BATTERY_ID);
    expect(reduce(fresh, { type: "resume", persisted: mid }, NOW)).toEqual(mid);
    expect(JSON.parse(JSON.stringify(mid))).toEqual(mid);
  });

  it("retake clears captures + class priors but reuses rep ids", () => {
    const done = driveToComputing();
    const again = reduce(done, { type: "retake", runId: "run2", startedAt: NOW }, NOW);
    expect(again.screen.kind).toBe("intake");
    expect(Object.keys(again.classPriors)).toHaveLength(0);
    expect(again.captures.map((c) => c.repId)).toEqual(done.captures.map((c) => c.repId));
    expect(again.captures.every((c) => c.submission === null && c.elapsedSeconds === null)).toBe(true);
  });
});

// ── worked scripted-run fixture (v2.1) ───────────────────────────────────────

describe("scripted-run fixture", () => {
  const elapsed = [12, 18, 60, 90];
  // Three tier priors: T1 certain=0.95, T2 fairlySure=0.6, T3 certain=0.95
  const priors = [
    { tier: "T1" as Tier, confidence: "certain" as ConfidenceLabel },
    { tier: "T2" as Tier, confidence: "fairlySure" as ConfidenceLabel },
    { tier: "T3" as Tier, confidence: "certain" as ConfidenceLabel },
  ];

  function fixtureState(): SessionState {
    return {
      runId: "fix",
      startedAt: NOW,
      screen: { kind: "computing" },
      intake: ALL_ONE,
      classPriors: { T1: "certain", T2: "fairlySure", T3: "certain" },
      batteryId: "fix",
      captures: ILLUSTRATIVE_REPS.map((rep, i) => ({
        repId: rep.id,
        repStartedAt: NOW,
        submission: ILLUSTRATIVE_SUBMISSIONS[i],
        elapsedSeconds: elapsed[i],
        assisted: false,
      })),
      result: null,
    };
  }

  it("skill side unchanged; globalGap from tier priors", () => {
    const repResults = toRepResults(fixtureState(), ILLUSTRATIVE_REPS);
    expect(repResults.map((r) => r.rawScore)[2]).toBeCloseTo(2 / 3, 4);
    expect(repResults.every((r) => r.confidence === null)).toBe(true); // no per-item confidence

    const out = computeDiagnostic(ALL_ONE, ILLUSTRATIVE_REPS, repResults, priors, NOW);
    // skill side (unchanged)
    const tier = (t: string) => out.tiers.find((x) => x.tier === t)!;
    expect(tier("T1").latentSkill).toBeCloseTo(0.7321, 4);
    expect(tier("T2").latentSkill).toBeCloseTo(0.5714, 4);
    expect(tier("T3").latentSkill).toBeCloseTo(0.3571, 4);
    expect(out.overallAtrophyIndex).toBeCloseTo(44.6429, 4);
    expect(out.riskBand).toBe("Moderate");

    // calibration side (v2.1 tier-level):
    // T1 priorProb=0.95, accuracy=mean(rawScore*speed[0,1], rawScore[1]) = ILLUSTRATIVE_REPS[0,1] both T1
    //   rep0: score=1 (mcq correct), rep1: score=1 (numeric correct) → T1 clean acc = 1.0
    //   T1 gap = 0.95 − 1.0 = −0.05
    // T2 priorProb=0.6, T2 reps = rep2 (rubric 2/3≈0.6667)  → T2 clean acc ≈ 0.6667
    //   T2 gap = 0.6 − 0.6667 = −0.0667
    // T3 priorProb=0.95, T3 reps = rep3 (mcq wrong = 0) → T3 clean acc = 0
    //   T3 gap = 0.95 − 0 = 0.95
    // globalGap = mean(−0.05, −0.0667, 0.95) = 0.2778
    expect(out.globalGap).toBeCloseTo(0.2778, 4);
    expect(out.overconfidenceFlag).toBeNull(); // scoredRepCount=0 < MIN_OBS_FOR_FLAG=6 (no per-item confidence)
    expect(out.cleanGapWindow).toHaveLength(0); // no per-item confidence ratings
    expect(out.postFeedbackGapWindow).toHaveLength(0);
    expect(out.scoredRepCount).toBe(0); // per-item confidence removed
    expect(out.tierCalibration).toHaveLength(3);
    expect(out.schemaVersion).toBe(3);
  });
});
