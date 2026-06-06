/**
 * The only impure persistence module (§8). localStorage, versioned. Guards the
 * absence of localStorage (tests / SSR) so importing it never throws.
 */

import type { SessionState } from "./state.ts";
import type { DiagnosticResult } from "../diagnostic.ts";

const STORAGE_KEY = "unprompted.diagnostic.v2";
// 3: SessionState gained `language`; captures became positional (no repId).
//    Bump discards older sessions so a stale shape can't resume incorrectly.
const SCHEMA_VERSION = 3 as const;

export interface PersistedState {
  schemaVersion: typeof SCHEMA_VERSION;
  current: SessionState | null; // in-progress (or just-finished) run
  history: DiagnosticResult[]; // completed runs, newest last — never overwritten
}

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function load(): PersistedState | null {
  const s = store();
  if (!s) return null;
  const raw = s.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null; // discard old/corrupt (§8)
    if (!Array.isArray(parsed.history)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function save(current: SessionState | null, history: DiagnosticResult[]): void {
  const s = store();
  if (!s) return;
  const payload: PersistedState = { schemaVersion: SCHEMA_VERSION, current, history };
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota exceeded / private mode — non-fatal */
  }
}
