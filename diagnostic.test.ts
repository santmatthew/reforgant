/**
 * Diagnostic test suite (bun test).
 *
 * Covers the v2.1 confidence methodology (ordinal labels, class-level globalGap,
 * clean/post-feedback windows), the worked skill example, filter parity with the
 * Model's `applyRep`, the scorers, edge cases, and determinism.
 */

import { describe, it, expect } from "bun:test";

// The Model module — untouched reference. Used only to assert filter parity.
import {
  applyRep,
  type ClusterState,
  type RepResult,
} from "./spec/research/atrophy-model.ts";

import {
  computeDiagnostic,
  skillUpdate,
  scoreRep,
  repScore,
  gradeSubmission,
  intakePrior,
  toSkillStates,
  riskBandFor,
  confidenceToProb,
  guessingBaseline,
  DIAGNOSTIC_CONFIG,
  ALL_CLUSTERS,
  ILLUSTRATIVE_REPS,
  ILLUSTRATIVE_SUBMISSIONS,
  type BaselineRep,
  type BaselineRepResult,
  type ClassPrior,
  type ConfidenceLabel,
  type IntakeResponses,
  type DiagnosticConfig,
  type ClusterId,
  type Tier,
  type ExactPayload,
  type NumericTolPayload,
  type UnitTestPayload,
} from "./diagnostic.ts";

// Tier-level class priors (v2.1)
function mkTierPriors(...pairs: [Tier, ConfidenceLabel][]): ClassPrior[] {
  return pairs.map(([tier, confidence]) => ({ tier, confidence }));
}

const ISO = "2026-06-03T00:00:00.000Z";

// --- tiny builders -----------------------------------------------------------

function mkRep(
  id: string,
  tier: Tier,
  cluster: ClusterId,
  opts: Partial<BaselineRep> = {},
): BaselineRep {
  return {
    id,
    tier,
    cluster,
    prompt: id,
    format: "mcq",
    payload: { correctIndex: 0 },
    targetSeconds: 30,
    weight: 1.0,
    ...opts,
  };
}

function mkResult(
  repId: string,
  rawScore: number,
  confidence: ConfidenceLabel | null,
  opts: Partial<BaselineRepResult> = {},
): BaselineRepResult {
  return {
    repId,
    rawScore,
    confidence,
    elapsedSeconds: 10,
    assisted: false,
    ratedAfterFeedback: false,
    ...opts,
  };
}

// kept for tests that still need ad-hoc tier lists
function mkPriors(...pairs: [Tier, ConfidenceLabel][]): ClassPrior[] {
  return mkTierPriors(...pairs);
}

const FULL_SHARP: IntakeResponses = {
  timeline: 1,
  delegation: 1,
  recency: 0,
  reserve: 0,
  confidence: 0,
};

// ============================================================================
// Worked example — skill side unchanged (4 dp)
// ============================================================================

describe("worked example (T1 tier filter)", () => {
  // intake timeline=1, delegation=1 → priorDecay_T1 = 0.5 → priorSkill_T1 = 0.5, n = 2.
  // Three T1 reps, post-speed x = [0.90, 0.40, 1.00] (elapsed ≤ target ⇒ speedFactor = 1).
  const reps: BaselineRep[] = [
    mkRep("t1a", "T1", "syntax_idioms"),
    mkRep("t1b", "T1", "syntax_idioms"),
    mkRep("t1c", "T1", "complexity_estimation"),
  ];
  const results: BaselineRepResult[] = [
    mkResult("t1a", 0.9, "confident"),
    mkResult("t1b", 0.4, "confident"),
    mkResult("t1c", 1.0, "certain"),
  ];
  // T1 prior = confident (0.8); T1 clean accuracy = mean(0.9, 0.4, 1.0) = 0.7667 → gap = +0.0333
  const priors = mkPriors(["T1", "confident"]);
  const result = computeDiagnostic(FULL_SHARP, reps, results, priors, ISO);
  const t1 = result.tiers.find((t) => t.tier === "T1")!;

  it("latentSkill_T1 ≈ 0.6583", () => expect(t1.latentSkill).toBeCloseTo(0.6583, 4));
  it("observations_T1 = 5", () => expect(t1.observations).toBe(5));
  it("atrophyIndex_T1 ≈ 34.1667", () => expect(t1.atrophyIndex).toBeCloseTo(34.1667, 4));

  it("globalGap = tier-prior gap for T1", () => {
    // T1 accuracy = mean(0.9, 0.4, 1.0) = 0.7667; prior confident = 0.8 → +0.0333
    expect(result.globalGap).toBeCloseTo(0.0333, 4);
    expect(result.tierCalibration).toHaveLength(1);
    expect(result.tierCalibration[0]!.tier).toBe("T1");
    expect(result.overconfidenceFlag).toBeNull(); // only 1 tier rated, < MIN_CLUSTERS_FOR_FLAG=3
  });
});

// ============================================================================
// Confidence mapping (v2.1)
// ============================================================================

describe("confidenceToProb / guessingBaseline", () => {
  it("maps labels to the configured probabilities", () => {
    expect(confidenceToProb("guess")).toBeCloseTo(0.2, 10);
    expect(confidenceToProb("fairlySure")).toBeCloseTo(0.6, 10);
    expect(confidenceToProb("certain")).toBeCloseTo(0.95, 10);
  });
  it("floors at the guessing baseline", () => {
    expect(confidenceToProb("guess", 0.25)).toBeCloseTo(0.25, 10); // 4-option MCQ floor
    expect(confidenceToProb("certain", 0.25)).toBeCloseTo(0.95, 10); // floor doesn't lower
  });
  it("guessingBaseline is 1/choices for mcq, 0 otherwise", () => {
    const mcq4 = mkRep("m", "T1", "syntax_idioms", { payload: { correctIndex: 0, choices: ["a", "b", "c", "d"] } });
    expect(guessingBaseline(mcq4)).toBeCloseTo(0.25, 10);
    const mcq2 = mkRep("m", "T1", "syntax_idioms", { payload: { correctIndex: 0, choices: ["a", "b"] } });
    expect(guessingBaseline(mcq2)).toBeCloseTo(0.5, 10);
    expect(guessingBaseline(mkRep("n", "T1", "mental_sizing", { format: "numeric_tol", payload: {} }))).toBe(0);
  });
});

// ============================================================================
// Filter parity with the Model's applyRep (weight = 1 slice)
// ============================================================================

describe("filter parity with Model.applyRep (weight = 1, no decay)", () => {
  it("produces identical S at every step", () => {
    const xs = [0.9, 0.4, 1.0, 0.2, 0.75];
    const at = 1_000_000;

    let S = 0.5;
    let n = 2;
    const diagS: number[] = [];
    for (const x of xs) {
      const step = skillUpdate(S, n, x, 1);
      S = step.S;
      n = step.n;
      diagS.push(S);
    }

    let state: ClusterState = {
      cluster: "parity",
      tier: "T1",
      skill: 0.5,
      nObserved: 2,
      lastRepAt: null,
      gapWindow: [],
      brierWindow: [],
    };
    const modelS: number[] = [];
    for (const x of xs) {
      const rep: RepResult = { cluster: "parity", tier: "T1", score: x, confidence: 0.5, assisted: false, at };
      state = applyRep(state, rep);
      modelS.push(state.skill);
    }

    expect(diagS).toHaveLength(modelS.length);
    for (let i = 0; i < xs.length; i++) expect(Math.abs(diagS[i]! - modelS[i]!)).toBeLessThan(1e-12);
  });

  it("skillUpdate n accumulates by weight", () => {
    expect(skillUpdate(0.5, 2, 1, 1).n).toBe(3);
    expect(skillUpdate(0.5, 2, 1, 1.5).n).toBe(3.5);
  });
});

// ============================================================================
// Per-rep score blend (§6.2)
// ============================================================================

describe("repScore (§6.2)", () => {
  it("T1 blends speed: correct-but-slow is partially decayed", () => {
    const rep = mkRep("r", "T1", "syntax_idioms", { targetSeconds: 10 });
    expect(repScore(rep, mkResult("r", 0.8, "fairlySure", { elapsedSeconds: 20 }))).toBeCloseTo(0.4, 10);
  });
  it("rawScore 0 ⇒ x 0 regardless of speed", () => {
    const rep = mkRep("r", "T1", "syntax_idioms", { targetSeconds: 30 });
    expect(repScore(rep, mkResult("r", 0, "fairlySure", { elapsedSeconds: 1 }))).toBe(0);
  });
  it("T2/T3 ignore speed", () => {
    const rep = mkRep("r", "T2", "debugging", { targetSeconds: 10 });
    expect(repScore(rep, mkResult("r", 0.7, "fairlySure", { elapsedSeconds: 9999 }))).toBe(0.7);
  });
  it("elapsedSeconds = 0 is guarded", () => {
    const rep = mkRep("r", "T1", "syntax_idioms", { targetSeconds: 30 });
    expect(repScore(rep, mkResult("r", 1, "fairlySure", { elapsedSeconds: 0 }))).toBe(1);
  });
});

// ============================================================================
// Verification scorers
// ============================================================================

describe("scoreRep verifiers", () => {
  it("mcq", () => {
    const rep = ILLUSTRATIVE_REPS[0]!;
    expect(scoreRep(rep, { kind: "mcq", choiceIndex: 1 })).toBe(1);
    expect(scoreRep(rep, { kind: "mcq", choiceIndex: 0 })).toBe(0);
  });
  it("numeric_tol (exact and relative)", () => {
    const rep = ILLUSTRATIVE_REPS[1]!;
    expect(scoreRep(rep, { kind: "numeric_tol", value: 20 })).toBe(1);
    expect(scoreRep(rep, { kind: "numeric_tol", value: 21 })).toBe(0);
    const rel = mkRep("n", "T1", "complexity_estimation", {
      format: "numeric_tol",
      payload: { expected: 1000, tolerance: 0.1, relative: true } satisfies NumericTolPayload,
    });
    expect(scoreRep(rel, { kind: "numeric_tol", value: 1080 })).toBe(1);
    expect(scoreRep(rel, { kind: "numeric_tol", value: 1200 })).toBe(0);
  });
  it("exact (normalised, case-insensitive by default)", () => {
    const rep = mkRep("e", "T2", "code_reading", {
      format: "exact",
      payload: { expected: "Hello World" } satisfies ExactPayload,
    });
    expect(scoreRep(rep, { kind: "exact", value: "  hello   world " })).toBe(1);
  });
  it("rubric_program → rights-minus-wrongs (over-selection penalised)", () => {
    const rep = ILLUSTRATIVE_REPS[2]!;
    expect(
      scoreRep(rep, { kind: "rubric_program", satisfied: ["mutates_input", "quadratic_membership_test"] }),
    ).toBeCloseTo(2 / 3, 10);
    expect(
      scoreRep(rep, {
        kind: "rubric_program",
        satisfied: ["mutates_input", "quadratic_membership_test", "unstable_order"],
      }),
    ).toBe(1);
    const wide = mkRep("w", "T2", "debugging", { format: "rubric_program", payload: { checks: ["a", "b"] } });
    expect(scoreRep(wide, { kind: "rubric_program", satisfied: ["a", "b", "c", "d"] })).toBe(0);
  });
  it("unit_test → pass fraction passthrough", () => {
    const rep = mkRep("u", "T2", "debugging", {
      format: "unit_test",
      payload: { totalTests: 10 } satisfies UnitTestPayload,
    });
    expect(scoreRep(rep, { kind: "unit_test", passed: 7, total: 10 })).toBeCloseTo(0.7, 10);
  });
  it("throws on submission/format mismatch", () => {
    expect(() => scoreRep(ILLUSTRATIVE_REPS[0]!, { kind: "exact", value: "x" })).toThrow();
  });
});

// ============================================================================
// Intake prior (§5)
// ============================================================================

describe("intakePrior (§5)", () => {
  it("worked-example T1 prior = 0.5", () => {
    expect(intakePrior(FULL_SHARP).priorSkill.T1).toBeCloseTo(0.5, 10);
  });
  it("clamps to [PRIOR_FLOOR, PRIOR_CEIL]", () => {
    const worst = intakePrior({ timeline: 2, delegation: 2, recency: 2, reserve: 2, confidence: 2 });
    expect(worst.priorSkill.T1).toBe(0.15);
    const best = intakePrior({ timeline: 0, delegation: 0, recency: 0, reserve: 0, confidence: 0 });
    expect(best.priorSkill.T1).toBe(0.95);
  });
  it("intakeOverconfidenceHint fires when self-rating ≫ priors", () => {
    expect(intakePrior({ timeline: 2, delegation: 2, recency: 2, reserve: 2, confidence: 2 }).intakeOverconfidenceHint).toBe(true);
    expect(intakePrior({ timeline: 2, delegation: 2, recency: 2, reserve: 2, confidence: 0 }).intakeOverconfidenceHint).toBe(false);
  });
  it("rejects malformed answers (§9)", () => {
    expect(() => intakePrior({ ...FULL_SHARP, timeline: 3 as never })).toThrow(RangeError);
  });
});

// ============================================================================
// Edge cases (§9)
// ============================================================================

describe("edge cases (§9)", () => {
  it("all reps wrong → clamp prevents absolute-zero skill", () => {
    const reps = Array.from({ length: 8 }, (_, i) => mkRep(`z${i}`, "T2", "debugging"));
    const results = reps.map((r) => mkResult(r.id, 0, "fairlySure"));
    const out = computeDiagnostic(FULL_SHARP, reps, results, [], ISO);
    const t2 = out.tiers.find((t) => t.tier === "T2")!;
    expect(t2.latentSkill).toBeGreaterThanOrEqual(DIAGNOSTIC_CONFIG.SKILL_FLOOR);
    expect(t2.atrophyIndex).toBeLessThanOrEqual(98);
  });

  it("SKILL_FLOOR / SKILL_CEIL clamps actually bind", () => {
    const hot: DiagnosticConfig = { ...DIAGNOSTIC_CONFIG, ALPHA0: 2, N_SCALE: 1000 };
    const t1reps = ["a", "b", "c"].map((id) => mkRep(id, "T1", "syntax_idioms"));
    const lo = computeDiagnostic(FULL_SHARP, t1reps, t1reps.map((r) => mkResult(r.id, 0, "guess")), [], ISO, hot);
    expect(lo.tiers.find((t) => t.tier === "T1")!.latentSkill).toBe(0.02);
    const hi = computeDiagnostic(FULL_SHARP, t1reps, t1reps.map((r) => mkResult(r.id, 1, "certain")), [], ISO, hot);
    expect(hi.tiers.find((t) => t.tier === "T1")!.latentSkill).toBe(0.98);
  });

  it("assisted rep: skill-excluded, clean-window-excluded, integrityOk false", () => {
    const reps = [mkRep("ok", "T2", "debugging"), mkRep("ai", "T2", "debugging")];
    const withAssist = computeDiagnostic(
      FULL_SHARP,
      reps,
      [mkResult("ok", 0.8, "confident"), mkResult("ai", 1.0, "certain", { assisted: true })],
      [],
      ISO,
    );
    const onlyClean = computeDiagnostic(FULL_SHARP, reps, [mkResult("ok", 0.8, "confident")], [], ISO);
    expect(withAssist.tiers.find((t) => t.tier === "T2")!.latentSkill).toBeCloseTo(
      onlyClean.tiers.find((t) => t.tier === "T2")!.latentSkill,
      12,
    );
    expect(withAssist.scoredRepCount).toBe(1);
    expect(withAssist.integrityOk).toBe(false);
    expect(onlyClean.integrityOk).toBe(true);
  });

  it("assistedRepsInCalibration valve keeps assisted reps in the clean window", () => {
    const cfg: DiagnosticConfig = { ...DIAGNOSTIC_CONFIG, assistedRepsInCalibration: true };
    const reps = [mkRep("ok", "T2", "debugging"), mkRep("ai", "T2", "debugging")];
    const out = computeDiagnostic(
      FULL_SHARP,
      reps,
      [mkResult("ok", 0.8, "confident"), mkResult("ai", 1.0, "certain", { assisted: true })],
      [],
      ISO,
      cfg,
    );
    expect(out.scoredRepCount).toBe(2);
    expect(out.integrityOk).toBe(false);
  });

  it("ratedAfterFeedback reps are excluded from the clean window (ongoing hook)", () => {
    const reps = [mkRep("a", "T2", "debugging"), mkRep("b", "T2", "debugging")];
    const out = computeDiagnostic(
      FULL_SHARP,
      reps,
      [mkResult("a", 0.8, "confident"), mkResult("b", 0.4, "confident", { ratedAfterFeedback: true })],
      [],
      ISO,
    );
    expect(out.cleanGapWindow).toHaveLength(1); // only rep a
    expect(out.postFeedbackGapWindow).toHaveLength(1); // rep b tracked separately
    expect(out.scoredRepCount).toBe(1);
  });

  it("missing confidence: excluded from clean window, still updates skill", () => {
    const reps = [mkRep("a", "T2", "debugging"), mkRep("b", "T2", "debugging")];
    const out = computeDiagnostic(
      FULL_SHARP,
      reps,
      [mkResult("a", 0.8, "confident"), mkResult("b", 0.4, null)],
      [],
      ISO,
    );
    expect(out.tiers.find((t) => t.tier === "T2")!.observations).toBe(DIAGNOSTIC_CONFIG.priorStrength + 2);
    expect(out.scoredRepCount).toBe(1);
  });

  it("abandoned mid-session: empty tiers emit prior-only estimates, flag null", () => {
    const out = computeDiagnostic(FULL_SHARP, [mkRep("a", "T1", "syntax_idioms")], [mkResult("a", 0.9, "confident")], [], ISO);
    const prior = intakePrior(FULL_SHARP);
    const t3 = out.tiers.find((t) => t.tier === "T3")!;
    expect(t3.observations).toBe(DIAGNOSTIC_CONFIG.priorStrength);
    expect(t3.latentSkill).toBeCloseTo(prior.priorSkill.T3, 12);
    expect(out.overconfidenceFlag).toBeNull();
  });

  it("clusters with no rep: reliable false, observations = priorStrength", () => {
    const out = computeDiagnostic(FULL_SHARP, [mkRep("a", "T2", "debugging")], [mkResult("a", 0.9, "confident")], [], ISO);
    const derivation = out.clusters.find((c) => c.cluster === "derivation")!;
    expect(derivation.observations).toBe(DIAGNOSTIC_CONFIG.priorStrength);
    expect(derivation.reliable).toBe(false);
    expect(out.clusters).toHaveLength(ALL_CLUSTERS.length);
  });

  it("rejects out-of-range rawScore, bad confidence label, and unknown ids", () => {
    const reps = [mkRep("a", "T2", "debugging")];
    expect(() => computeDiagnostic(FULL_SHARP, reps, [mkResult("a", 1.5, "guess")], [], ISO)).toThrow(RangeError);
    expect(() => computeDiagnostic(FULL_SHARP, reps, [mkResult("a", 0.5, "verysure" as never)], [], ISO)).toThrow(RangeError);
    expect(() => computeDiagnostic(FULL_SHARP, [], [mkResult("ghost", 0.5, "guess")], [], ISO)).toThrow(RangeError);
    expect(() => computeDiagnostic(FULL_SHARP, reps, [mkResult("a", 0.5, "guess")], mkPriors(["T9" as never, "guess"]), ISO)).toThrow(RangeError);
  });
});

// ============================================================================
// globalGap flag, bands, determinism
// ============================================================================

describe("globalGap flag, bands, determinism", () => {
  // Use all 3 tiers (T1 + T2 + T3) to meet MIN_CLUSTERS_FOR_FLAG = 3.
  function allTierReps(): BaselineRep[] {
    return [
      mkRep("t1a", "T1", "syntax_idioms"), mkRep("t1b", "T1", "syntax_idioms"),
      mkRep("t2a", "T2", "debugging"), mkRep("t2b", "T2", "debugging"),
      mkRep("t3a", "T3", "system_design"), mkRep("t3b", "T3", "system_design"),
    ];
  }

  it("flag true when tier priors overshoot accuracy across all 3 tiers", () => {
    const reps = allTierReps();
    const results = reps.map((r) => mkResult(r.id, 0.5, "fairlySure")); // accuracy 0.5 per tier
    const priors = mkPriors(["T1", "certain"], ["T2", "certain"], ["T3", "certain"]); // 0.95
    const out = computeDiagnostic(FULL_SHARP, reps, results, priors, ISO);
    expect(out.globalGap).toBeCloseTo(0.45, 4); // 0.95 − 0.5
    expect(out.overconfidenceFlag).toBe(true);
  });

  it("flag false when tier priors track accuracy", () => {
    const reps = allTierReps();
    const results = reps.map((r) => mkResult(r.id, 0.5, "fairlySure"));
    const priors = mkPriors(["T1", "leaning"], ["T2", "leaning"], ["T3", "leaning"]); // 0.4
    const out = computeDiagnostic(FULL_SHARP, reps, results, priors, ISO);
    expect(out.globalGap).toBeCloseTo(-0.1, 4); // 0.4 − 0.5
    expect(out.overconfidenceFlag).toBe(false);
  });

  it("flag null below MIN_CLUSTERS_FOR_FLAG (fewer than 3 tiers rated)", () => {
    const reps = Array.from({ length: 8 }, (_, i) => mkRep(`d${i}`, "T2", "debugging"));
    const results = reps.map((r) => mkResult(r.id, 0.5, "certain"));
    // only T2 rated → 1 usable tier < 3
    const out = computeDiagnostic(FULL_SHARP, reps, results, mkPriors(["T2", "certain"]), ISO);
    expect(out.overconfidenceFlag).toBeNull();
  });

  it("riskBandFor boundaries (<35 / 35–64 / ≥65)", () => {
    expect(riskBandFor(34.999)).toBe("Low");
    expect(riskBandFor(35)).toBe("Moderate");
    expect(riskBandFor(64.999)).toBe("Moderate");
    expect(riskBandFor(65)).toBe("High");
  });

  it("deterministic: identical inputs → deep-equal result", () => {
    const reps = ILLUSTRATIVE_REPS;
    const results = reps.map((r, i) =>
      gradeSubmission(r, ILLUSTRATIVE_SUBMISSIONS[i]!, { confidence: "confident", elapsedSeconds: 10, assisted: false }),
    );
    const priors = mkPriors(["T1", "confident"], ["T2", "leaning"], ["T3", "fairlySure"]);
    expect(computeDiagnostic(FULL_SHARP, reps, results, priors, ISO)).toEqual(
      computeDiagnostic(FULL_SHARP, reps, results, priors, ISO),
    );
  });
});

// ============================================================================
// Integration — illustrative reps through the whole pipeline + handoff
// ============================================================================

describe("integration: illustrative battery", () => {
  const results = ILLUSTRATIVE_REPS.map((r, i) =>
    gradeSubmission(r, ILLUSTRATIVE_SUBMISSIONS[i]!, { confidence: "confident", elapsedSeconds: 10, assisted: false }),
  );
  const priors = mkPriors(["T1", "confident"], ["T2", "fairlySure"], ["T3", "leaning"]);
  const result = computeDiagnostic(FULL_SHARP, ILLUSTRATIVE_REPS, results, priors, ISO);

  it("returns a well-formed v3 DiagnosticResult", () => {
    expect(result.schemaVersion).toBe(3);
    expect(result.generatedAt).toBe(ISO);
    expect(result.tiers).toHaveLength(3);
    expect(result.clusters).toHaveLength(ALL_CLUSTERS.length);
    expect(result.tierCalibration).toHaveLength(3);
    expect(result.integrityOk).toBe(true);
    expect(["Low", "Moderate", "High"]).toContain(result.riskBand);
  });

  it("scores the graded submissions (mcq✓, numeric✓, rubric 2/3, mcq✗)", () => {
    expect(results[0]!.rawScore).toBe(1);
    expect(results[1]!.rawScore).toBe(1);
    expect(results[2]!.rawScore).toBeCloseTo(2 / 3, 10);
    expect(results[3]!.rawScore).toBe(0);
  });

  it("toSkillStates emits one SkillState per cluster at generatedAt", () => {
    const states = toSkillStates(result);
    expect(states).toHaveLength(ALL_CLUSTERS.length);
    for (const s of states) expect(s.lastRepAt).toBe(ISO);
  });
});
