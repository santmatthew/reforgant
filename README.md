# Reforgant — Diagnostic

The **Reforgant** skills diagnostic — Subsystem 1 of the Atrophy & Recovery System v2 (developer vertical). Implements
[`spec/spec.md`](./spec/spec.md).

Turns a new developer into a seeded model state in one ~12-minute sitting:

- **Part A — Intake** (5 questions) → a weak per-tier skill *prior* (washes out fast).
- **Part B — Baseline** (~15 unassisted reps + pre-attempt confidence) → measured
  per-cluster skill and a measured confidence/accuracy gap.

Output is a `DiagnosticResult` (atrophy index, risk band, overconfidence flag,
per-tier and per-cluster estimates) that seeds one `SkillState` per cluster for
the Model subsystem.

## Run

```sh
bun install
bun start           # serve the web UI → http://localhost:3000
bun dev             # same, with hot reload
bun test            # full suite (compute + UI), incl. the worked examples
bun run typecheck   # tsc --noEmit
```

Requires [bun](https://bun.sh). The compute core (`diagnostic.ts`) is pure,
deterministic, and dependency-free.

## Web UI

A take-the-diagnostic web app lives in `web/`, built per
[`spec/ui-spec.md`](./spec/ui-spec.md): **Bun fullstack** (`Bun.serve` + bun's
bundler), vanilla TypeScript, no framework, all scoring in the browser over the
unchanged `diagnostic.ts`.

`bun start` serves the full flow: Welcome → Intake (5 questions) → a 15-rep
baseline where **confidence is locked before each question is revealed** (the §4
guarantee) and reps are timed → a results dashboard (atrophy gauge, risk band,
per-tier and per-cluster breakdown, calibration read-out, model-handoff JSON).
Sessions persist to `localStorage` and resume after a reload.

Architecture (the testability contract):

- `web/state.ts` — the **pure** state machine (`reduce`, selectors,
  `toRepResults`). No DOM, no storage, no clock.
- `web/battery.ts` — the 15-rep demo battery (illustrative content; the real
  battery is out-of-scope IP).
- `web/main.ts` — the only impure module: boot/resume, render loop, the compute
  kick, persistence, timer.
- `web/screens/*` — pure render functions; they hold no state and make no
  decisions.
- `web/state.test.ts` / `web/render.test.ts` — headless flow tests + a happy-dom
  render-through of every screen.

## Surface

`diagnostic.ts` exports:

- `computeDiagnostic(intake, reps, results, generatedAt, cfg?) → DiagnosticResult` — the pipeline (§7).
- `intakePrior`, `skillUpdate`, `repScore`, `scoreRep`, `gradeSubmission`, `riskBandFor`, `toSkillStates`.
- `DIAGNOSTIC_CONFIG` — every tunable (§8). `CLUSTER_TIER`, `ALL_CLUSTERS`, `BATTERY_COMPOSITION`.
- All contract types (`DiagnosticResult`, `SkillState`, `BaselineRep`, …) and 4 `ILLUSTRATIVE_REPS`.

`computeDiagnostic` is pure: it takes `generatedAt` from the caller and never reads the clock.

## Notes on the build (decisions captured during implementation)

- **Filter reuse.** The §7.1 skill-update filter is *reimplemented* as `skillUpdate(S, n, x, weight)`
  rather than imported, because the Model's `applyRep` (in `spec/research/atrophy-model.ts`) has no
  `weight`/`ALPHA_MAX` and folds in decay. A parity test asserts the two produce bit-identical `S` on
  the shared `weight = 1`, no-decay slice; the weighted path is pinned by the §11 fixture. The
  reference file is left untouched.
- **Assisted reps** are excluded from *both* skill and calibration (§7.4), resolving the §6.3/§7.4
  tension — an AI-inflated score would otherwise mask overconfidence. The `assistedRepsInCalibration`
  tunable (off by default) flips this if desired.
- **`confidence`** on a `BaselineRepResult` is `number | null`; `null` represents "no confidence
  captured" (§9) — excluded from the gap, still updates skill.
- **T3 verification** uses constrained-but-effortful formats (mcq/ordering) so baseline finalises
  immediately with no live LLM (§10.1).
- `unit_test` scoring is a pass-fraction passthrough — running submitted code against a hidden
  harness happens upstream (not pure), and the serving path has no in-process execution.
