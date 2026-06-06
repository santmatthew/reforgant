/**
 * Unprompted — Atrophy & Recovery System v2 · Subsystem 1: the Diagnostic.
 *
 * Turns a new developer into a seeded model state in one sitting:
 *   Part A — Intake (5 questions) → a weak per-tier skill prior.
 *   Part B — Baseline (~15 unassisted reps + pre-attempt confidence) → measured
 *            per-cluster skill and a measured confidence/accuracy gap.
 *
 * Output: a `DiagnosticResult` that seeds the Model subsystem (one `SkillState`
 * per cluster), plus the headline UI numbers (atrophy index, risk band,
 * overconfidence flag).
 *
 * Every function here is PURE and DETERMINISTIC: no I/O, no clock (the caller
 * passes `generatedAt`). The skill-update filter is reimplemented to support
 * within-tier weighting; `diagnostic.test.ts` asserts it is bit-identical to the
 * Model's `applyRep` on the shared (weight = 1, no-decay) slice.
 *
 * Implements spec/spec.md. Section references (§) point at that document.
 */

// ============================================================================
// Types — output contract (§3)
// ============================================================================

export type Tier = "T1" | "T2" | "T3";

export type ClusterId =
  // T1 — Quick Recall (speed-based, closed-loop, fast decay)
  | "syntax_idioms"
  | "complexity_estimation"
  | "mental_sizing"
  // T2 — Scenario Analysis (accuracy-based, mixed-loop, fast→medium decay)
  | "debugging"
  | "code_reading"
  | "structure_choice"
  // T3 — First Principles (open-loop, expertise-buffered, slow decay)
  | "system_design"
  | "scaling_reasoning"
  | "derivation";

export interface ClusterEstimate {
  cluster: ClusterId;
  tier: Tier;
  /** [SKILL_FLOOR, SKILL_CEIL] = [0.02, 0.98] */
  latentSkill: number;
  /** n, includes the prior pseudo-observations. */
  observations: number;
  /** (observations - priorStrength) >= RELIABLE_MIN_REPS */
  reliable: boolean;
}

export interface TierEstimate {
  tier: Tier;
  /** [0.02, 0.98] */
  latentSkill: number;
  /** (1 - latentSkill) * 100 */
  atrophyIndex: number;
  observations: number;
}

/** Per-tier walked-in belief vs measured reality (v2.1). */
export interface TierCalibration {
  tier: Tier;
  priorLabel: ConfidenceLabel; // the tier-level rating captured before any items
  priorProb: number; // confidenceToProb(priorLabel)
  measuredAccuracy: number; // mean clean score x for this tier (0 if none)
  gap: number; // priorProb - measuredAccuracy (>0 = walked in overconfident)
  cleanReps: number; // clean (pre-feedback, unassisted) scored reps for this tier
}

export interface DiagnosticResult {
  clusters: ClusterEstimate[];
  tiers: TierEstimate[]; // length 3, ordered T1, T2, T3
  overallAtrophyIndex: number; // mean of tier atrophy indices
  riskBand: "Low" | "Moderate" | "High"; // <35 / 35–64 / ≥65
  /**
   * HEADLINE over/under-confidence (v2.1): mean over clusters of (class-prior
   * probability − measured clean accuracy). Signed; >0 = walked in overconfident.
   * Computed from uncontaminated class-level priors — the trustworthy read.
   */
  globalGap: number;
  tierCalibration: TierCalibration[]; // per-tier breakdown behind globalGap (length ≤ 3)
  overconfidenceFlag: boolean | null; // from globalGap; null if too little data
  intakeOverconfidenceHint: boolean; // soft, pre-baseline (§5.4)
  /**
   * Per-item (confidenceProb − accuracy) for clean (pre-feedback, unassisted)
   * reps. Carried as the ongoing-calibration hook — NOT a headline metric.
   */
  cleanGapWindow: number[];
  /** Per-item gaps for reps rated AFTER feedback (empty in the baseline). */
  postFeedbackGapWindow: number[];
  priorStrength: number; // pseudo-obs carried from intake
  integrityOk: boolean; // false if assisted reps detected
  scoredRepCount: number; // clean scored reps with a confidence rating
  generatedAt: string; // ISO 8601, supplied by caller
  schemaVersion: 3;
}

/** Consumed by the Model: the persistence layer derives one per cluster. */
export interface SkillState {
  cluster: ClusterId;
  tier: Tier;
  latentSkill: number;
  observations: number;
  lastRepAt: string; // = generatedAt at handoff
}

// ============================================================================
// Types — inputs (§4)
// ============================================================================

export type IntakeAnswer = 0 | 1 | 2; // higher = more decay risk

export interface IntakeResponses {
  timeline: IntakeAnswer; // Q1: <6mo=0, 1–2yr=1, 3+yr=2
  delegation: IntakeAnswer; // Q2: rarely=0, sometimes=1, almost always=2
  recency: IntakeAnswer; // Q3: this week=0, this month=1, can't remember=2
  reserve: IntakeAnswer; // Q4: 8+yr=0, 3–7yr=1, 0–2yr=2 (already inverted)
  confidence: IntakeAnswer; // Q5: worried=0, rusty=1, still sharp=2 (self-rated)
}

/**
 * 5-point ordinal confidence scale (v2.1). Captured as a LABEL, never a slider
 * float — a float invites users to nudge it against how earlier reps of the same
 * class felt. Mapped to a probability via `confidenceToProb`, floored at the
 * rep's guessing baseline.
 */
export type ConfidenceLabel = "guess" | "leaning" | "fairlySure" | "confident" | "certain";

export const CONFIDENCE_LABELS: ConfidenceLabel[] = [
  "guess",
  "leaning",
  "fairlySure",
  "confident",
  "certain",
];

/**
 * A walked-in, tier-level belief captured BEFORE any item of that tier is shown
 * (v2.1). Three ratings (Quick Recall / Scenario Analysis / First Principles) keep
 * the pre-session screen short while still isolating the uncontaminated signal.
 */
export interface ClassPrior {
  tier: Tier;
  confidence: ConfidenceLabel;
}

export type VerificationKind =
  | "mcq" // single correct choice
  | "exact" // exact string/value match (normalised)
  | "numeric_tol" // numeric within tolerance
  | "unit_test" // submitted code run against hidden harness → pass fraction
  | "rubric_program"; // checklist of programmatically-detectable points → fraction

export interface BaselineRep {
  id: string;
  tier: Tier;
  cluster: ClusterId;
  prompt: string;
  format: VerificationKind;
  payload: unknown; // format-specific (see the *Payload types below)
  targetSeconds: number; // speed scoring (T1); informational for T2/T3
  weight: number; // within-tier weight; debugging > others (§6)
}

export interface BaselineRepResult {
  repId: string;
  /**
   * Ordinal confidence captured BEFORE the attempt (v2.1). `null` = not captured
   * → excluded from calibration, still updates skill (§9).
   */
  confidence: ConfidenceLabel | null;
  rawScore: number; // correctness ∈ [0,1] from the verifier
  elapsedSeconds: number;
  assisted: boolean; // must be false to count toward skill
  /**
   * Whether the confidence rating was given AFTER seeing per-item feedback. In
   * the baseline this is always false (feedback is withheld until session end),
   * so every baseline rating is "clean". The ongoing-practice loop sets it true
   * for every rep after the first-unseen probe of a session; such reps are
   * excluded from the trustworthy calibration read. (The ongoing hook.)
   */
  ratedAfterFeedback: boolean;
}

// ============================================================================
// Tunables — single exported config (§8). Every value is a calibrated prior.
// ============================================================================

export interface DiagnosticConfig {
  priorStrength: number;
  PRIOR_FLOOR: number;
  PRIOR_CEIL: number;
  tierWeights: {
    T1: { timeline: number; delegation: number };
    T2: { recency: number; reserve: number };
    T3: { reserve: number; timeline: number };
  };
  ALPHA0: number;
  N_SCALE: number;
  ALPHA_MAX: number;
  debuggingWeight: number;
  SKILL_FLOOR: number;
  SKILL_CEIL: number;
  /** Ordinal confidence label → probability (v2.1), before the guessing floor. */
  confidenceProb: Record<ConfidenceLabel, number>;
  /** signedGap above which the overconfidence flag fires (now on globalGap). */
  overconfidenceThreshold: number;
  MIN_OBS_FOR_FLAG: number; // min clean scored reps before the flag is non-null
  MIN_CLUSTERS_FOR_FLAG: number; // min clusters with a prior + clean reps for globalGap
  RELIABLE_MIN_REPS: number;
  intakeHintThreshold: number;
  /**
   * Safety valve: OFF by default — assisted reps are excluded from BOTH skill and
   * calibration. Flip to `true` to keep assisted reps in the calibration windows.
   */
  assistedRepsInCalibration: boolean;
}

export const DIAGNOSTIC_CONFIG: DiagnosticConfig = {
  priorStrength: 2,
  PRIOR_FLOOR: 0.15,
  PRIOR_CEIL: 0.95,
  tierWeights: {
    T1: { timeline: 0.6, delegation: 0.4 }, // Q1, Q2
    T2: { recency: 0.55, reserve: 0.45 }, // Q3, Q4
    T3: { reserve: 0.8, timeline: 0.2 }, // Q4 dominant
  },
  ALPHA0: 0.4,
  N_SCALE: 5,
  ALPHA_MAX: 0.9,
  debuggingWeight: 1.5,
  SKILL_FLOOR: 0.02,
  SKILL_CEIL: 0.98,
  confidenceProb: { guess: 0.2, leaning: 0.4, fairlySure: 0.6, confident: 0.8, certain: 0.95 },
  overconfidenceThreshold: 0.15,
  MIN_OBS_FOR_FLAG: 6,
  MIN_CLUSTERS_FOR_FLAG: 3,
  RELIABLE_MIN_REPS: 6,
  intakeHintThreshold: 0.3,
  assistedRepsInCalibration: false,
};

// ============================================================================
// Cluster topology + battery composition (§6.1)
// ============================================================================

export const CLUSTER_TIER: Record<ClusterId, Tier> = {
  syntax_idioms: "T1",
  complexity_estimation: "T1",
  mental_sizing: "T1",
  debugging: "T2",
  code_reading: "T2",
  structure_choice: "T2",
  system_design: "T3",
  scaling_reasoning: "T3",
  derivation: "T3",
};

export const ALL_CLUSTERS: ClusterId[] = [
  "syntax_idioms",
  "complexity_estimation",
  "mental_sizing",
  "debugging",
  "code_reading",
  "structure_choice",
  "system_design",
  "scaling_reasoning",
  "derivation",
];

export const TIERS: Tier[] = ["T1", "T2", "T3"];

export interface BatterySlot {
  cluster: ClusterId;
  tier: Tier;
  reps: number;
  weight: number;
}

/** The 15-rep baseline shape. Content is out of scope (§2); this is the contract. */
export const BATTERY_COMPOSITION: BatterySlot[] = [
  { cluster: "syntax_idioms", tier: "T1", reps: 2, weight: 1.0 },
  { cluster: "complexity_estimation", tier: "T1", reps: 2, weight: 1.0 },
  { cluster: "mental_sizing", tier: "T1", reps: 1, weight: 1.0 },
  { cluster: "debugging", tier: "T2", reps: 3, weight: DIAGNOSTIC_CONFIG.debuggingWeight },
  { cluster: "code_reading", tier: "T2", reps: 2, weight: 1.0 },
  { cluster: "structure_choice", tier: "T2", reps: 1, weight: 1.0 },
  { cluster: "system_design", tier: "T3", reps: 2, weight: 1.0 },
  { cluster: "scaling_reasoning", tier: "T3", reps: 1, weight: 1.0 },
  { cluster: "derivation", tier: "T3", reps: 1, weight: 1.0 },
];

// ============================================================================
// Small helpers
// ============================================================================

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function isUnit(x: number): boolean {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

// ============================================================================
// The shared skill-update filter (§7.1)
// ============================================================================

export interface FilterStep {
  S: number;
  n: number;
}

/**
 * One observation of the skill filter (§7.1). Pure.
 *
 *   alphaRaw = ALPHA0 / (1 + n / N_SCALE)
 *   alphaEff = clamp(alphaRaw * weight, 0, ALPHA_MAX)
 *   S        = S + alphaEff * (x - S)
 *   n        = n + weight
 *
 * No per-rep clamp on S (the spec clamps only at finalisation, §7.2); for valid
 * inputs the convex update keeps S in range anyway. Equivalent to the Model's
 * `applyRep` skill step when weight = 1 and decay R(t) = 1 — asserted in tests.
 */
export function skillUpdate(
  S: number,
  n: number,
  x: number,
  weight: number,
  cfg: DiagnosticConfig = DIAGNOSTIC_CONFIG,
): FilterStep {
  const alphaRaw = cfg.ALPHA0 / (1 + n / cfg.N_SCALE);
  const alphaEff = clamp(alphaRaw * weight, 0, cfg.ALPHA_MAX);
  return { S: S + alphaEff * (x - S), n: n + weight };
}

// ============================================================================
// Part A — Intake → prior (§5)
// ============================================================================

function assertIntakeAnswer(v: unknown, field: string): asserts v is IntakeAnswer {
  if (v !== 0 && v !== 1 && v !== 2) {
    throw new RangeError(`Intake answer "${field}" must be 0, 1, or 2; got ${JSON.stringify(v)}`);
  }
}

export interface IntakePrior {
  priorDecay: Record<Tier, number>;
  priorSkill: Record<Tier, number>;
  selfConfidence: number; // Q5 / 2 → 0, 0.5, 1.0
  intakeOverconfidenceHint: boolean;
}

/**
 * Intake → weak per-tier prior (§5). Drivers and weights follow the v2 tier
 * table; weights sum to 1 within a tier, /2 lands decay in [0,1]. Rejects
 * malformed answers (§9).
 */
export function intakePrior(
  intake: IntakeResponses,
  cfg: DiagnosticConfig = DIAGNOSTIC_CONFIG,
): IntakePrior {
  assertIntakeAnswer(intake.timeline, "timeline");
  assertIntakeAnswer(intake.delegation, "delegation");
  assertIntakeAnswer(intake.recency, "recency");
  assertIntakeAnswer(intake.reserve, "reserve");
  assertIntakeAnswer(intake.confidence, "confidence");

  const w = cfg.tierWeights;
  const priorDecay: Record<Tier, number> = {
    T1: (w.T1.timeline * intake.timeline + w.T1.delegation * intake.delegation) / 2,
    T2: (w.T2.recency * intake.recency + w.T2.reserve * intake.reserve) / 2,
    T3: (w.T3.reserve * intake.reserve + w.T3.timeline * intake.timeline) / 2,
  };
  const priorSkill: Record<Tier, number> = {
    T1: clamp(1 - priorDecay.T1, cfg.PRIOR_FLOOR, cfg.PRIOR_CEIL),
    T2: clamp(1 - priorDecay.T2, cfg.PRIOR_FLOOR, cfg.PRIOR_CEIL),
    T3: clamp(1 - priorDecay.T3, cfg.PRIOR_FLOOR, cfg.PRIOR_CEIL),
  };

  // Q5 does NOT feed skill (§5.4); it only produces a soft pre-baseline hint.
  const selfConfidence = intake.confidence / 2;
  const meanPrior = mean([priorSkill.T1, priorSkill.T2, priorSkill.T3]);
  const intakeOverconfidenceHint = selfConfidence - meanPrior > cfg.intakeHintThreshold;

  return { priorDecay, priorSkill, selfConfidence, intakeOverconfidenceHint };
}

// ============================================================================
// Part B — verification kinds + scoring (§6.2)
// ============================================================================

export interface McqPayload {
  correctIndex: number;
  choices?: string[];
}
export interface ExactPayload {
  expected: string;
  caseSensitive?: boolean;
}
export interface NumericTolPayload {
  expected: number;
  tolerance: number;
  relative?: boolean; // tolerance as a fraction of |expected|
}
export interface RubricProgramPayload {
  /**
   * Ids of the correct programmatically-detectable points (the answer key).
   * Scoring is rights-minus-wrongs, so a UI presenting checkboxes must offer
   * DISTRACTORS too — carry the full option set in an extra payload field (e.g.
   * `options`), which `scoreRep` ignores. `checks` alone is not renderable.
   */
  checks: string[];
}
export interface UnitTestPayload {
  totalTests: number; // reference only; the pass fraction is supplied externally
}

export type Submission =
  | { kind: "mcq"; choiceIndex: number }
  | { kind: "exact"; value: string }
  | { kind: "numeric_tol"; value: number }
  | { kind: "rubric_program"; satisfied: string[] }
  | { kind: "unit_test"; passed: number; total: number };

function expectKind<K extends Submission["kind"]>(
  sub: Submission,
  kind: K,
  repId: string,
): Extract<Submission, { kind: K }> {
  if (sub.kind !== kind) {
    throw new TypeError(
      `Submission kind "${sub.kind}" does not match rep format "${kind}" for "${repId}"`,
    );
  }
  return sub as Extract<Submission, { kind: K }>;
}

/**
 * Programmatic verifier → rawScore ∈ [0,1] (§6.2). Deterministic and pure.
 *
 * Note `unit_test`: actually running submitted code against a hidden harness is
 * not pure, so the harness runs upstream and supplies the pass fraction here;
 * this scorer validates and passes it through (the serving path has no live LLM
 * and no in-process code execution — §2, §10.1).
 */
export function scoreRep(rep: BaselineRep, submission: Submission): number {
  switch (rep.format) {
    case "mcq": {
      const s = expectKind(submission, "mcq", rep.id);
      const p = rep.payload as McqPayload;
      return s.choiceIndex === p.correctIndex ? 1 : 0;
    }
    case "exact": {
      const s = expectKind(submission, "exact", rep.id);
      const p = rep.payload as ExactPayload;
      const norm = p.caseSensitive
        ? (t: string) => t.trim().replace(/\s+/g, " ")
        : normalizeText;
      return norm(s.value) === norm(p.expected) ? 1 : 0;
    }
    case "numeric_tol": {
      const s = expectKind(submission, "numeric_tol", rep.id);
      const p = rep.payload as NumericTolPayload;
      const tol = p.relative ? p.tolerance * Math.abs(p.expected) : p.tolerance;
      return Math.abs(s.value - p.expected) <= tol ? 1 : 0;
    }
    case "rubric_program": {
      // Rights-minus-wrongs (corrected for guessing): reward correctly-identified
      // points, PENALISE false alarms, so "tick every box" cannot score 1.0.
      //   tp = selected ids that are correct; fp = selected ids that are not.
      //   score = clamp((tp - fp) / |checks|, 0, 1).
      // A clean answer key with no false positives reduces to the old tp/|checks|.
      const s = expectKind(submission, "rubric_program", rep.id);
      const p = rep.payload as RubricProgramPayload;
      if (p.checks.length === 0) return 0;
      const correct = new Set(p.checks);
      const selected = new Set(s.satisfied);
      let tp = 0;
      for (const id of selected) if (correct.has(id)) tp++;
      const fp = selected.size - tp;
      return clamp((tp - fp) / p.checks.length, 0, 1);
    }
    case "unit_test": {
      const s = expectKind(submission, "unit_test", rep.id);
      if (s.total <= 0) return 0;
      return clamp(s.passed / s.total, 0, 1);
    }
  }
}

export interface GradeMeta {
  confidence: ConfidenceLabel | null;
  elapsedSeconds: number;
  assisted: boolean;
  /** Defaults false (baseline withholds feedback, so every rating is clean). */
  ratedAfterFeedback?: boolean;
}

/** Convenience: verify a submission and package it as a `BaselineRepResult`. */
export function gradeSubmission(
  rep: BaselineRep,
  submission: Submission,
  meta: GradeMeta,
): BaselineRepResult {
  return {
    repId: rep.id,
    confidence: meta.confidence,
    rawScore: scoreRep(rep, submission),
    elapsedSeconds: meta.elapsedSeconds,
    assisted: meta.assisted,
    ratedAfterFeedback: meta.ratedAfterFeedback ?? false,
  };
}

/**
 * Per-rep score x (§6.2). T1 blends in speed (a correct-but-slow answer is
 * partially decayed); T2/T3 are accuracy-only. rawScore === 0 ⇒ x = 0.
 */
export function repScore(rep: BaselineRep, result: BaselineRepResult): number {
  if (!isUnit(result.rawScore)) {
    throw new RangeError(
      `rawScore for rep "${result.repId}" must be in [0,1]; got ${result.rawScore}`,
    );
  }
  if (result.rawScore === 0) return 0;
  if (rep.tier === "T1") {
    const speedFactor = clamp(rep.targetSeconds / Math.max(result.elapsedSeconds, 1), 0, 1);
    return result.rawScore * speedFactor;
  }
  return result.rawScore;
}

// ============================================================================
// Confidence & calibration (v2.1)
// ============================================================================

function assertConfidenceLabel(v: unknown, repId: string): asserts v is ConfidenceLabel {
  if (!CONFIDENCE_LABELS.includes(v as ConfidenceLabel)) {
    throw new RangeError(
      `confidence for "${repId}" must be a ConfidenceLabel or null; got ${JSON.stringify(v)}`,
    );
  }
}

/** Chance score from blind guessing (the floor for a per-item confidence). §6.2. */
export function guessingBaseline(rep: BaselineRep): number {
  if (rep.format === "mcq") {
    const choices = (rep.payload as McqPayload).choices;
    const n = Array.isArray(choices) ? choices.length : 0;
    return n > 0 ? 1 / n : 0;
  }
  // exact / numeric_tol: effectively no guessing. rubric_program: rights-minus-
  // wrongs makes a random selection expect ≈ 0. So no floor.
  return 0;
}

/** Ordinal confidence label → probability, floored at the guessing baseline. */
export function confidenceToProb(
  label: ConfidenceLabel,
  guessingFloor = 0,
  cfg: DiagnosticConfig = DIAGNOSTIC_CONFIG,
): number {
  return Math.max(cfg.confidenceProb[label], guessingFloor);
}

/**
 * Headline over/under-confidence (v2.1): the mean tier-prior gap across tiers
 * that have a prior AND ≥1 clean scored rep. Positive ⇒ walked in overconfident.
 */
export function globalGap(perTier: TierCalibration[]): number {
  const usable = perTier.filter((t) => t.cleanReps > 0);
  return usable.length ? mean(usable.map((t) => t.gap)) : 0;
}

// ============================================================================
// Computation pipeline (§7)
// ============================================================================

interface ScoredRep {
  rep: BaselineRep;
  result: BaselineRepResult;
  x: number;
  hasConfidence: boolean;
  /** confidenceProb (label → prob, guessing-floored) when a rating is present. */
  confProb: number | null;
  /** Clean = pre-feedback, unassisted, rated → feeds cleanGapWindow / accuracy. */
  clean: boolean;
}

/** Calibration eligibility: rated, unassisted (valve), and pre-feedback (clean). */
function isClean(s: ScoredRep, cfg: DiagnosticConfig): boolean {
  if (!s.hasConfidence) return false;
  if (s.result.assisted && !cfg.assistedRepsInCalibration) return false;
  if (s.result.ratedAfterFeedback) return false;
  return true;
}

export function riskBandFor(index: number): "Low" | "Moderate" | "High" {
  return index >= 65 ? "High" : index >= 35 ? "Moderate" : "Low";
}

/**
 * The diagnostic (§7). Within a baseline session all reps occur at effectively
 * one instant, so the power-law decay R(t) ≈ 1 and is not applied between reps.
 *
 * Per-tier and per-cluster estimates are SEPARATE filters, each seeded
 * independently from the prior (§7.3) — never summed. Tier numbers are the
 * trustworthy ones at baseline; cluster numbers stay low-confidence until the
 * Model accumulates reps.
 */
export function computeDiagnostic(
  intake: IntakeResponses,
  reps: BaselineRep[],
  results: BaselineRepResult[],
  classPriors: ClassPrior[],
  generatedAt: string,
  cfg: DiagnosticConfig = DIAGNOSTIC_CONFIG,
): DiagnosticResult {
  const prior = intakePrior(intake, cfg);

  const repById = new Map<string, BaselineRep>();
  for (const rep of reps) repById.set(rep.id, rep);

  // Join results → reps in presentation (results) order; compute x; validate.
  const scored: ScoredRep[] = results.map((result) => {
    const rep = repById.get(result.repId);
    if (!rep) {
      throw new RangeError(`No BaselineRep matches result.repId "${result.repId}"`);
    }
    const hasConfidence = result.confidence !== null;
    if (hasConfidence) assertConfidenceLabel(result.confidence, result.repId);
    const x = repScore(rep, result); // also validates rawScore ∈ [0,1]
    const confProb = hasConfidence
      ? confidenceToProb(result.confidence as ConfidenceLabel, guessingBaseline(rep), cfg)
      : null;
    const s: ScoredRep = { rep, result, x, hasConfidence, confProb, clean: false };
    s.clean = isClean(s, cfg);
    return s;
  });

  const integrityOk = scored.every((s) => !s.result.assisted);

  // --- Per-tier estimate (operative, §7.2). Independent filter from the prior. ---
  const tiers: TierEstimate[] = TIERS.map((tier) => {
    let S = prior.priorSkill[tier];
    let n = cfg.priorStrength;
    for (const s of scored) {
      if (s.rep.tier !== tier || s.result.assisted) continue;
      const step = skillUpdate(S, n, s.x, s.rep.weight, cfg);
      S = step.S;
      n = step.n;
    }
    const latentSkill = clamp(S, cfg.SKILL_FLOOR, cfg.SKILL_CEIL);
    return { tier, latentSkill, atrophyIndex: (1 - latentSkill) * 100, observations: n };
  });

  // --- Per-cluster estimate (informational, §7.3). Prior re-seeded per cluster. ---
  const clusters: ClusterEstimate[] = ALL_CLUSTERS.map((cluster) => {
    const tier = CLUSTER_TIER[cluster];
    let S = prior.priorSkill[tier];
    let n = cfg.priorStrength;
    for (const s of scored) {
      if (s.rep.cluster !== cluster || s.result.assisted) continue;
      const step = skillUpdate(S, n, s.x, s.rep.weight, cfg);
      S = step.S;
      n = step.n;
    }
    const latentSkill = clamp(S, cfg.SKILL_FLOOR, cfg.SKILL_CEIL);
    return {
      cluster,
      tier,
      latentSkill,
      observations: n,
      reliable: n - cfg.priorStrength >= cfg.RELIABLE_MIN_REPS,
    };
  });

  // --- Calibration (v2.1). ---
  // Per-item windows: clean (pre-feedback) reps feed the trustworthy window; reps
  // rated after feedback are tracked separately and excluded. Carried as the hook.
  const cleanGapWindow = scored
    .filter((s) => s.clean)
    .map((s) => (s.confProb as number) - s.x);
  const postFeedbackGapWindow = scored
    .filter((s) => s.hasConfidence && s.result.ratedAfterFeedback && !s.result.assisted)
    .map((s) => (s.confProb as number) - s.x);
  const scoredRepCount = cleanGapWindow.length;

  // Tier-level calibration: each walked-in prior vs measured clean accuracy for that tier.
  const validTiers = new Set<Tier>(TIERS);
  const tierCalibration: TierCalibration[] = classPriors.map((cp) => {
    if (!validTiers.has(cp.tier)) {
      throw new RangeError(`Unknown classPrior tier "${cp.tier}"`);
    }
    assertConfidenceLabel(cp.confidence, `classPrior:${cp.tier}`);
    const tierUnassisted = scored.filter((s) => s.rep.tier === cp.tier && !s.result.assisted);
    const measuredAccuracy = mean(tierUnassisted.map((s) => s.x));
    const priorProb = confidenceToProb(cp.confidence, 0, cfg); // a belief, not a guess → no floor
    return {
      tier: cp.tier,
      priorLabel: cp.confidence,
      priorProb,
      measuredAccuracy,
      gap: priorProb - measuredAccuracy,
      cleanReps: tierUnassisted.length,
    };
  });

  const gGap = globalGap(tierCalibration);
  const usableTiers = tierCalibration.filter((t) => t.cleanReps > 0).length;
  // With 3 tiers the flag requires all 3 to have clean reps (MIN_CLUSTERS_FOR_FLAG stays at 3).
  const overconfidenceFlag =
    usableTiers >= cfg.MIN_CLUSTERS_FOR_FLAG && scoredRepCount >= cfg.MIN_OBS_FOR_FLAG
      ? gGap > cfg.overconfidenceThreshold
      : null;

  // --- Headline (§7.5). ---
  const overallAtrophyIndex = mean(tiers.map((t) => t.atrophyIndex));

  return {
    clusters,
    tiers,
    overallAtrophyIndex,
    riskBand: riskBandFor(overallAtrophyIndex),
    globalGap: gGap,
    tierCalibration,
    overconfidenceFlag,
    intakeOverconfidenceHint: prior.intakeOverconfidenceHint,
    cleanGapWindow,
    postFeedbackGapWindow,
    priorStrength: cfg.priorStrength,
    integrityOk,
    scoredRepCount,
    generatedAt,
    schemaVersion: 3,
  };
}

/**
 * Handoff to the Model: one `SkillState` per cluster (§3). Clusters with no
 * baseline rep are still emitted, seeded at the tier prior.
 */
export function toSkillStates(result: DiagnosticResult): SkillState[] {
  return result.clusters.map((c) => ({
    cluster: c.cluster,
    tier: c.tier,
    latentSkill: c.latentSkill,
    observations: c.observations,
    lastRepAt: result.generatedAt,
  }));
}

// ============================================================================
// Illustrative reps (§2 ships 4 only; the template library is the real IP)
// ============================================================================

export const ILLUSTRATIVE_REPS: BaselineRep[] = [
  {
    id: "demo_t1_syntax_1",
    tier: "T1",
    cluster: "syntax_idioms",
    prompt: "Which expression returns a new list of the squares of `xs` (a list of ints), idiomatically in Python?",
    format: "mcq",
    payload: {
      correctIndex: 1,
      choices: [
        "map(xs, lambda x: x * x)",
        "[x * x for x in xs]",
        "xs.map(x => x * x)",
        "for x in xs: yield x * x",
      ],
    } satisfies McqPayload,
    targetSeconds: 20,
    weight: 1.0,
  },
  {
    id: "demo_t1_complexity_1",
    tier: "T1",
    cluster: "complexity_estimation",
    prompt:
      "A balanced binary search tree holds 2^20 (1,048,576) keys. Worst-case node comparisons for one lookup? Enter the integer.",
    format: "numeric_tol",
    payload: { expected: 20, tolerance: 0 } satisfies NumericTolPayload,
    targetSeconds: 30,
    weight: 1.0,
  },
  {
    id: "demo_t2_debug_1",
    tier: "T2",
    cluster: "debugging",
    prompt:
      "This dedupe helper mutates its input and is O(n^2). Select every defect the linter/harness can detect.",
    format: "rubric_program",
    payload: {
      checks: ["mutates_input", "quadratic_membership_test", "unstable_order"],
    } satisfies RubricProgramPayload,
    targetSeconds: 120,
    weight: DIAGNOSTIC_CONFIG.debuggingWeight,
  },
  {
    id: "demo_t3_scaling_1",
    tier: "T3",
    cluster: "scaling_reasoning",
    prompt:
      "A read-heavy service at 50k RPS sees p99 spikes whenever a popular key is written. Which single change best addresses the ROOT bottleneck? (constrained choice)",
    format: "mcq",
    payload: {
      correctIndex: 2,
      choices: [
        "Add more application servers behind the load balancer",
        "Increase the database connection pool size",
        "Add a read-through cache with write invalidation for hot keys",
        "Swap the JSON serializer for a faster one",
      ],
    } satisfies McqPayload,
    targetSeconds: 180,
    weight: 1.0,
  },
];

/** Sample submissions for the illustrative reps (correct, correct, 2/3, wrong). */
export const ILLUSTRATIVE_SUBMISSIONS: Submission[] = [
  { kind: "mcq", choiceIndex: 1 },
  { kind: "numeric_tol", value: 20 },
  { kind: "rubric_program", satisfied: ["mutates_input", "quadratic_membership_test"] },
  { kind: "mcq", choiceIndex: 0 },
];
