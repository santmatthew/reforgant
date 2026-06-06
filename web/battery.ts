/**
 * Demo baseline battery (§7), language-parameterized (v2.2).
 *
 * `buildBattery(language)` assembles 15 reps in the §6.1 composition. Reps that
 * probe LANGUAGE-SPECIFIC skill (syntax/idioms, and a debugging snippet) come
 * from per-language sets; where no native rep exists for a language, the slot
 * falls back to a language-AGNOSTIC concept rep — so nobody is tested on a
 * language they didn't choose (the spec's "filtered to declared role where
 * available, otherwise role-agnostic" model).
 *
 * Native problems are authored to make sense FOR THAT LANGUAGE while probing the
 * same skill — never naive translations (whose semantics differ across
 * languages). Deep per-language debugging/reading sets are template-library work;
 * the demo ships idioms for all languages + a Python/JS/TS debugging snippet.
 */

import {
  DIAGNOSTIC_CONFIG,
  type BaselineRep,
  type Tier,
  type ClusterId,
  type McqPayload,
  type NumericTolPayload,
  type RubricProgramPayload,
} from "../diagnostic.ts";

export type Language =
  | "agnostic"
  | "python"
  | "javascript"
  | "typescript"
  | "go"
  | "java"
  | "csharp"
  | "cpp"
  | "c"
  | "rust"
  | "kotlin"
  | "ruby"
  | "swift"
  | "basic";

export interface LanguageDef {
  id: Language;
  name: string;
}

export const LANGUAGES: LanguageDef[] = [
  { id: "agnostic", name: "Any / language-agnostic" },
  { id: "python", name: "Python" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "go", name: "Go" },
  { id: "java", name: "Java" },
  { id: "csharp", name: "C#" },
  { id: "cpp", name: "C++" },
  { id: "c", name: "C" },
  { id: "rust", name: "Rust" },
  { id: "kotlin", name: "Kotlin" },
  { id: "ruby", name: "Ruby" },
  { id: "swift", name: "Swift" },
  { id: "basic", name: "BASIC" },
];

export const DEFAULT_LANGUAGE: Language = "agnostic";

export interface RubricOption {
  id: string;
  label: string;
}
export type RubricUiPayload = RubricProgramPayload & { options: RubricOption[] };

/** Bump when battery content/order changes (gates resume reuse). */
export const BATTERY_ID = "demo-v3";

const DEBUG_W = DIAGNOSTIC_CONFIG.debuggingWeight;

// ── builders ──────────────────────────────────────────────────────────────────

function mcq(
  id: string,
  tier: Tier,
  cluster: ClusterId,
  prompt: string,
  choices: string[],
  correctIndex: number,
  targetSeconds: number,
  weight = 1,
): BaselineRep {
  return { id, tier, cluster, prompt, format: "mcq", payload: { correctIndex, choices } satisfies McqPayload, targetSeconds, weight };
}
function num(
  id: string,
  tier: Tier,
  cluster: ClusterId,
  prompt: string,
  expected: number,
  tolerance: number,
  targetSeconds: number,
): BaselineRep {
  return { id, tier, cluster, prompt, format: "numeric_tol", payload: { expected, tolerance } satisfies NumericTolPayload, targetSeconds, weight: 1 };
}

const DEDUPE_RUBRIC: RubricUiPayload = {
  checks: ["mutates_input", "quadratic_scan", "skips_while_iterating"],
  options: [
    { id: "mutates_input", label: "Mutates the caller's input in place" },
    { id: "quadratic_scan", label: "O(n²) — re-scans the whole list each iteration" },
    { id: "skips_while_iterating", label: "Removes items while iterating, so elements get skipped" },
    { id: "missing_return", label: "Forgets to return a value" },
    { id: "wrong_type", label: "Raises a type error on a list of ints" },
  ],
};

function dedupeRep(lang: Language, langName: string): BaselineRep {
  return {
    id: `dedupe_${lang}`,
    tier: "T2",
    cluster: "debugging",
    prompt: `This ${langName} dedupe helper has problems. Select every real defect.`,
    format: "rubric_program",
    payload: DEDUPE_RUBRIC,
    targetSeconds: 120,
    weight: DEBUG_W,
  };
}

// ── per-language idiom reps (native, all languages) ──────────────────────────

interface Choice4 {
  c: [string, string, string, string];
  i: number;
}

const SQUARES: Record<Exclude<Language, "agnostic">, Choice4> = {
  python: { c: ["map(xs, lambda x: x*x)", "[x * x for x in xs]", "xs.map(x => x*x)", "for x in xs: yield x*x"], i: 1 },
  javascript: { c: ["[x*x for x in xs]", "xs.map(x => x * x)", "xs.select(x => x*x)", "map(xs, x => x*x)"], i: 1 },
  typescript: { c: ["[x*x for x in xs]", "xs.map(x => x * x)", "xs.collect(x => x*x)", "map<number>(xs)"], i: 1 },
  go: { c: ["xs.map(func(x int) int { return x*x })", "for i, x := range xs { out[i] = x * x }", "[x*x for x in xs]", "map(xs, square)"], i: 1 },
  java: { c: ["[x*x for x in xs]", "xs.stream().map(x -> x * x).toList()", "xs.map(x -> x*x)", "Arrays.map(xs, square)"], i: 1 },
  csharp: { c: ["[x*x for x in xs]", "xs.Select(x => x * x).ToList()", "xs.map(x => x*x)", "xs.Map(Square)"], i: 1 },
  cpp: { c: ["xs.map([](int x){ return x*x; })", "std::transform(xs.begin(), xs.end(), out.begin(), [](int x){ return x*x; })", "[x*x for x in xs]", "for x in xs: x*x"], i: 1 },
  c: { c: ["xs.map(square)", "for (i = 0; i < n; i++) out[i] = xs[i] * xs[i];", "[x*x for x in xs]", "map(xs, square)"], i: 1 },
  rust: { c: ["xs.map(|x| x*x)", "xs.iter().map(|x| x * x).collect()", "[x*x for x in xs]", "for x in xs { x*x }"], i: 1 },
  kotlin: { c: ["[x*x for x in xs]", "xs.map { it * it }", "xs.stream().map { it*it }", "for (x in xs) x*x"], i: 1 },
  ruby: { c: ["[x*x for x in xs]", "xs.map { |x| x * x }", "xs.collect_squares", "for x in xs do x*x end"], i: 1 },
  swift: { c: ["xs.map(x => x*x)", "xs.map { $0 * $0 }", "[x*x for x in xs]", "xs.collect { $0*$0 }"], i: 1 },
  basic: { c: ["xs.map(square)", "FOR i = 0 TO n-1 : out(i) = xs(i) * xs(i) : NEXT i", "[x*x for x in xs]", "map(xs, square)"], i: 1 },
};

const COPY: Record<Exclude<Language, "agnostic">, Choice4> = {
  python: { c: ["xs.clone()", "xs[:]", "copy(xs)", "xs.dup"], i: 1 },
  javascript: { c: ["xs.clone()", "[...xs]", "xs.copy()", "new Array(xs)"], i: 1 },
  typescript: { c: ["xs.clone()", "[...xs]", "xs.copy()", "Array<T>(xs)"], i: 1 },
  go: { c: ["copy(xs)", "append([]int(nil), xs...)", "xs.clone()", "new(xs)"], i: 1 },
  java: { c: ["xs.copy()", "new ArrayList<>(xs)", "List.of(xs)", "clone(xs)"], i: 1 },
  csharp: { c: ["xs.Copy()", "new List<int>(xs)", "List.copyOf(xs)", "clone(xs)"], i: 1 },
  cpp: { c: ["xs.clone()", "std::vector<int>(xs)", "memcpy(&dst, &xs)", "&xs"], i: 1 },
  c: { c: ["dst = xs", "memcpy(dst, xs, n * sizeof(int))", "clone(xs)", "xs.copy()"], i: 1 },
  rust: { c: ["copy(xs)", "xs.clone()", "&xs", "xs.dup()"], i: 1 },
  kotlin: { c: ["xs.clone()", "xs.toList()", "xs.copy()", "List(xs)"], i: 1 },
  ruby: { c: ["copy(xs)", "xs.dup", "xs.deep_dup", "Array.copy(xs)"], i: 1 },
  swift: { c: ["xs.clone()", "let copy = xs", "xs.copy()", "deepCopy(xs)"], i: 1 },
  basic: { c: ["dst = xs", "FOR i = 0 TO n-1 : dst(i) = xs(i) : NEXT i", "COPY xs TO dst", "CLONE(xs)"], i: 1 },
};

const NON_AGNOSTIC = LANGUAGES.map((l) => l.id).filter((id): id is Exclude<Language, "agnostic"> => id !== "agnostic");

const IDIOM_SQUARES: Partial<Record<Language, BaselineRep>> = {};
const IDIOM_COPY: Partial<Record<Language, BaselineRep>> = {};
for (const lang of NON_AGNOSTIC) {
  const name = LANGUAGES.find((l) => l.id === lang)!.name;
  IDIOM_SQUARES[lang] = mcq(`idiom_squares_${lang}`, "T1", "syntax_idioms", `Idiomatically in ${name}, which expression builds a new collection of the squares of every item in xs?`, SQUARES[lang].c, SQUARES[lang].i, 20);
  IDIOM_COPY[lang] = mcq(`idiom_copy_${lang}`, "T1", "syntax_idioms", `Idiomatically in ${name}, which expression makes a shallow copy of the list xs?`, COPY[lang].c, COPY[lang].i, 20);
}

// Native debugging snippets only where the bug genuinely holds (skip-while-mutate
// behaves the same in these three). Others fall back to AG_DEDUPE.
const DEDUPE: Partial<Record<Language, BaselineRep>> = {
  python: dedupeRep("python", "Python"),
  javascript: dedupeRep("javascript", "JavaScript"),
  typescript: dedupeRep("typescript", "TypeScript"),
};

// ── language-agnostic reps (shared, fair to everyone) ────────────────────────

const AG_RECALL_1 = mcq("ag_recall_1", "T1", "syntax_idioms", "Which regular expression matches a string that is one or more digits and nothing else?", ["\\d+", "^\\d+$", "[0-9]", ".*\\d.*"], 1, 20);
const AG_RECALL_2 = mcq("ag_recall_2", "T1", "syntax_idioms", "In most languages, evaluating `false && expensive()` does what?", ["Calls expensive(), then returns false", "Returns false without calling expensive() (short-circuit)", "Throws an error", "Returns true"], 1, 20);

const COMPLEXITY_1 = num("complexity_1", "T1", "complexity_estimation", "A balanced binary search tree holds 2^20 (1,048,576) keys. Worst-case key comparisons for one lookup? Enter the integer.", 20, 0, 25);
const COMPLEXITY_2 = mcq("complexity_2", "T1", "complexity_estimation", "Average-case time to look up a key in a hash map with good distribution?", ["O(1)", "O(log n)", "O(n)", "O(n log n)"], 0, 20);
const SIZING_1 = num("sizing_1", "T1", "mental_sizing", "Roughly how many megabytes to store 1,000,000 contiguous 64-bit integers? Enter MB (±1).", 8, 1, 30);

const AG_DEDUPE: BaselineRep = {
  id: "ag_dedupe",
  tier: "T2",
  cluster: "debugging",
  prompt:
    "A dedupe routine loops over a list and, whenever an item occurs more than once, removes it from the same list it is iterating. Regardless of language, which defects does this design risk?",
  format: "rubric_program",
  payload: DEDUPE_RUBRIC,
  targetSeconds: 110,
  weight: DEBUG_W,
};
const DEBUG_CACHE = mcq("debug_cache", "T2", "debugging", "A service intermittently returns stale data. Reads hit a cache; writes update the database but enqueue cache invalidation on a best-effort, fire-and-forget task that can silently drop. Most likely root cause?", ["The database is too slow", "Dropped invalidation messages leave stale entries in the cache", "The cache TTL is too long", "Reads and writes hit different replicas"], 1, 90, DEBUG_W);
const DEBUG_FLOAT = mcq("debug_float", "T2", "debugging", "A loop sums floats and the total is slightly off versus a reference. The values span very large and very small magnitudes. The bug is best described as…", ["An off-by-one in the loop bounds", "Integer overflow", "Floating-point round-off from adding values of very different magnitudes", "A race condition between threads"], 2, 90, DEBUG_W);

const CODE_READ_1 = mcq("code_read_1", "T2", "code_reading", "A list starts as [4, 1, 7]. You append 2, then remove the first element. What does it contain, in order?", ["[1, 7, 2]", "[4, 1, 7, 2]", "[1, 7]", "[7, 1, 2]"], 0, 60);
const CODE_READ_2 = mcq("code_read_2", "T2", "code_reading", "A counter starts at 10. It is doubled, then 5 is subtracted, then halved using integer division. What is the result?", ["7", "15", "8", "10"], 0, 60);
const STRUCTURE_1 = mcq("structure_1", "T2", "structure_choice", "You need O(1) average lookup by key AND must iterate entries in insertion order. Which fits best?", ["A plain array", "A binary search tree", "A hash set", "An insertion-ordered map (e.g. ordered dict / linked hash map)"], 3, 60);

const DESIGN_1 = mcq("design_1", "T3", "system_design", "Designing a URL shortener serving billions of redirects, reads vastly outnumber writes and the hot set is small. Highest-leverage component for read scalability?", ["A message queue between app servers", "Sharding the write path across more primaries", "A cache (CDN / in-memory) in front of the lookup", "A larger connection pool"], 2, 150);
const DESIGN_2 = mcq("design_2", "T3", "system_design", "Order these stages of a durable, write-heavy ingestion pipeline from FIRST to LAST. Which ordering is correct?", ["Index → Validate → Append to log → Acknowledge", "Validate → Append to durable log → Acknowledge → Async index", "Acknowledge → Validate → Index → Append to log", "Append to log → Acknowledge → Index → Validate"], 1, 150);
const SCALING_1 = mcq("scaling_1", "T3", "scaling_reasoning", "A read-heavy service at 50k RPS sees p99 spikes whenever one popular key is written. Single change that best addresses the ROOT bottleneck?", ["Add more application servers", "Increase the DB connection pool", "Add a read-through cache with targeted invalidation for hot keys", "Swap the JSON serializer"], 2, 150);
const DERIVATION_1 = mcq("derivation_1", "T3", "derivation", "Derive the running time of classic merge sort. Which recurrence and solution are correct?", [
  "T(n) = 2·T(n/2) + O(n) → O(n log n)",
  "T(n) = 2·T(n/2) + O(1) → O(n)",
  "T(n) = T(n−1) + O(n) → O(n log n)",
  "T(n) = T(n/2) + O(n) → O(n²)",
], 0, 150);

// ── battery assembly (§6.1 order) ─────────────────────────────────────────────

export function buildBattery(language: Language): BaselineRep[] {
  const squares = IDIOM_SQUARES[language] ?? AG_RECALL_1;
  const copy = IDIOM_COPY[language] ?? AG_RECALL_2;
  const dedupe = DEDUPE[language] ?? AG_DEDUPE;
  return [
    squares, copy, COMPLEXITY_1, COMPLEXITY_2, SIZING_1, // T1
    dedupe, DEBUG_CACHE, DEBUG_FLOAT, CODE_READ_1, CODE_READ_2, STRUCTURE_1, // T2
    DESIGN_1, DESIGN_2, SCALING_1, DERIVATION_1, // T3
  ];
}

/** A stable default battery (agnostic) — used by tests and for capture sizing. */
export const DEMO_BATTERY: BaselineRep[] = buildBattery(DEFAULT_LANGUAGE);

/** Code snippets shown (syntax-highlighted) for the native dedupe reps. */
export const REP_CODE: Record<string, { lang: string; code: string }> = {
  dedupe_python: {
    lang: "python",
    code: `def dedupe(items):
    for x in items:
        if items.count(x) > 1:
            items.remove(x)
    return items`,
  },
  dedupe_javascript: {
    lang: "javascript",
    code: `function dedupe(items) {
  for (const x of items) {
    if (items.filter((y) => y === x).length > 1) {
      items.splice(items.indexOf(x), 1);
    }
  }
  return items;
}`,
  },
  dedupe_typescript: {
    lang: "typescript",
    code: `function dedupe(items: number[]): number[] {
  for (const x of items) {
    if (items.filter((y) => y === x).length > 1) {
      items.splice(items.indexOf(x), 1);
    }
  }
  return items;
}`,
  },
};

/** LaTeX for math choices, aligned with payload.choices, keyed by rep id. */
export const REP_MATH: Record<string, { choices: string[] }> = {
  complexity_2: { choices: ["O(1)", "O(\\log n)", "O(n)", "O(n \\log n)"] },
  derivation_1: {
    choices: [
      "T(n) = 2\\,T(n/2) + O(n)\\ \\Rightarrow\\ O(n \\log n)",
      "T(n) = 2\\,T(n/2) + O(1)\\ \\Rightarrow\\ O(n)",
      "T(n) = T(n-1) + O(n)\\ \\Rightarrow\\ O(n \\log n)",
      "T(n) = T(n/2) + O(n)\\ \\Rightarrow\\ O(n^2)",
    ],
  },
};

/**
 * Deterministic round-robin interleave across clusters (v2.1) — spaces same-
 * cluster items apart so within-session learning can't contaminate later reps.
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
