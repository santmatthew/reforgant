/**
 * Elapsed-seconds measurement (§6). Pure: elapsed is derived from the capture's
 * `repStartedAt` (set when Rep(i) mounts) and the current wall clock — no hidden
 * timer state to lose. On resume we re-stamp `repStartedAt`, so the timer simply
 * restarts (§12.4 default).
 */
export function elapsedSeconds(startedAtIso: string | null, nowMs: number): number {
  if (!startedAtIso) return 0;
  const start = Date.parse(startedAtIso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (nowMs - start) / 1000);
}
