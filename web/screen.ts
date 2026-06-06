/** Render context handed to each screen. Screens are pure of state/decisions. */

import type { SessionState, UiEvent } from "./state.ts";
import type { BaselineRep, DiagnosticResult } from "../diagnostic.ts";

export interface ScreenCtx {
  state: SessionState;
  battery: BaselineRep[];
  /** Dispatch a reduce event (the only way a screen affects the app). */
  emit: (event: UiEvent) => void;
  /** Live reading of the current rep's elapsed seconds (impure clock; §6). */
  elapsedSeconds: () => number;
  /** Completed prior runs, for the "previous attempts" list (§8). */
  history: DiagnosticResult[];
  /** An in-progress run found in storage, if any, to offer Resume (§8). */
  pendingResume: SessionState | null;
  /** Start a fresh run (main mints the new runId/startedAt and pushes history). */
  restart: () => void;
}

export type ScreenView = (ctx: ScreenCtx) => HTMLElement;
