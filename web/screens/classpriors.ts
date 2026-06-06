import { h } from "../dom.ts";
import { btn, card, eyebrow, ordinalScale } from "../ui.ts";
import { TIER_NAME } from "../labels.ts";
import { TIERS, type Tier, type ConfidenceLabel } from "../../diagnostic.ts";
import type { ScreenCtx } from "../screen.ts";

/** Concrete example skill areas shown under each tier to anchor the rating. */
const TIER_EXAMPLES: Record<Tier, { blurb: string; examples: string[] }> = {
  T1: {
    blurb: "Fast, closed-loop questions you answer in under 30 seconds — without thinking hard.",
    examples: [
      "Write a list comprehension or map expression from memory",
      "State the time complexity of a binary search",
      "Estimate the memory footprint of a million integers",
    ],
  },
  T2: {
    blurb: "Problems requiring you to read, trace, or reason about a concrete snippet.",
    examples: [
      "Spot the bug in a 10-line function",
      "Predict the output of a short program",
      "Choose the right data structure for a given access pattern",
    ],
  },
  T3: {
    blurb: "Open-ended reasoning — no single right answer derivable by pattern-matching alone.",
    examples: [
      "Design the high-level architecture for a URL shortener at scale",
      "Identify the scaling bottleneck in a service under write pressure",
      "Derive the recurrence relation and solution for merge sort",
    ],
  },
};

/**
 * Walked-in beliefs (v2.1). One confidence rating per tier (3 total). Selection
 * is local (ordinalScale updates its own highlight) — no per-click re-render.
 * Ratings commit on "Start the baseline".
 */
export function classpriors(ctx: ScreenCtx): HTMLElement {
  const priors: Partial<Record<Tier, ConfidenceLabel>> = { ...ctx.state.classPriors };
  const complete = () => TIERS.every((t) => priors[t] != null);

  const startBtn = btn(
    "Start the baseline →",
    () => {
      for (const t of TIERS) {
        const v = priors[t];
        if (v) ctx.emit({ type: "setClassPrior", tier: t, label: v });
      }
      ctx.emit({ type: "submitClassPriors" });
    },
    { disabled: !complete() },
  );
  const refresh = () => {
    (startBtn as HTMLButtonElement).disabled = !complete();
  };

  const rows = TIERS.map((tier) => {
    const meta = TIER_EXAMPLES[tier];
    return h(
      "div",
      { class: "prior-row" },
      h("div", { class: "prior-label" }, h("span", { class: "prior-name" }, TIER_NAME[tier])),
      h("p", { class: "lede" }, meta.blurb),
      h(
        "div",
        { class: "prior-examples" },
        h("span", { class: "examples-label" }, "Examples"),
        h("ul", {}, ...meta.examples.map((ex) => h("li", { class: "fine" }, ex))),
      ),
      ordinalScale(priors[tier] ?? null, (label) => {
        priors[tier] = label;
        refresh();
      }),
    );
  });

  return card(
    eyebrow("Before we start · your read"),
    h("h1", { class: "title" }, "How sharp do you feel in each area — unaided?"),
    h(
      "p",
      { class: "lede" },
      "Three gut reads before you see any questions. This is your ",
      h("strong", {}, "walked-in belief"),
      " — we'll compare it to how you actually do.",
    ),
    h("div", { class: "priors" }, ...rows),
    h("div", { class: "row end" }, startBtn),
  );
}
