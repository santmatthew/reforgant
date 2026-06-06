# Unprompted — Diagnostic Web UI Implementation Spec

*Subsystem 1b of the Atrophy & Recovery System v2 · Developer vertical · build target for Claude Code*

This is an **implementation spec**, not a design doc. It is written to be handed to Claude Code and turned into a working web app with a passing check suite. It assumes the diagnostic compute core — `diagnostic.ts` (built per `spec.md`) — already exists and is **consumed unchanged**. The UI is a thin, presentation-and-flow layer over that pure library: every score and every headline number comes from `diagnostic.ts`, computed **in the browser**.

The companion compute spec is [`spec.md`](./spec.md). Section references like "compute §4" point there; bare "§n" point here.

---

## Changelog — v2.1 (confidence methodology)

The confidence UX described below (§5 continuous **slider**; the §9 per-item Brier/`confidenceGap` calibration card) is **superseded in code** to match the compute v2.1 methodology (`spec.md` → Changelog). Treat this note as authoritative where it conflicts with the body.

- **Ordinal confidence (§5).** The slider is replaced by a 5-point ordinal selector (`ordinalScale`: guess / leaning / fairly sure / confident / certain). The rep screen shows the locked label ("You committed: Fairly sure"). The confidence-first lock and no-leak guarantees are unchanged.
- **Class-priors screen (new).** After Intake, one screen captures a single walked-in confidence rating per cluster (`setClassPrior`) **before any items** — the uncontaminated belief. This drives the headline `globalGap` on Results; the calibration card shows belief-vs-reality per cluster (`classCalibration`), not Brier.
- **Interleaving + withheld feedback.** Items are presented interleaved across clusters (`interleaveByCluster`), and per-item correct/incorrect feedback is withheld until Results (the "Review your answers" panel). Both prevent within-session learning from contaminating the confidence signal.
- **Flow** is now: Welcome → Intake → **ClassPriors** → interleaved (Confidence→Rep) loop → Computing → Results.
- **Fixture (§13):** the per-item Brier/gap assertions are replaced by `globalGap`; the skill-side numbers are unchanged.

---

## 1. Purpose

Turn the diagnostic library into something a developer can actually *sit and take* in ~12 minutes, in a browser, with no account and no server round-trips for scoring.

Three parts, one session:

- **Intake** — five questions → `IntakeResponses` (the weak prior).
- **Baseline** — a battery of ~15 reps, each gated by a **confidence-first** screen, each **timed** → one `BaselineRepResult` per rep.
- **Results** — render the `DiagnosticResult`: overall atrophy index, risk band, per-tier and per-cluster breakdown, the calibration/overconfidence read-out.

The governing constraint inherited from compute §4 is the spine of the whole UI: **confidence is captured and locked *before* the rep is revealed.** If a user can revise confidence after seeing the question or the answer, the confidence–accuracy gap is worthless. The screen flow exists to make that structurally impossible.

---

## 2. Scope and non-goals

In scope:
- The single-page flow and its **pure state machine** (Welcome → Intake → Baseline loop → Computing → Results).
- The **demo battery contract** and ~15 illustrative reps (across all 9 clusters and the programmatically-scorable formats).
- **Confidence-first** capture + per-rep **timing**, wired into `gradeSubmission`.
- **Persistence + resume** of an in-progress or completed session (localStorage), including retake history.
- **Results presentation** mapping every `DiagnosticResult` field to UI.
- A Bun-fullstack host that serves the bundled SPA.

Out of scope (do **not** build here):
- The real baseline rep *content* — template-library IP (compute §2). This spec ships illustrative demo reps only.
- Accounts, auth, multi-user, any database or network persistence. **No backend logic beyond static serving. No server-side compute. No LLM. No secrets.**
- The Model and Recovery subsystems (decay, scheduling, the recovery projection screens). The UI ends at handoff: it may *display* `toSkillStates(result)` for transparency, but does not drive a model.
- `unit_test`-format reps — they need a code-execution harness the client doesn't have (compute §6.2, §10.1). The demo battery uses the four pure formats only.
- Any change to `diagnostic.ts`. It is a dependency, not a target.

---

## 3. Architecture

**Stack: Bun fullstack.** No Vite, no React, no framework runtime. `Bun.serve` hosts a `Bun.build`-bundled client. The client is vanilla TypeScript + the DOM, importing `diagnostic.ts` directly; all scoring and computation run in the browser via the library's pure functions.

Proposed layout (the implementer may refine names, not responsibilities):

```
server.ts              # Bun.serve: builds the client on start (Bun.build) and serves it + index.html
diagnostic.ts          # EXISTING compute core — imported, never modified
web/
  index.html           # single mount point + <script type="module">
  main.ts              # bootstraps: load/resume session, render loop, event wiring
  battery.ts           # the ~15 demo reps (BaselineRep[]) + their answer keys (payloads)
  state.ts             # SessionState + the PURE transition function (no DOM, no storage)
  storage.ts           # localStorage read/write/version (the only impure persistence module)
  timer.ts             # elapsed-seconds measurement
  screens/
    welcome.ts  intake.ts  confidence.ts  rep.ts  computing.ts  results.ts
  styles.css
web/state.test.ts      # bun test — transitions + the scripted-run fixture (§13)
```

**Hard rule:** all decision logic (what screen is next, what counts, how a submission maps to a score) lives in `state.ts` / `diagnostic.ts` as pure functions. `screens/*` only render `SessionState` and emit events. This is what makes the flow testable without a DOM (§13).

`package.json` scripts to add: `"dev"`/`"start"` → `bun run server.ts`; keep the existing `test` (`bun test`) and `typecheck` (`tsc --noEmit`).

---

## 4. Screen flow & state machine

```
Welcome ─▶ Intake ─▶ ┌─────────── Baseline loop (per rep i) ───────────┐ ─▶ Computing ─▶ Results
                     │  Confidence(i)  ─lock▶  Rep(i)  ─submit▶  next   │
                     └────────────────────────────────────────────────┘
   ▲ Resume: re-entry from localStorage lands on the exact (screen, i) last persisted.
```

`SessionState` is a discriminated union over a `screen` tag. The transition function is pure:

```ts
type Screen =
  | { kind: 'welcome' }
  | { kind: 'intake' }
  | { kind: 'confidence'; i: number }   // rep i, confidence not yet locked
  | { kind: 'rep'; i: number }          // rep i revealed, timer running, confidence locked
  | { kind: 'computing' }
  | { kind: 'results' };

interface SessionState {
  runId: string;                  // stable id for this attempt (caller-supplied; see §8)
  startedAt: string;              // ISO; caller-supplied (no Date.now in pure code)
  screen: Screen;
  intake: Partial<IntakeResponses> | null;
  batteryId: string;              // which battery version this run used
  captures: RepCapture[];         // one per rep, filled progressively (length = battery length)
  result: DiagnosticResult | null;
}

interface RepCapture {
  repId: string;
  // [0,1], locked at the confidence→rep transition. In this forward-only flow it
  // is ALWAYS set before the rep is shown; `| null` exists only to match
  // `BaselineRepResult.confidence` (compute §9 "missing confidence") in case a
  // skip affordance is ever added. There is no skip path in the spec'd flow.
  confidence: number | null;
  confidenceLocked: boolean;      // true once we leave the confidence screen for this rep
  repStartedAt: string | null;    // ISO when Rep(i) mounted; for resume elapsed handling (§12.4)
  submission: Submission | null;  // chosen on the rep screen
  elapsedSeconds: number | null;  // measured on the rep screen
  assisted: boolean;              // §6
}

// Pure. Returns the next state; never mutates. Side effects (persist, compute) are the caller's.
function reduce(state: SessionState, event: UiEvent, now: string): SessionState;
```

Events: `startIntake`, `answerIntake(field,value)`, `submitIntake`, `setConfidence(i,c)`, `lockConfidence(i)`, `setSubmission(i,sub)`, `submitRep(i,elapsedSeconds)`, `setResult(result)`, `resume(persisted)`, `retake`.

Transitions worth pinning:
- `submitRep(i)` for `i < last` → `confidence(i+1)`; for `i === last` → `computing`.
- **`computing → results` requires the `setResult(result)` event.** `reduce` is pure and cannot compute, so on entering `computing` the caller (`main.ts`) invokes `computeDiagnostic(intake, battery, toRepResults(state, battery), generatedAt)` and then dispatches `setResult(result)`, which is the *only* path into `results`. (`computing` also gives the UI a beat to render a transition.)
- The demo computes **only after all reps complete**. Partial/early-finish — computing over just the completed reps — is a library capability (compute §9 abandoned-mid-session) that this demo does not surface; resume continues the run instead.

---

## 5. The confidence-first contract (hard constraint — compute §4)

This is the non-negotiable part.

1. For rep `i`, the **Confidence(i)** screen shows *only* the rep's tier/cluster label and a confidence prompt — **never the question text, choices, or answer.** The `prompt`/`payload` of `battery[i]` must not be in the DOM on this screen. (Showing the cluster label — e.g. "debugging" — is deliberate: the user rates confidence *for that skill area*, which is the calibration construct. It is not a leak; the question itself stays hidden.)
2. Advancing from Confidence(i) to Rep(i) **locks** `captures[i].confidence` (`confidenceLocked = true`). The transition function rejects any later `setConfidence(i, …)`.
3. There is **no back-navigation** from Rep(i) to Confidence(i), and none from rep `i` to any rep `< i`. The flow is forward-only across reps. (Within the rep screen, the user may change their *answer* before submitting; that's fine — only confidence is frozen.)
4. The confidence widget produces a value in `[0,1]`. **Open decision (§12):** continuous 0–100% slider (÷100) vs a discrete 3-point scale (Not confident / Somewhat / Confident → 0 / 0.5 / 1). Pick one; the spec assumes a continuous slider unless overridden.

A test asserts that no `reduce` path produces a state where a rep's confidence changes after `confidenceLocked` is true (§13).

---

## 6. Timing & integrity

**Timing (compute §6.2).** `elapsedSeconds` is measured from the moment **Rep(i)** mounts (question revealed) to the moment the user submits. T1 reps are speed-scored, so this must be wall-clock accurate; pause/blur handling is the implementer's call but the timer must not undercount. `elapsedSeconds` is passed verbatim into `gradeSubmission`; the library guards `elapsedSeconds = 0` (compute §6.2).

**Visible timer — open decision (§12).** A countdown can change behavior under test conditions. Default: show a subtle elapsed indicator, no hard cutoff; `targetSeconds` is used for scoring, not enforcement.

**Integrity (compute §6.3).** The baseline is unassisted. The UI states this plainly before Baseline begins. `RepCapture.assisted` defaults `false`. **Open decision (§12):** whether a demo exposes an "I used AI" toggle at all. If present, setting it `true` flows into `gradeSubmission` and the library excludes that rep from skill (and, by default config, from calibration), and sets `integrityOk = false`. The Results screen surfaces `integrityOk = false` as a non-judgmental banner.

---

## 7. Demo-battery contract

The battery is `BaselineRep[]` authored in `web/battery.ts`, following the **compute §6.1 composition exactly** (15 reps; debugging over-sampled at weight 1.5):

| Tier | Cluster | Reps | Weight | Demo format(s) |
|---|---|---|---|---|
| T1 | syntax_idioms | 2 | 1.0 | mcq |
| T1 | complexity_estimation | 2 | 1.0 | numeric_tol, mcq |
| T1 | mental_sizing | 1 | 1.0 | numeric_tol |
| T2 | debugging | 3 | 1.5 | rubric_program, mcq |
| T2 | code_reading | 2 | 1.0 | exact, mcq |
| T2 | structure_choice | 1 | 1.0 | mcq |
| T3 | system_design | 2 | 1.0 | mcq (constrained / ordering) |
| T3 | scaling_reasoning | 1 | 1.0 | mcq |
| T3 | derivation | 1 | 1.0 | mcq (ordering) |

Every rep carries the compute-contract fields (`id`, `tier`, `cluster`, `prompt`, `format`, `payload`, `targetSeconds`, `weight`). `weight` for debugging reps = `DIAGNOSTIC_CONFIG.debuggingWeight`. Content is illustrative and clearly marked demo; **the real battery is out-of-scope IP.** No `unit_test` reps (§2).

**Widget → `Submission` mapping** (the bridge between the DOM and `scoreRep`). Each rep screen builds exactly one `Submission`:

| `format` | Input widget | `Submission` produced |
|---|---|---|
| `mcq` | radio group over `payload.choices` | `{ kind: 'mcq', choiceIndex }` |
| `exact` | single-line text input | `{ kind: 'exact', value }` |
| `numeric_tol` | number input | `{ kind: 'numeric_tol', value }` |
| `rubric_program` | checkbox group over `payload.options` (correct ids **+ distractors**) | `{ kind: 'rubric_program', satisfied: string[] }` (the ticked ids) |

Scoring is then `gradeSubmission(rep, submission, { confidence, elapsedSeconds, assisted }) → BaselineRepResult`. The UI **never** re-implements scoring; `scoreRep` is the only judge. (To render, the UI reads `payload.choices` (mcq) / `payload.options` (rubric); it must never read the answer key — `payload.correctIndex` / `payload.checks` — to render or to score. Reveal the key only as post-submit feedback, if at all.)

**`rubric_program` requires care (two coupled points):**
- **Scoring is rights-minus-wrongs** (corrected for guessing): `scoreRep` returns `clamp((truePositives − falsePositives) / |checks|, 0, 1)`, so ticking every box scores **0, not 1** — this is the fixed behaviour in `diagnostic.ts` and is what makes a checkbox UI safe for the over-sampled debugging cluster. False alarms genuinely cost score (appropriate for "select all defects").
- **The rep must carry its display options.** `RubricProgramPayload.checks` is only the *answer key*; rendering checkboxes from `checks` alone would show only-correct boxes. The battery rep therefore puts the full candidate list in an extra payload field — `payload.options: { id: string; label: string }[]` (some correct, some distractors) — which `scoreRep` ignores (`payload` is `unknown`/extensible). The UI renders `options`; the submission is the ticked `id`s.

The battery must include at least one rep per cluster (all 9) so the results grid is fully populated.

---

## 8. Persistence & resume

The **only** impure storage module is `web/storage.ts`, over `localStorage`. Compute and the reducer stay pure.

```ts
const STORAGE_KEY = 'unprompted.diagnostic.v2';
interface PersistedState {
  schemaVersion: 1;               // UI persistence schema, independent of compute schemaVersion
  current: SessionState | null;   // the in-progress (or just-finished) run
  history: DiagnosticResult[];    // completed runs, newest last — NEVER overwritten (compute §9 retake)
}
```

Rules:
- **Save points:** after `submitIntake`, after each `submitRep`, and after entering `results`. Saving `SessionState` verbatim means resume is exact.
- **Resume:** on load, if `current` exists and `current.screen` is not `results`, offer "Resume" → re-enter on the persisted `(screen, i)`; all prior `captures` are intact. Confidence already locked for past reps stays locked.
- **Retake (compute §9):** starting a new run pushes the finished `result` into `history` and never mutates earlier entries; a fresh `runId`/`startedAt` is generated. History is shown as a small "previous attempts" list on Welcome/Results.
- **`runId`, `startedAt`, `generatedAt`** are timestamps/ids **supplied by the impure boot layer** (`main.ts`), never minted inside pure code (compute keeps `Date.now()` out of compute; mirror that here).
- Corrupt/older `schemaVersion` → discard `current`, keep nothing rather than crash; surface a clean Welcome.

---

## 9. Results presentation

Every field of `DiagnosticResult` (compute §3) maps to UI:

| Field | Presentation |
|---|---|
| `overallAtrophyIndex` + `riskBand` | Headline gauge (0–100) with the band label; band drives color (Low/Moderate/High). |
| `tiers[]` | Three tier cards (T1 Quick Recall / T2 Scenario Analysis / T3 First Principles): `atrophyIndex`, `latentSkill`, `confidenceGap`, `observations`. |
| `clusters[]` | A 9-cell grid grouped by tier: per-cluster `latentSkill`; cells with `reliable = false` are visibly de-emphasized ("provisional — firms up with practice"). |
| `confidenceGap` + `brier` | Calibration read-out; sign of the gap → "overconfident" / "well-calibrated" / "underconfident". |
| `overconfidenceFlag` | If `true`, a calibration callout. If `null` (too few scored reps, compute §7.4), show "not enough data yet", **not** a false all-clear. |
| `intakeOverconfidenceHint` | Only meaningful pre-baseline; if it fired, a soft "worth checking your calibration" note, explicitly **superseded** by `overconfidenceFlag`. |
| `integrityOk = false` | Non-judgmental banner: results reflect assisted reps; skill numbers exclude them. |
| `scoredRepCount`, `priorStrength` | Small "based on N scored reps; prior worth M" footnote — sets expectations about confidence. |
| `generatedAt`, `schemaVersion` | Footer metadata. |

Optional transparency panel: `toSkillStates(result)` rendered as the JSON handed to the Model. Tone throughout: coaching, not clinical-cold — atrophy is recoverable; this is a baseline, not a verdict.

---

## 10. Component & state contract

- `state.ts` exports `initialState(runId, startedAt)`, `reduce(state, event, now)`, and pure selectors (`currentRep(state, battery)`, `isComplete(state)`, `toRepResults(state, battery)`).
- `toRepResults(state, battery): BaselineRepResult[]` builds the compute input by pairing each `RepCapture` with its `BaselineRep` (looked up in `battery` by `repId`) and calling `gradeSubmission(rep, submission, { confidence, elapsedSeconds, assisted })`. The **battery argument is required** — `gradeSubmission` needs the rep, which is not in `state`. This is the single place scoring is invoked: `reduce` stores only raw captures and never grades, so it stays battery-free and pure.
- `main.ts` is the only module that: reads/writes storage, mints ids/timestamps, calls `computeDiagnostic` (with `toRepResults(state, battery)` and a fresh `generatedAt`) on entering `computing`, dispatches `setResult`, and binds DOM events to `reduce`.
- `screens/*` are pure render functions `(state, battery, emit) → void` (or return a DOM node); they hold no state and make no decisions.

This separation is the testability contract: `state.ts` + `battery.ts` + `diagnostic.ts` are exercised headlessly in `web/state.test.ts`.

---

## 11. Design direction & accessibility

- **Aesthetic:** a calm, "clinical-but-warm" diagnostic dashboard — think a thoughtful health check-up, not a gamified quiz. Restrained palette; the risk band is the one place color carries meaning. (Implementer may use the `frontend-design` skill.)
- **Confidence affordance:** the locked state must *read* as locked — once past, the value is shown read-only on the rep screen ("you said: 70% confident") so the user feels the commitment.
- **Accessibility:** full keyboard navigation (radios, slider, checkboxes, Enter to advance); visible focus; labelled inputs; `prefers-reduced-motion` respected on the computing transition; sufficient contrast on the risk gauge.
- **Responsive:** single-column mobile through centered-card desktop; one rep per viewport — never show the next rep early.

---

## 12. Open decisions (flagging, not deciding silently)

1. **Confidence widget granularity.** Continuous 0–100% slider (richer gap signal, finer Brier) vs discrete 3-point (faster, less false precision). Spec assumes continuous → `[0,1]`; flip if you'd rather match the intake's 3-point feel.
2. **Visible timer.** Showing elapsed/`targetSeconds` may induce rushing and change T1 behavior. Default: subtle elapsed indicator, no enforcement. Alternative: hide entirely and only score on it.
3. **`assisted` toggle in a demo.** Exposing it lets you demonstrate the integrity path (`integrityOk = false`) but invites confusion in a 12-minute demo. Default: omit; keep the unassisted framing copy. Wire the field through regardless so enabling it later is trivial.
4. **Tab-close mid-rep.** The running timer is lost on a hard close. Options: persist a rep `startedAt` and reconstruct elapsed on resume (penalizes walking away), or restart the rep's timer on resume (forgiving). Default: restart on resume; note it.

---

## 13. Acceptance criteria

- **Pure flow.** `state.ts` is pure and DOM-free; `reduce` is deterministic; ids/timestamps are injected, never minted inside pure code. `bun run typecheck` passes; `bun test` passes.
- **Results only via `setResult`.** A test asserts `results` is reachable solely through the `setResult(result)` event (entering `computing` does not by itself populate `result`), so the pure reducer never computes.
- **Confidence lock (the headline guarantee).** A test asserts no `reduce` event sequence changes `captures[i].confidence` after `confidenceLocked[i]` is true, and that no Confidence(i) state ever carries the rep's `prompt`/answer.
- **Timing recorded.** Each completed `RepCapture` has a finite `elapsedSeconds`; it reaches `gradeSubmission` unmodified.
- **Battery coverage.** The demo battery instantiates all 9 clusters; the results grid renders 9 cells; no `unit_test` reps.
- **Resume.** Persisting mid-Baseline and re-loading restores the exact `(screen, i)` and all prior captures; retake preserves `history` (no overwrite).
- **Serves.** `bun run server.ts` builds and serves the SPA; the full flow reaches Results in a browser.
- **Worked scripted-run fixture (mirrors compute §11).** With the **existing 4 `ILLUSTRATIVE_REPS`** as a stand-in battery, intake `{ timeline:1, delegation:1, recency:1, reserve:1, confidence:1 }`, submissions `ILLUSTRATIVE_SUBMISSIONS`, per-rep confidence `[0.7, 0.6, 0.8, 0.5]`, and `elapsedSeconds` all ≤ `targetSeconds`, the UI's `toRepResults(state, battery)` → `computeDiagnostic(…, '2026-06-03T12:00:00.000Z')` must yield (assert to 4 dp):

  | Output | Expected |
  |---|---|
  | rawScores | `[1, 1, 0.6667, 0]` |
  | `overallAtrophyIndex` / `riskBand` | `44.6429` / `Moderate` |
  | `confidenceGap` / `brier` | `-0.0167` / `0.1294` |
  | `overconfidenceFlag` / `scoredRepCount` | `null` / `4` |
  | `intakeOverconfidenceHint` / `integrityOk` | `false` / `true` |
  | tier T1 | `latentSkill 0.7321`, `atrophy 26.7857`, `n 4`, `gap −0.35` |
  | tier T2 | `latentSkill 0.5714`, `atrophy 42.8571`, `n 3.5`, `gap 0.1333` |
  | tier T3 | `latentSkill 0.3571`, `atrophy 64.2857`, `n 3`, `gap 0.5` |

  This fixture is runnable **today** (the reps exist), so the data plumbing can be verified before the real demo battery is authored. When the ~15-rep battery lands, add a second fixture over it.

---

*Unprompted — Diagnostic Web UI implementation spec, June 2026. Build target: a Bun-fullstack SPA over the unchanged `diagnostic.ts`. Companion to `spec.md`.*
