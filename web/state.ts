/**
 * Pure session state machine (v2.1). No DOM, no storage, no clock.
 *
 * Flow: Welcome → Intake → ClassPriors (walked-in beliefs, before any items) →
 * interleaved Rep loop (feedback withheld) → Computing → Results.
 * Per-item confidence is removed; calibration comes from the tier-level priors.
 */

import {
  gradeSubmission,
  TIERS,
  type IntakeAnswer,
  type IntakeResponses,
  type ConfidenceLabel,
  type ClassPrior,
  type Submission,
  type BaselineRep,
  type BaselineRepResult,
  type DiagnosticResult,
  type Tier,
} from "../diagnostic.ts";

export type Screen =
  | { kind: "welcome" }
  | { kind: "intake" }
  | { kind: "classpriors" } // walked-in beliefs, captured before any items
  | { kind: "rep"; i: number } // rep i revealed, timer running
  | { kind: "computing" }
  | { kind: "results" };

export interface RepCapture {
  repId: string;
  repStartedAt: string | null; // ISO when Rep(i) mounted (for elapsed timing)
  submission: Submission | null;
  elapsedSeconds: number | null;
  assisted: boolean;
}

export interface SessionState {
  runId: string;
  startedAt: string;
  screen: Screen;
  intake: Partial<IntakeResponses> | null;
  classPriors: Partial<Record<Tier, ConfidenceLabel>>; // walked-in beliefs (one per tier)
  batteryId: string;
  captures: RepCapture[];
  result: DiagnosticResult | null;
}

export type UiEvent =
  | { type: "startIntake" }
  | { type: "answerIntake"; field: keyof IntakeResponses; value: IntakeAnswer }
  | { type: "submitIntake" }
  | { type: "setClassPrior"; tier: Tier; label: ConfidenceLabel }
  | { type: "submitClassPriors" }
  | { type: "setSubmission"; i: number; submission: Submission }
  | { type: "submitRep"; i: number; elapsedSeconds: number }
  | { type: "setResult"; result: DiagnosticResult }
  | { type: "resume"; persisted: SessionState }
  | { type: "retake"; runId: string; startedAt: string };

const INTAKE_FIELDS: (keyof IntakeResponses)[] = [
  "timeline",
  "delegation",
  "recency",
  "reserve",
  "confidence",
];

// ── construction ────────────────────────────────────────────────────────────

function freshCapture(repId: string): RepCapture {
  return { repId, repStartedAt: null, submission: null, elapsedSeconds: null, assisted: false };
}

export function initialState(
  runId: string,
  startedAt: string,
  battery: BaselineRep[],
  batteryId: string,
): SessionState {
  return {
    runId,
    startedAt,
    screen: { kind: "welcome" },
    intake: null,
    classPriors: {},
    batteryId,
    captures: battery.map((rep) => freshCapture(rep.id)),
    result: null,
  };
}

// ── reducer ─────────────────────────────────────────────────────────────────

function patchCapture(state: SessionState, i: number, patch: Partial<RepCapture>): SessionState {
  return {
    ...state,
    captures: state.captures.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
  };
}

export function reduce(state: SessionState, event: UiEvent, now: string): SessionState {
  switch (event.type) {
    case "startIntake": {
      if (state.screen.kind !== "welcome") return state;
      return { ...state, screen: { kind: "intake" }, intake: state.intake ?? {} };
    }

    case "answerIntake": {
      if (state.screen.kind !== "intake") return state;
      return { ...state, intake: { ...(state.intake ?? {}), [event.field]: event.value } };
    }

    case "submitIntake": {
      if (state.screen.kind !== "intake" || !intakeComplete(state.intake)) return state;
      return { ...state, screen: { kind: "classpriors" } };
    }

    case "setClassPrior": {
      if (state.screen.kind !== "classpriors") return state;
      return { ...state, classPriors: { ...state.classPriors, [event.tier]: event.label } };
    }

    case "submitClassPriors": {
      if (state.screen.kind !== "classpriors" || !classPriorsComplete(state)) return state;
      // Stamp rep 0's start time as we enter the rep loop.
      const stamped = patchCapture(state, 0, { repStartedAt: now });
      return { ...stamped, screen: { kind: "rep", i: 0 } };
    }

    case "setSubmission": {
      if (state.screen.kind !== "rep" || state.screen.i !== event.i) return state;
      return patchCapture(state, event.i, { submission: event.submission });
    }

    case "submitRep": {
      if (state.screen.kind !== "rep" || state.screen.i !== event.i) return state;
      const cap = state.captures[event.i];
      if (!cap || cap.submission === null) return state;
      const advanced = patchCapture(state, event.i, { elapsedSeconds: event.elapsedSeconds });
      const last = state.captures.length - 1;
      if (event.i < last) {
        // Stamp the next rep's start time as we advance to it.
        const next = patchCapture(advanced, event.i + 1, { repStartedAt: now });
        return { ...next, screen: { kind: "rep", i: event.i + 1 } };
      }
      return { ...advanced, screen: { kind: "computing" } };
    }

    case "setResult": {
      if (state.screen.kind !== "computing") return state;
      return { ...state, screen: { kind: "results" }, result: event.result };
    }

    case "resume": {
      return event.persisted;
    }

    case "retake": {
      return {
        runId: event.runId,
        startedAt: event.startedAt,
        screen: { kind: "intake" },
        intake: {},
        classPriors: {} as Partial<Record<Tier, ConfidenceLabel>>,
        batteryId: state.batteryId,
        captures: state.captures.map((c) => freshCapture(c.repId)),
        result: null,
      };
    }
  }
}

/** Re-stamp the active rep's start time on resume (§12.4 — restart timer). Pure. */
export function restampActiveRep(state: SessionState, now: string): SessionState {
  if (state.screen.kind !== "rep") return state;
  return patchCapture(state, state.screen.i, { repStartedAt: now });
}

// ── selectors (pure) ─────────────────────────────────────────────────────────

export function intakeComplete(
  intake: Partial<IntakeResponses> | null,
): intake is IntakeResponses {
  if (!intake) return false;
  return INTAKE_FIELDS.every((f) => {
    const v = intake[f];
    return v === 0 || v === 1 || v === 2;
  });
}

export function classPriorsComplete(state: SessionState): boolean {
  return TIERS.every((t) => state.classPriors[t] != null);
}

export function toClassPriors(state: SessionState): ClassPrior[] {
  return TIERS
    .filter((t) => state.classPriors[t] != null)
    .map((t) => ({ tier: t, confidence: state.classPriors[t] as ConfidenceLabel }));
}

export function activeIndex(state: SessionState): number | null {
  return state.screen.kind === "rep" ? state.screen.i : null;
}

export function currentRep(state: SessionState, battery: BaselineRep[]): BaselineRep | null {
  const i = activeIndex(state);
  return i === null ? null : (battery[i] ?? null);
}

export function currentCapture(state: SessionState): RepCapture | null {
  const i = activeIndex(state);
  return i === null ? null : (state.captures[i] ?? null);
}

export function isComplete(state: SessionState): boolean {
  return (
    state.captures.length > 0 &&
    state.captures.every((c) => c.submission !== null && c.elapsedSeconds !== null)
  );
}

/**
 * Build the compute input. Confidence is always null (removed from per-item flow);
 * `ratedAfterFeedback` is always false (baseline withholds feedback). The ongoing
 * hook uses these fields when they differ.
 */
export function toRepResults(state: SessionState, battery: BaselineRep[]): BaselineRepResult[] {
  const byId = new Map(battery.map((r) => [r.id, r]));
  const out: BaselineRepResult[] = [];
  for (const cap of state.captures) {
    if (cap.submission === null || cap.elapsedSeconds === null) continue;
    const rep = byId.get(cap.repId);
    if (!rep) continue;
    out.push(
      gradeSubmission(rep, cap.submission, {
        confidence: null, // tier-level priors handle calibration; no per-item confidence
        elapsedSeconds: cap.elapsedSeconds,
        assisted: cap.assisted,
        ratedAfterFeedback: false,
      }),
    );
  }
  return out;
}
