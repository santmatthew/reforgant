/**
 * Demo baseline battery (§7).
 *
 * Fifteen ILLUSTRATIVE reps following compute §6.1 composition exactly: all 9
 * clusters, the four programmatically-scorable formats, debugging over-sampled
 * at weight 1.5. Content is demo-grade and clearly marked — the real battery is
 * out-of-scope IP (§2). No `unit_test` reps (no client harness).
 *
 * `rubric_program` reps carry a `payload.options` list (correct ids + DISTRACTORS)
 * for rendering; `scoreRep` reads only `payload.checks` (the answer key) and
 * ignores `options` (§7).
 */

import {
  DIAGNOSTIC_CONFIG,
  type BaselineRep,
  type ClusterId,
  type McqPayload,
  type ExactPayload,
  type NumericTolPayload,
  type RubricProgramPayload,
} from "../diagnostic.ts";

/** Extra (UI-only) payload fields the battery may attach; `scoreRep` ignores them. */
export interface RubricOption {
  id: string;
  label: string;
}
export type RubricUiPayload = RubricProgramPayload & { options: RubricOption[] };

/** Bumped whenever the battery content/order changes (gates resume reuse). */
export const BATTERY_ID = "demo-v2";

const DEBUG_W = DIAGNOSTIC_CONFIG.debuggingWeight;

export const DEMO_BATTERY: BaselineRep[] = [
  // ── T1 · syntax_idioms (2 · mcq) ───────────────────────────────────────────
  {
    id: "t1_syntax_1",
    tier: "T1",
    cluster: "syntax_idioms",
    prompt: "Idiomatically in Python, which expression builds a new list of the squares of every int in `xs`?",
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
    id: "t1_syntax_2",
    tier: "T1",
    cluster: "syntax_idioms",
    prompt: "In modern JavaScript, which expression makes a shallow copy of the array `arr`?",
    format: "mcq",
    payload: {
      correctIndex: 2,
      choices: ["arr.copy()", "Array.clone(arr)", "[...arr]", "new Array(arr)"],
    } satisfies McqPayload,
    targetSeconds: 20,
    weight: 1.0,
  },

  // ── T1 · complexity_estimation (2 · numeric_tol, mcq) ──────────────────────
  {
    id: "t1_complexity_1",
    tier: "T1",
    cluster: "complexity_estimation",
    prompt: "A balanced binary search tree holds 2^20 (1,048,576) keys. Worst-case key comparisons for one lookup? Enter the integer.",
    format: "numeric_tol",
    payload: { expected: 20, tolerance: 0 } satisfies NumericTolPayload,
    targetSeconds: 25,
    weight: 1.0,
  },
  {
    id: "t1_complexity_2",
    tier: "T1",
    cluster: "complexity_estimation",
    prompt: "What is the average-case time complexity of looking up a key in a hash map with good distribution?",
    format: "mcq",
    payload: {
      correctIndex: 0,
      choices: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
    } satisfies McqPayload,
    targetSeconds: 20,
    weight: 1.0,
  },

  // ── T1 · mental_sizing (1 · numeric_tol) ───────────────────────────────────
  {
    id: "t1_sizing_1",
    tier: "T1",
    cluster: "mental_sizing",
    prompt: "Roughly how many megabytes are needed to store 1,000,000 contiguous 64-bit integers? Enter MB (±1).",
    format: "numeric_tol",
    payload: { expected: 8, tolerance: 1 } satisfies NumericTolPayload,
    targetSeconds: 30,
    weight: 1.0,
  },

  // ── T2 · debugging (3 · rubric_program, mcq) · weight 1.5 ───────────────────
  {
    id: "t2_debug_1",
    tier: "T2",
    cluster: "debugging",
    prompt: "This Python dedupe helper has problems. Select every real defect.",
    format: "rubric_program",
    payload: {
      checks: ["mutates_input", "quadratic_scan", "skips_while_iterating"],
      options: [
        { id: "mutates_input", label: "Mutates the caller's input list in place" },
        { id: "quadratic_scan", label: "O(n²) — calls items.count() inside the loop" },
        { id: "skips_while_iterating", label: "Removes items while iterating, so elements are skipped" },
        { id: "missing_return", label: "Forgets to return a value" },
        { id: "wrong_type", label: "Raises a TypeError on a list of ints" },
      ],
    } satisfies RubricUiPayload,
    targetSeconds: 120,
    weight: DEBUG_W,
  },
  {
    id: "t2_debug_2",
    tier: "T2",
    cluster: "debugging",
    prompt:
      "A service intermittently returns stale data. Reads hit a cache; writes update the database but enqueue cache invalidation on a best-effort, fire-and-forget task that can silently drop. What is the most likely root cause?",
    format: "mcq",
    payload: {
      correctIndex: 1,
      choices: [
        "The database is too slow",
        "Dropped invalidation messages leave stale entries in the cache",
        "The cache TTL is too long",
        "Reads and writes hit different replicas",
      ],
    } satisfies McqPayload,
    targetSeconds: 90,
    weight: DEBUG_W,
  },
  {
    id: "t2_debug_3",
    tier: "T2",
    cluster: "debugging",
    prompt:
      "A loop sums floats and the total is slightly off versus a reference. The values span very large and very small magnitudes. The bug is best described as…",
    format: "mcq",
    payload: {
      correctIndex: 2,
      choices: [
        "An off-by-one error in the loop bounds",
        "Integer overflow",
        "Floating-point round-off from adding values of very different magnitudes",
        "A race condition between threads",
      ],
    } satisfies McqPayload,
    targetSeconds: 90,
    weight: DEBUG_W,
  },

  // ── T2 · code_reading (2 · exact, mcq) ─────────────────────────────────────
  {
    id: "t2_reading_1",
    tier: "T2",
    cluster: "code_reading",
    prompt: "What does this print?",
    format: "exact",
    payload: { expected: "4" } satisfies ExactPayload,
    targetSeconds: 60,
    weight: 1.0,
  },
  {
    id: "t2_reading_2",
    tier: "T2",
    cluster: "code_reading",
    prompt: "What is logged?",
    format: "mcq",
    payload: {
      correctIndex: 0,
      choices: ["0,1,2", "3,3,3", "0,0,0", "undefined,undefined,undefined"],
    } satisfies McqPayload,
    targetSeconds: 75,
    weight: 1.0,
  },

  // ── T2 · structure_choice (1 · mcq) ────────────────────────────────────────
  {
    id: "t2_structure_1",
    tier: "T2",
    cluster: "structure_choice",
    prompt:
      "You need O(1) average lookup by key AND must iterate entries in insertion order. Which structure fits best?",
    format: "mcq",
    payload: {
      correctIndex: 3,
      choices: [
        "A plain array",
        "A binary search tree",
        "A hash set",
        "An insertion-ordered map (e.g. JS Map / Python dict)",
      ],
    } satisfies McqPayload,
    targetSeconds: 60,
    weight: 1.0,
  },

  // ── T3 · system_design (2 · mcq constrained / ordering) ────────────────────
  {
    id: "t3_design_1",
    tier: "T3",
    cluster: "system_design",
    prompt:
      "Designing a URL shortener serving billions of redirects. Reads vastly outnumber writes and the working set of hot links is small. The single highest-leverage component for read scalability is…",
    format: "mcq",
    payload: {
      correctIndex: 2,
      choices: [
        "A message queue between app servers",
        "Sharding the write path across more primaries",
        "A cache (CDN / in-memory) in front of the lookup",
        "A larger connection pool",
      ],
    } satisfies McqPayload,
    targetSeconds: 150,
    weight: 1.0,
  },
  {
    id: "t3_design_2",
    tier: "T3",
    cluster: "system_design",
    prompt:
      "Order these stages of a durable write-heavy ingestion pipeline from FIRST to LAST. Which ordering is correct?",
    format: "mcq",
    payload: {
      correctIndex: 1,
      choices: [
        "Index → Validate → Append to log → Acknowledge",
        "Validate → Append to durable log → Acknowledge → Async index",
        "Acknowledge → Validate → Index → Append to log",
        "Append to log → Acknowledge → Index → Validate",
      ],
    } satisfies McqPayload,
    targetSeconds: 150,
    weight: 1.0,
  },

  // ── T3 · scaling_reasoning (1 · mcq) ───────────────────────────────────────
  {
    id: "t3_scaling_1",
    tier: "T3",
    cluster: "scaling_reasoning",
    prompt:
      "A read-heavy service at 50k RPS sees p99 latency spikes whenever one popular key is written. Which single change best addresses the ROOT bottleneck?",
    format: "mcq",
    payload: {
      correctIndex: 2,
      choices: [
        "Add more application servers behind the load balancer",
        "Increase the database connection pool size",
        "Add a read-through cache with targeted invalidation for hot keys",
        "Swap the JSON serializer for a faster one",
      ],
    } satisfies McqPayload,
    targetSeconds: 150,
    weight: 1.0,
  },

  // ── T3 · derivation (1 · mcq ordering) ─────────────────────────────────────
  {
    id: "t3_derivation_1",
    tier: "T3",
    cluster: "derivation",
    prompt:
      "Derive the running time of classic merge sort. Which recurrence and its solution are correct?",
    format: "mcq",
    payload: {
      correctIndex: 0,
      choices: [
        "T(n) = 2·T(n/2) + O(n)  →  O(n log n)",
        "T(n) = 2·T(n/2) + O(1)  →  O(n)",
        "T(n) = T(n−1) + O(n)    →  O(n log n)",
        "T(n) = T(n/2) + O(n)    →  O(n²)",
      ],
    } satisfies McqPayload,
    targetSeconds: 150,
    weight: 1.0,
  },
];

/**
 * Deterministic round-robin interleave across clusters (v2.1). Blocking items by
 * cluster lets within-session learning contaminate later same-cluster confidence;
 * interleaving spaces them out. Stable: groups by first-appearance cluster order,
 * then emits one per cluster in rotation. No RNG → reproducible.
 */
export function interleaveByCluster(reps: BaselineRep[]): BaselineRep[] {
  const groups = new Map<ClusterId, BaselineRep[]>();
  const order: ClusterId[] = [];
  for (const r of reps) {
    let g = groups.get(r.cluster);
    if (!g) {
      g = [];
      groups.set(r.cluster, g);
      order.push(r.cluster);
    }
    g.push(r);
  }
  const out: BaselineRep[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const c of order) {
      const next = groups.get(c)!.shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}

/** Code snippets shown (syntax-highlighted) beneath the prompt, keyed by rep id. */
export const REP_CODE: Record<string, { lang: string; code: string }> = {
  t2_debug_1: {
    lang: "python",
    code: `def dedupe(items):
    for x in items:
        if items.count(x) > 1:
            items.remove(x)
    return items`,
  },
  t2_reading_1: {
    lang: "python",
    code: `a = [1, 2, 3]
b = a
b.append(4)
print(len(a))`,
  },
  t2_reading_2: {
    lang: "javascript",
    code: `const fns = [];
for (let i = 0; i < 3; i++) fns.push(() => i);
console.log(fns.map(f => f()).join(','));`,
  },
};

/** LaTeX for math choices, aligned with payload.choices, keyed by rep id. */
export const REP_MATH: Record<string, { choices: string[] }> = {
  t1_complexity_2: { choices: ["O(1)", "O(\\log n)", "O(n)", "O(n \\log n)"] },
  t3_derivation_1: {
    choices: [
      "T(n) = 2\\,T(n/2) + O(n)\\ \\Rightarrow\\ O(n \\log n)",
      "T(n) = 2\\,T(n/2) + O(1)\\ \\Rightarrow\\ O(n)",
      "T(n) = T(n-1) + O(n)\\ \\Rightarrow\\ O(n \\log n)",
      "T(n) = T(n/2) + O(n)\\ \\Rightarrow\\ O(n^2)",
    ],
  },
};
