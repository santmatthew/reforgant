/**
 * Boot + orchestration (§10). The ONLY impure module: it reads/writes storage,
 * mints ids/timestamps, runs the clock/timer, calls `computeDiagnostic`, and
 * binds DOM events to the pure `reduce`. All decisions live in state.ts /
 * diagnostic.ts.
 */

import { computeDiagnostic, type DiagnosticResult, type IntakeResponses } from "../diagnostic.ts";
import {
  initialState,
  reduce,
  restampActiveRep,
  currentCapture,
  toRepResults,
  toClassPriors,
  type SessionState,
  type UiEvent,
} from "./state.ts";
import { DEMO_BATTERY, BATTERY_ID, interleaveByCluster } from "./battery.ts";
import { elapsedSeconds } from "./timer.ts";
import * as storage from "./storage.ts";
import { THEMES, applyTheme, loadTheme, currentTheme } from "./theme.ts";
import { h } from "./dom.ts";
import { btn } from "./ui.ts";
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

// Items are interleaved across clusters (v2.1) to stop within-session learning
// from contaminating later same-cluster confidence. Deterministic.
const BATTERY = interleaveByCluster(DEMO_BATTERY);

applyTheme(loadTheme()); // restore the saved theme before first paint

const nowIso = () => new Date().toISOString();
const genId = () =>
  globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const prefersReducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── boot ────────────────────────────────────────────────────────────────────

const persisted = storage.load();
let history: DiagnosticResult[] = persisted?.history ?? [];
const pendingResume: SessionState | null =
  persisted?.current &&
  persisted.current.screen.kind !== "results" &&
  persisted.current.screen.kind in SCREENS && // never resume into a screen we can't render
  persisted.current.batteryId === BATTERY_ID
    ? persisted.current
    : null;
let state: SessionState = initialState(genId(), nowIso(), BATTERY, BATTERY_ID);

// ── dispatch + effects ───────────────────────────────────────────────────────

let computeScheduled = false;

function dispatch(event: UiEvent): void {
  const prev = state;
  let next = reduce(prev, event, nowIso());
  if (event.type === "resume") next = restampActiveRep(next, nowIso()); // §12.4 restart timer
  state = next;

  // Append finished result to history exactly once, on the computing→results edge.
  if (prev.screen.kind === "computing" && state.screen.kind === "results" && state.result) {
    history = [...history, state.result];
  }

  storage.save(state, history);
  render();
  runEffects();
}

function runEffects(): void {
  if (state.screen.kind === "computing" && state.result === null && !computeScheduled) {
    computeScheduled = true;
    setTimeout(doCompute, prefersReducedMotion() ? 50 : 600);
  }
  if (state.screen.kind !== "computing") computeScheduled = false;
}

function doCompute(): void {
  computeScheduled = false;
  if (state.screen.kind !== "computing") return;
  try {
    const result = computeDiagnostic(
      state.intake as IntakeResponses,
      BATTERY,
      toRepResults(state, BATTERY),
      toClassPriors(state),
      nowIso(),
    );
    dispatch({ type: "setResult", result });
  } catch (err) {
    console.error("computeDiagnostic failed", err);
  }
}

function restart(): void {
  dispatch({ type: "retake", runId: genId(), startedAt: nowIso() });
}

// ── render ───────────────────────────────────────────────────────────────────

function makeCtx(): ScreenCtx {
  return {
    state,
    battery: BATTERY,
    emit: dispatch,
    elapsedSeconds: () => elapsedSeconds(currentCapture(state)?.repStartedAt ?? null, Date.now()),
    history,
    pendingResume,
    restart,
  };
}

function themeSwitch(): HTMLElement {
  const active = currentTheme();
  return h(
    "div",
    { class: "theme-switch", role: "group", "aria-label": "Theme" },
    ...THEMES.map((t) =>
      h("button", {
        type: "button",
        class: `swatch${t.id === active ? " swatch-active" : ""}`,
        style: `--sw:${t.swatch}`,
        title: `${t.name} theme`,
        "aria-label": `${t.name} theme`,
        "aria-pressed": String(t.id === active),
        onClick: () => {
          applyTheme(t.id);
          render(); // refresh the active swatch (no screen change → no entrance animation)
        },
      }),
    ),
  );
}

function shell(ctx: ScreenCtx, screen: HTMLElement, entering: boolean): HTMLElement {
  const midRun = state.screen.kind !== "welcome" && state.screen.kind !== "results";
  return h(
    "div",
    { class: "shell" },
    h(
      "header",
      { class: "topbar" },
      h(
        "span",
        { class: "wordmark" },
        h("span", { class: "wordmark-spark", "aria-hidden": "true" }),
        "Reforgant",
        h("span", { class: "wordmark-tag" }, "diagnostic"),
      ),
      h(
        "div",
        { class: "topbar-actions" },
        themeSwitch(),
        midRun
          ? btn("Start over", () => {
              if (confirm("Discard this in-progress session and start over?")) ctx.restart();
            }, { variant: "ghost" })
          : null,
      ),
    ),
    h("main", { class: entering ? "view enter" : "view" }, screen),
  );
}

let tickHandle: ReturnType<typeof setInterval> | undefined;

function manageTicker(): void {
  if (state.screen.kind === "rep") {
    if (tickHandle === undefined) tickHandle = setInterval(updateTimers, 1000);
  } else if (tickHandle !== undefined) {
    clearInterval(tickHandle);
    tickHandle = undefined;
  }
}

function updateTimers(): void {
  const secs = elapsedSeconds(currentCapture(state)?.repStartedAt ?? null, Date.now());
  const m = Math.floor(secs / 60);
  const label = `${m}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
  for (const el of document.querySelectorAll("[data-rep-timer]")) el.textContent = label;
}

function screenKey(s: SessionState): string {
  const sc = s.screen;
  return "i" in sc ? `${sc.kind}:${sc.i}` : sc.kind;
}
let lastScreenKey: string | null = null;

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const view = SCREENS[state.screen.kind];
  if (!view) {
    // Unrenderable screen (e.g. a stale persisted state from an older build).
    // Recover to a fresh run instead of hard-crashing.
    console.warn(`No renderer for screen "${state.screen.kind}"; resetting.`);
    state = initialState(genId(), nowIso(), BATTERY, BATTERY_ID);
    storage.save(state, history);
    render();
    return;
  }
  const key = screenKey(state);
  const entering = key !== lastScreenKey; // animate only when the screen actually changes
  lastScreenKey = key;
  const ctx = makeCtx();
  root.replaceChildren(shell(ctx, view(ctx), entering));
  // move keyboard focus to the new screen's heading for a11y
  (root.querySelector("h1") as HTMLElement | null)?.setAttribute("tabindex", "-1");
  manageTicker();
}

render();
runEffects();
