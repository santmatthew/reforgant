# Unprompted — Diagnostic v2 Implementation Spec
*Subsystem 1 of the Atrophy & Recovery System v2 · Developer vertical · build target for Claude Code*

This is an **implementation spec**, not a design doc. It is written to be handed to Claude Code and turned into TypeScript with a passing test suite. It assumes `unprompted-atrophy-model-v2.md` and the `atrophy-model.ts` reference filter already exist; the diagnostic **reuses that filter** rather than inventing a parallel one.

The diagnostic produces the *initial state* that the Model subsystem then decays and updates over time. Get the contract right and everything downstream just runs.

---

## Changelog — v2.1 (confidence methodology)

The confidence-capture methodology described below (per-item **float** confidence → the §7.4 `confidenceGap`/`brier` calibration read) has been **superseded in code** to eliminate measurement contamination. The implementation (`diagnostic.ts`, output `schemaVersion: 3`) now does the following; treat this note as authoritative where it conflicts with the body.

- **Ordinal confidence.** Per-rep confidence is a 5-point label (`guess | leaning | fairlySure | confident | certain`), mapped to a probability by `confidenceToProb()` and floored at the rep's `guessingBaseline()` (`1/choices` for MCQ, 0 otherwise). `BaselineRepResult.confidence` is now `ConfidenceLabel | null`.
- **Class-level priors are the headline.** A single walked-in rating per cluster (`ClassPrior`, captured *before* any items) is compared to measured clean accuracy by `globalGap()` — the trustworthy over/under-confidence read. `overconfidenceFlag` now derives from `globalGap`, gated by `MIN_CLUSTERS_FOR_FLAG` + `MIN_OBS_FOR_FLAG`. The per-item `confidenceGap`/`brier` fields and `TierEstimate.confidenceGap` are **removed**; `globalGap` + `classCalibration[]` replace them.
- **Clean vs post-feedback windows.** Per-item ratings feed `cleanGapWindow`; `BaselineRepResult.ratedAfterFeedback` (always `false` in the baseline, where feedback is withheld) splits clean ratings from `postFeedbackGapWindow`. This is the hook for the ongoing-practice loop (feedback allowed; first-unseen item per session is the clean probe), which lives in the Model subsystem and is **not** built here.
- **API.** `computeDiagnostic(intake, reps, results, classPriors, generatedAt, cfg?)` gains the `classPriors` argument. The intake prior (§5), skill filter (§7.1–7.3), and risk band (§7.5) are unchanged.

---

## 1. Purpose

Turn a new developer user into a seeded model state in one ~12-minute sitting. Two parts:

- **Part A — Intake.** Five questions → a *weak prior* on skill per tier. Low confidence by design; it exists to make the first session feel personalised, then washes out.
- **Part B — Baseline session.** ~15 **unassisted** reps with a confidence rating captured *before* each attempt → the *real* baseline: measured per-cluster skill and a measured confidence–accuracy gap.

Output: a `DiagnosticResult` that seeds per-cluster `SkillState` for the model, plus the headline numbers for the UI (atrophy index, risk band, overconfidence flag).

The governing rule from v2 holds throughout: **self-report is a prior, behaviour is the evidence.** The intake is worth ~2 pseudo-observations; the baseline reps are worth real ones.

---

## 2. Scope and non-goals

In scope:
- Intake → prior skill per tier + prior strength.
- Baseline battery *contract* (structure, composition, verification kinds, scoring).
- The computation pipeline (intake prior + baseline reps → `DiagnosticResult`) **reusing the model's skill-update filter**.
- Deterministic, pure, testable functions.

Out of scope (do **not** build here):
- The actual baseline rep *content* — that is template-library work (the IP). This spec defines the contract and ships 4 illustrative reps only.
- The ongoing decay/scheduling loop — that's the Model and Recovery subsystems.
- Any live LLM call. The serving path has zero live LLM, so **every baseline rep must be programmatically scorable** (no free-text grading at runtime). See §10, Open decision 1.

---

## 3. Output contract (the important part)

```ts
type Tier = 'T1' | 'T2' | 'T3';

type ClusterId =
  // T1 — Quick Recall (speed-based, closed-loop, fast decay)
  | 'syntax_idioms' | 'complexity_estimation' | 'mental_sizing'
  // T2 — Scenario Analysis (accuracy-based, mixed-loop, fast→medium decay)
  | 'debugging' | 'code_reading' | 'structure_choice'
  // T3 — First Principles (open-loop, expertise-buffered, slow decay)
  | 'system_design' | 'scaling_reasoning' | 'derivation';

interface ClusterEstimate {
  cluster: ClusterId;
  tier: Tier;
  latentSkill: number;   // [0.02, 0.98]
  observations: number;  // n, includes prior pseudo-obs
  reliable: boolean;     // (observations - priorStrength) >= RELIABLE_MIN_REPS
}

interface TierEstimate {
  tier: Tier;
  latentSkill: number;   // [0.02, 0.98]
  atrophyIndex: number;  // (1 - latentSkill) * 100
  observations: number;
  confidenceGap: number; // signed, mean(c - x) over this tier's scored reps
}

interface DiagnosticResult {
  clusters: ClusterEstimate[];
  tiers: TierEstimate[];                 // length 3
  overallAtrophyIndex: number;           // mean of tier atrophy indices
  riskBand: 'Low' | 'Moderate' | 'High'; // <35 / 35–64 / ≥65
  confidenceGap: number;                 // signed, session-level mean(c - x)
  brier: number;                         // mean((c - x)^2)
  overconfidenceFlag: boolean | null;    // null if too few scored reps to judge
  intakeOverconfidenceHint: boolean;     // soft, pre-baseline (see §5.4)
  priorStrength: number;                 // pseudo-obs carried from intake
  integrityOk: boolean;                  // false if assisted reps detected
  scoredRepCount: number;
  generatedAt: string;                   // ISO 8601
  schemaVersion: 2;
}
```

`SkillState` consumed by the Model (each cluster seeds one):

```ts
interface SkillState {
  cluster: ClusterId;
  tier: Tier;
  latentSkill: number;
  observations: number;
  lastRepAt: string;        // = generatedAt at handoff
}
```

The diagnostic returns `DiagnosticResult`; the persistence layer derives one `SkillState` per cluster from `result.clusters` and writes them as the user's starting model state. Clusters with no baseline rep are still emitted, seeded at the tier prior with `observations = priorStrength` and `reliable = false`.

---

## 4. Inputs

```ts
type IntakeAnswer = 0 | 1 | 2; // higher = more decay risk

interface IntakeResponses {
  timeline: IntakeAnswer;   // Q1: <6mo=0, 1–2yr=1, 3+yr=2
  delegation: IntakeAnswer; // Q2: rarely=0, sometimes=1, almost always=2
  recency: IntakeAnswer;    // Q3: this week=0, this month=1, can't remember=2
  reserve: IntakeAnswer;    // Q4: 8+yr=0, 3–7yr=1, 0–2yr=2  (already inverted)
  confidence: IntakeAnswer; // Q5: worried=0, rusty=1, still sharp=2  (self-rated ability)
}

type VerificationKind =
  | 'mcq'              // single correct choice
  | 'exact'           // exact string/value match (normalised)
  | 'numeric_tol'     // numeric within tolerance
  | 'unit_test'       // submitted code run against hidden harness → pass fraction
  | 'rubric_program'; // checklist of programmatically-detectable points → fraction

interface BaselineRep {
  id: string;
  tier: Tier;
  cluster: ClusterId;
  prompt: string;
  format: VerificationKind;
  payload: unknown;      // format-specific: choices, expected value, test ref, rubric checks
  targetSeconds: number; // for speed scoring (T1); informational for T2/T3
  weight: number;        // within-tier weight; debugging > others (see §6)
}

interface BaselineRepResult {
  repId: string;
  confidence: number;     // c ∈ [0,1], captured BEFORE the attempt
  rawScore: number;       // correctness ∈ [0,1] from the verifier
  elapsedSeconds: number;
  assisted: boolean;      // must be false to count toward skill
}
```

Note the ordering constraint: `confidence` is captured on a screen *before* the rep is revealed in full, then locked. If the UI lets users edit confidence after seeing the answer, the gap metric is worthless.

---

## 5. Part A — Intake → prior

The intake yields a **prior mean skill per tier** and a **prior strength** (`priorStrength = 2`, TUNABLE). It deliberately washes out within a handful of reps.

### 5.1 Tier prior decay
Each tier's prior decay is a weighted, normalised sum of the relevant answers (each ∈ {0,1,2}). Weights sum to 1 within a tier; divide by 2 to land in [0,1]. Drivers follow the v2 tier table.

```
priorDecay_T1 = (0.60*timeline + 0.40*delegation) / 2          // Q1, Q2
priorDecay_T2 = (0.55*recency  + 0.45*reserve)    / 2          // Q3, Q4
priorDecay_T3 = (0.80*reserve  + 0.20*timeline)   / 2          // Q4 dominant
```

All weights are TUNABLE priors — they encode the *relative* sensitivities from the v2 doc, not measured constants.

### 5.2 Tier prior skill
```
priorSkill_tier = clamp(1 - priorDecay_tier, PRIOR_FLOOR, PRIOR_CEIL)  // [0.15, 0.95]
```
The clamp keeps the prior from ever being extreme — it's weak evidence, so it should never assert near-certainty.

### 5.3 Per-cluster seeding
At intake there is no cluster-level signal, so **every cluster in a tier starts at that tier's `priorSkill`**, with `observations = priorStrength`.

### 5.4 Intake overconfidence hint (soft, secondary)
Q5 does **not** feed skill. It sets a self-reported confidence and produces a soft pre-baseline hint only:
```
selfConfidence = confidence / 2                  // 0, 0.5, 1.0
intakeOverconfidenceHint =
  selfConfidence - mean(priorSkill_T1, priorSkill_T2, priorSkill_T3) > 0.30   // TUNABLE
```
This is surfaced gently ("worth checking your calibration") and is **superseded** by the measured flag after baseline. The operative `overconfidenceFlag` never comes from intake.

---

## 6. Part B — Baseline battery

### 6.1 Composition (15 reps)
Debugging is weighted and over-sampled because it showed the largest AI-induced gap in the Shen & Tamkin RCT.

| Tier | Cluster | Reps | Per-rep weight |
|---|---|---|---|
| T1 | syntax_idioms | 2 | 1.0 |
| T1 | complexity_estimation | 2 | 1.0 |
| T1 | mental_sizing | 1 | 1.0 |
| T2 | debugging | 3 | 1.5 |
| T2 | code_reading | 2 | 1.0 |
| T2 | structure_choice | 1 | 1.0 |
| T3 | system_design | 2 | 1.0 |
| T3 | scaling_reasoning | 1 | 1.0 |
| T3 | derivation | 1 | 1.0 |

The battery selector pulls one rep per slot from the template library, filtered to the user's declared sub-role where available, otherwise role-agnostic. Battery content is out of scope (§2).

### 6.2 Per-rep score `x`
The verifier returns `rawScore ∈ [0,1]`. For **T1 only**, blend in speed (T1 is speed-based; a correct-but-slow answer is a partially-decayed answer):
```
speedFactor = clamp(targetSeconds / max(elapsedSeconds, 1), 0, 1)
x = (tier === 'T1') ? rawScore * speedFactor : rawScore
```
If `rawScore === 0`, `x = 0` regardless of speed. Speed is **not** applied to T2/T3 (accuracy-based). `SPEED_FLOOR`/the blend itself are TUNABLE.

### 6.3 Integrity
Baseline must be unassisted. If any `result.assisted === true`:
- Exclude that rep from the **skill** update entirely (Shen & Tamkin: assisted success ≠ unassisted skill).
- It **may** still contribute to the confidence gap (calibration), so keep it in the gap series.
- Set `DiagnosticResult.integrityOk = false`.

---

## 7. Computation pipeline

Within a baseline session, all reps occur at effectively the same instant, so the power-law decay term `R(t)` ≈ 1 and is **not** applied between baseline reps. Decay only starts mattering once the Model takes over after handoff.

### 7.1 The shared filter
Reuse the Model's skill-update step. Per observation:
```
alphaRaw = ALPHA0 / (1 + n / N_SCALE)              // ALPHA0 = 0.4, N_SCALE = 5
alphaEff = clamp(alphaRaw * weight, 0, ALPHA_MAX)  // ALPHA_MAX = 0.9
S        = S + alphaEff * (x - S)
n        = n + weight
```
`alpha` falls as observations accumulate, so the weak prior moves a lot on the first rep and barely at all by the end of the session.

### 7.2 Per-tier estimate (operative)
For each tier: seed `S = priorSkill_tier`, `n = priorStrength`. Feed every unassisted rep in that tier, in presentation order, with its `weight`. Then:
```
latentSkill_tier = clamp(S, SKILL_FLOOR, SKILL_CEIL)   // [0.02, 0.98]
atrophyIndex_tier = (1 - latentSkill_tier) * 100
observations_tier = n
```

### 7.3 Per-cluster estimate (informational)
For each cluster: seed `S = priorSkill_tier`, `n = priorStrength`, feed only that cluster's unassisted reps (use `weight`). `reliable = (observations - priorStrength) >= RELIABLE_MIN_REPS` (default 6). Baseline rarely hits this — that's expected; clusters become reliable later under the Model. Per-cluster and per-tier views seed the prior independently; the prior appearing in both is fine, they are separate views and are never summed.

### 7.4 Calibration
Over all scored reps (unassisted, with confidence present):
```
gap_i      = c_i - x_i
confidenceGap (session) = mean(gap_i)        // > 0 = overconfident
brier                   = mean(gap_i^2)
confidenceGap (tier)    = mean(gap_i) within tier
overconfidenceFlag =
  scoredRepCount >= MIN_OBS_FOR_FLAG ? (confidenceGap > 0.15) : null   // MIN_OBS_FOR_FLAG = 6
```
Reps with no captured confidence are excluded from the gap but still update skill.

### 7.5 Headline
```
overallAtrophyIndex = mean(atrophyIndex_T1, atrophyIndex_T2, atrophyIndex_T3)
riskBand = overallAtrophyIndex >= 65 ? 'High'
         : overallAtrophyIndex >= 35 ? 'Moderate'
         : 'Low'
```

---

## 8. Tunables (single exported `DIAGNOSTIC_CONFIG`)

| Key | Default | Meaning |
|---|---|---|
| `priorStrength` | 2 | Pseudo-obs the intake prior is worth |
| `PRIOR_FLOOR` / `PRIOR_CEIL` | 0.15 / 0.95 | Clamp on intake prior skill |
| `tierWeights` | see §5.1 | Q→tier prior weightings |
| `ALPHA0` | 0.4 | Base learning rate |
| `N_SCALE` | 5 | Learning-rate decay scale |
| `ALPHA_MAX` | 0.9 | Cap on effective alpha after weighting |
| `debuggingWeight` | 1.5 | T2 debugging over-weight |
| `SKILL_FLOOR` / `SKILL_CEIL` | 0.02 / 0.98 | Never assert absolute 0/1 skill |
| `overconfidenceThreshold` | 0.15 | signedGap above which the flag fires |
| `MIN_OBS_FOR_FLAG` | 6 | Min scored reps before flag is non-null |
| `RELIABLE_MIN_REPS` | 6 | Min real reps for a cluster to be `reliable` |
| `intakeHintThreshold` | 0.30 | Soft pre-baseline overconfidence hint |

Every value is a calibrated prior. None is measured. Re-fit from in-app data per the v2 change-triggers.

---

## 9. Edge cases

- **Abandoned mid-session.** Compute over whatever reps completed. Tiers with 0 reps emit prior-only estimates. `overconfidenceFlag = null` if `scoredRepCount < MIN_OBS_FOR_FLAG`. Persist a partial result flagged incomplete; allow resume.
- **All reps wrong.** Filter drives skill toward 0 but the `[0.02, 0.98]` clamp prevents an absolute-zero claim.
- **Confidence missing on a rep.** Exclude from gap; include in skill update.
- **Assisted rep detected.** Skill-excluded, calibration-retained, `integrityOk = false` (§6.3).
- **`elapsedSeconds = 0`.** Guarded by `max(elapsedSeconds, 1)`.
- **Retake.** New `DiagnosticResult` with fresh `generatedAt`; never overwrite history — store versioned, the Model decides whether to re-seed or treat as a fresh evidence batch.
- **Out-of-range inputs.** Reject (don't clamp) malformed `IntakeAnswer`/`rawScore`/`confidence`; this is a programming error, not a user state.

---

## 10. Open decisions (flagging, not deciding silently)

1. **T3 verification is the real tension.** First-principles reps (system design, derivation) are open-loop, but the no-live-LLM rule means they can't be free-text-graded at baseline. This spec assumes T3 baseline reps are authored in *constrained-but-effortful* formats — rank the bottlenecks, identify the failure mode, choose the correct scaling argument, order the steps — so they're programmatically scorable while still demanding reasoning. The alternative is deferring T3 to an **offline LLM-judge batch**, which means the baseline result finalises minutes/hours later. I went with constrained formats so baseline is immediate; if you'd rather preserve genuinely open-ended T3 at the cost of an async finalise, that's a content-and-flow change, not a model change. Worth a decision before the battery gets authored.
2. **`priorStrength = 2` vs the 5-rep-per-tier battery.** Two pseudo-obs against ~5 real reps per tier means the prior is ~30% of the weight on the first rep and trivial by the last — intended. If you want the intake to feel more "listened to" in the UI for the first session, raise it to 3; just know it slows the wash-out.
3. **Per-tier rollup is a second independent filter, not an average of clusters.** I chose this so debugging's weight flows cleanly into T2 without double-counting the prior across clusters. It means tier numbers are the trustworthy ones at baseline and cluster numbers are explicitly low-confidence until the Model accumulates reps. If you'd prefer a single source of truth, we collapse to cluster-only and derive tiers by pooling — but that reintroduces the prior-double-count problem.

---

## 11. Acceptance criteria

- All functions pure and deterministic; same inputs → identical `DiagnosticResult`. No I/O, no `Date.now()` inside compute (caller passes `generatedAt`).
- Skill-update step is **imported from the Model module**, not reimplemented. A test asserts diagnostic and model produce identical `S` for the same `(S, n, x, weight)`.
- Types compile; `DiagnosticResult` and `SkillState` exported.
- Worked-example fixture below passes exactly.

### Worked example (T1 tier filter)
Intake `timeline=1, delegation=1` → `priorDecay_T1 = (0.6·1 + 0.4·1)/2 = 0.5` → `priorSkill_T1 = 0.5`, `n = 2`.
Three T1 reps, post-speed scores `x = [0.90, 0.40, 1.00]`, weight 1.0, `ALPHA0=0.4, N_SCALE=5`:

| step | alpha = 0.4/(1+n/5) | S update | S | n |
|---|---|---|---|---|
| start | — | — | 0.5000 | 2 |
| rep1 x=0.90 | 0.2857 | +0.2857·(0.90−0.50) | 0.6143 | 3 |
| rep2 x=0.40 | 0.2500 | +0.2500·(0.40−0.6143) | 0.5607 | 4 |
| rep3 x=1.00 | 0.2222 | +0.2222·(1.00−0.5607) | 0.6583 | 5 |

Expected: `latentSkill_T1 ≈ 0.6583`, `observations_T1 = 5`, `atrophyIndex_T1 ≈ 34.17` (assert to 4 dp).
Calibration with `c = [0.90, 0.80, 0.85]`: `signedGap = mean(0.00, 0.40, −0.15) = 0.0833`, `brier = mean(0, 0.16, 0.0225) = 0.0608` (assert to 4 dp).

---

*Unprompted — Diagnostic v2 implementation spec, June 2026. Build target: `diagnostic.ts` + `diagnostic.test.ts`, consuming the filter from `atrophy-model.ts`.*
