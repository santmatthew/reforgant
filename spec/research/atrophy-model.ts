/**
 * Unprompted — Atrophy & Recovery System v2 (reference implementation)
 * Developer vertical. Dependency-free, pure functions, drop-in for tRPC/Drizzle.
 *
 * Design rule: the cognitive-science literature gives us FUNCTIONAL FORMS and
 * RELATIVE RATIOS, not absolute constants. Everything marked `TUNABLE` is a
 * calibrated prior that the user's own unassisted-rep history overrides.
 *
 * See unprompted-atrophy-model-v2.md and the research report for citations.
 */

// ============================================================================
// Types
// ============================================================================

export type Tier = "T1" | "T2" | "T3";
export type ClusterId = string; // e.g. "T1.syntax", "T2.debug", "T3.systemdesign"

export interface RepResult {
  cluster: ClusterId;
  tier: Tier;
  /** 0..1 graded correctness (binary reps use 0 or 1). */
  score: number;
  /** 0..1 confidence the user gave BEFORE answering. */
  confidence: number;
  /** Whether AI/assistance was available. Assisted reps NEVER update skill. */
  assisted: boolean;
  /** Unix ms. */
  at: number;
}

export interface ClusterState {
  cluster: ClusterId;
  tier: Tier;
  /** Latent unassisted skill, 0..1. atrophyIndex = (1 - skill) * 100. */
  skill: number;
  /** Count of unassisted reps observed (drives the learning-rate decay). */
  nObserved: number;
  /** Unix ms of last unassisted rep, for decay forecasting. */
  lastRepAt: number | null;
  /** Rolling window of (confidence - score) for calibration. */
  gapWindow: number[];
  brierWindow: number[];
}

export interface IntakeAnswers {
  /** 0 = <6mo, 1 = 1-2yr, 2 = 3yr+ */
  aiTimeline: 0 | 1 | 2;
  /** 0 = rarely, 1 = sometimes, 2 = almost always */
  delegation: 0 | 1 | 2;
  /** 0 = this week, 1 = this month, 2 = can't remember */
  recencyUnaided: 0 | 1 | 2;
  /** Pre-AI years of experience. 0 = 0-2yr, 1 = 3-7yr, 2 = 8+yr (the "reserve"). */
  reserve: 0 | 1 | 2;
  /** Self-rated unassisted ability. 0 = worried, 1 = rusty, 2 = still sharp. */
  confidence: 0 | 1 | 2;
}

// ============================================================================
// Constants  (TUNABLE = calibrated prior, re-fit from in-app data)
// ============================================================================

/** Power-law decay shape exponent, shared across tiers (Wixted 0.1–0.5 band). */
const DECAY_B = 0.5;

/**
 * Per-tier decay TIMESCALE in days. Ratios 1.0 : 0.7 : 0.4 come from Arthur et al.
 * moderator deltas (cognitive/accuracy/open-loop). The ABSOLUTE scale is TUNABLE.
 * Smaller timescale = faster decay.
 */
const TAU_DAYS: Record<Tier, number> = { T1: 14, T2: 20, T3: 35 }; // TUNABLE (ratios fixed)

/** Skill-update learning rate: alpha(n) = ALPHA0 / (1 + n / N_SCALE). TUNABLE. */
const ALPHA0 = 0.4;
const N_SCALE = 5;

/** Recovery: fraction of remaining gap closed per successful effortful rep. TUNABLE. */
const PER_REP_BASE: Record<Tier, number> = { T1: 0.03, T2: 0.022, T3: 0.014 };

/** Recoverable skill ceiling (can be scaled up by reserve depth). TUNABLE. */
const DEFAULT_CEILING = 0.95;

/** Within-session diminishing returns: 2nd/3rd rep give less. */
const WITHIN_SESSION_DECAY = 0.6;

/** Calibration window length per cluster. */
const CALIB_WINDOW = 20;

/** Overconfidence flag threshold on signed gap (confidence - accuracy). */
const OVERCONFIDENCE_THRESHOLD = 0.15;

const DAY_MS = 86_400_000;

// ============================================================================
// 1 · DECAY  (between-rep dynamics)
// ============================================================================

/** Power-law retention fraction after `days` of disuse for a tier. R(0)=1. */
export function retention(days: number, tier: Tier, experienceMultiplier = 1): number {
  const tau = TAU_DAYS[tier] / experienceMultiplier; // larger tau (more exp.) => slower decay
  return Math.pow(1 + Math.max(0, days) / tau, -DECAY_B);
}

/**
 * Experience multiplier on decay rate. 7+ yrs pre-AI experience decays slower.
 * TUNABLE — the literature supports the DIRECTION (Arthur aptitude moderator,
 * CACM Copilot data), not this exact coefficient.
 */
export function experienceMultiplier(reserve: IntakeAnswers["reserve"]): number {
  return reserve === 2 ? 1.4 : reserve === 1 ? 1.1 : 1.0; // higher => slower decay
}

/** Forecast current skill from last known skill + elapsed disuse. */
export function forecastSkill(state: ClusterState, now: number, expMult = 1): number {
  if (state.lastRepAt == null) return state.skill;
  const days = (now - state.lastRepAt) / DAY_MS;
  return state.skill * retention(days, state.tier, expMult);
}

// ============================================================================
// 2 · DIAGNOSTIC
// ============================================================================

/**
 * Intake -> per-tier PRIOR skill in [0,1], deliberately weak.
 * Returns prior mean only; prior strength is encoded by seeding nObserved low
 * (see seedStateFromIntake) so the baseline session quickly dominates.
 */
export function intakePriorSkill(a: IntakeAnswers): Record<Tier, number> {
  // Each raw signal 0..2; higher raw = more atrophy. reserve is inverted (more = less atrophy).
  const atrophy = (w: Partial<Record<keyof IntakeAnswers, number>>) => {
    let num = 0, den = 0;
    for (const k in w) {
      const weight = w[k as keyof IntakeAnswers]!;
      const raw = k === "reserve" ? 2 - a.reserve : (a as any)[k];
      num += raw * weight; den += 2 * weight;
    }
    return den === 0 ? 0 : num / den; // 0..1 atrophy
  };
  // Tier-specific driver weights (from v1 structure, kept as priors only):
  const t1 = atrophy({ aiTimeline: 30, delegation: 25, recencyUnaided: 10 });
  const t2 = atrophy({ recencyUnaided: 25, reserve: 20, delegation: 15 });
  const t3 = atrophy({ reserve: 30, aiTimeline: 10, delegation: 5 });
  // skill = 1 - atrophy, clamped (T2/T3 more durable => higher floors)
  return {
    T1: clamp(1 - t1, 0.05, 0.95),
    T2: clamp(1 - t2, 0.10, 0.97),
    T3: clamp(1 - t3, 0.20, 0.98),
  };
}

/** Initialise cluster states from the intake prior (weak: nObserved seeded at 0). */
export function seedStateFromIntake(
  clusters: { cluster: ClusterId; tier: Tier }[],
  intake: IntakeAnswers,
): ClusterState[] {
  const prior = intakePriorSkill(intake);
  return clusters.map(({ cluster, tier }) => ({
    cluster, tier,
    skill: prior[tier],
    nObserved: 0,           // prior carries ~0 evidence weight; baseline reps dominate
    lastRepAt: null,
    gapWindow: [], brierWindow: [],
  }));
}

/** Overconfidence: intake says "still sharp" but behaviour signals decay. */
export function intakeOverconfidence(a: IntakeAnswers): boolean {
  return a.confidence === 2 && (a.delegation >= 1 || a.recencyUnaided >= 1);
}

// ============================================================================
// 3 · MODEL  (skill update + calibration)
// ============================================================================

function learningRate(n: number): number {
  return ALPHA0 / (1 + n / N_SCALE);
}

/**
 * Apply one rep to a cluster state. Returns a NEW state (pure).
 * - Unassisted reps update skill (decay-forecast first, then move toward score).
 * - Assisted reps update calibration only (assisted success != unassisted skill).
 */
export function applyRep(state: ClusterState, rep: RepResult, expMult = 1): ClusterState {
  const next: ClusterState = {
    ...state,
    gapWindow: [...state.gapWindow],
    brierWindow: [...state.brierWindow],
  };

  // Calibration tracked for ALL reps.
  pushWindow(next.gapWindow, rep.confidence - rep.score, CALIB_WINDOW);
  pushWindow(next.brierWindow, (rep.confidence - rep.score) ** 2, CALIB_WINDOW);

  if (rep.assisted) return next; // guardrail: no skill update from assisted reps

  const predicted = forecastSkill(state, rep.at, expMult);
  const alpha = learningRate(state.nObserved);
  next.skill = clamp(predicted + alpha * (rep.score - predicted), 0, 1);
  next.nObserved = state.nObserved + 1;
  next.lastRepAt = rep.at;
  return next;
}

export function atrophyIndex(skill: number): number {
  return (1 - skill) * 100;
}

export function riskBand(index: number): "High" | "Moderate" | "Low" {
  return index >= 65 ? "High" : index >= 35 ? "Moderate" : "Low";
}

export interface Calibration {
  signedGap: number;   // >0 overconfident, <0 underconfident
  brier: number;       // lower is better
  overconfident: boolean;
  n: number;
}

export function calibration(state: ClusterState): Calibration {
  const n = state.gapWindow.length;
  const signedGap = mean(state.gapWindow);
  return {
    signedGap,
    brier: mean(state.brierWindow),
    overconfident: n >= 5 && signedGap > OVERCONFIDENCE_THRESHOLD,
    n,
  };
}

// ============================================================================
// 4 · RECOVERY  (rep-driven projection + scheduling)
// ============================================================================

export interface PracticePlan {
  repsPerSession: number;
  sessionsPerWeek: number; // 1..7
  weeks: number;
  /** 1.0–1.5; deeper pre-AI experience reacquires faster (savings). TUNABLE. */
  savings: number;
  ceiling?: number;
}

export interface RecoveryPoint { week: number; skill: number; atrophyIndex: number; }
export interface RecoveryProjection {
  tier: Tier;
  startAtrophy: number;
  points: RecoveryPoint[];
  weekTo50: number | null; // week atrophy <= 50% of starting
  weekTo75: number | null; // week atrophy <= 25% of starting
  plateauAtrophy: number;
}

/**
 * Project recovery for a single cluster under a practice plan.
 * Each successful rep moves skill toward ceiling by a shrinking fraction of the
 * remaining gap; decay applies on the gaps between sessions. Frequency therefore
 * dominates volume — the core behavioural nudge.
 */
export function projectRecovery(
  startSkill: number,
  tier: Tier,
  plan: PracticePlan,
  expMult = 1,
): RecoveryProjection {
  const ceiling = plan.ceiling ?? DEFAULT_CEILING;
  const startAtrophy = atrophyIndex(startSkill);
  const sessionDays = sessionDayset(plan.sessionsPerWeek, plan.weeks);

  let skill = startSkill;
  let lastDay = 0;
  const points: RecoveryPoint[] = [];
  let weekTo50: number | null = null;
  let weekTo75: number | null = null;

  for (let day = 1; day <= plan.weeks * 7; day++) {
    if (sessionDays.has(day)) {
      skill *= retention(day - lastDay, tier, expMult); // decay since last session
      lastDay = day;
      for (let i = 0; i < plan.repsPerSession; i++) {
        if (skill < ceiling) {
          const gain =
            PER_REP_BASE[tier] *
            (ceiling - skill) *
            plan.savings *
            Math.pow(WITHIN_SESSION_DECAY, i);
          skill = Math.min(ceiling, skill + gain);
        }
      }
    }
    if (day % 7 === 0) {
      const a = atrophyIndex(skill);
      const week = day / 7;
      points.push({ week, skill, atrophyIndex: a });
      if (weekTo50 == null && a <= startAtrophy * 0.5) weekTo50 = week;
      if (weekTo75 == null && a <= startAtrophy * 0.25) weekTo75 = week;
    }
  }
  return {
    tier, startAtrophy, points, weekTo50, weekTo75,
    plateauAtrophy: points.length ? points[points.length - 1].atrophyIndex : startAtrophy,
  };
}

/**
 * Cepeda temporal-ridgeline optimal review gap (days) for a target retention
 * horizon (days). Ratio ~0.30 at 7d down to ~0.07 at 365d, log-interpolated.
 */
export function optimalReviewGapDays(horizonDays: number): number {
  const [lo, hi, rLo, rHi] = [7, 365, 0.3, 0.07]; // TUNABLE endpoints
  const x = clamp(horizonDays, lo, hi);
  const f = (Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return (rLo + (rHi - rLo) * f) * horizonDays;
}

/**
 * Next-interval scheduler with expanding intervals and failure backoff.
 * On success grow toward the horizon-optimal gap; on failure step back to the
 * previous interval (lag effect), never to zero.
 */
export function nextIntervalDays(
  currentIntervalDays: number,
  lastWasSuccess: boolean,
  horizonDays: number,
): number {
  const target = optimalReviewGapDays(horizonDays);
  if (!lastWasSuccess) return Math.max(1, currentIntervalDays / 2);
  return Math.min(target, Math.max(1, currentIntervalDays) * 1.8);
}

// ============================================================================
// helpers
// ============================================================================

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function pushWindow(w: number[], v: number, max: number): void {
  w.push(v);
  if (w.length > max) w.shift();
}
function sessionDayset(sessionsPerWeek: number, weeks: number): Set<number> {
  const days = new Set<number>();
  const step = 7 / sessionsPerWeek;
  for (let w = 0; w < weeks; w++)
    for (let k = 0; k < sessionsPerWeek; k++)
      days.add(Math.round(w * 7 + k * step));
  return days;
}

// ============================================================================
// self-check (run with: npx tsx atrophy-model.ts)
// ============================================================================

declare const require: any;
declare const module: any;
if (typeof require !== "undefined" && require.main === module) {
  const intake: IntakeAnswers = {
    aiTimeline: 2, delegation: 2, recencyUnaided: 2, reserve: 1, confidence: 2,
  };
  const prior = intakePriorSkill(intake);
  console.log("intake prior skill:", prior, "overconfident:", intakeOverconfidence(intake));

  const proj = projectRecovery(0.3, "T1",
    { repsPerSession: 3, sessionsPerWeek: 7, weeks: 12, savings: 1.2 });
  console.log("\nT1 daily recovery (start atrophy",
    proj.startAtrophy.toFixed(0) + "): -50% by wk", proj.weekTo50,
    " plateau ~", proj.plateauAtrophy.toFixed(0));

  const slow = projectRecovery(0.3, "T1",
    { repsPerSession: 2, sessionsPerWeek: 3, weeks: 12, savings: 1.2 });
  console.log("T1 3x/wk: -50% by wk", slow.weekTo50, " plateau ~",
    slow.plateauAtrophy.toFixed(0), "(frequency dominates volume)");

  console.log("\nCepeda gaps:", [7, 30, 90, 365]
    .map(h => `${h}d->${optimalReviewGapDays(h).toFixed(1)}d`).join("  "));
}
