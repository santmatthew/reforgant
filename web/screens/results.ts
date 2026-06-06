import { h, pct, round } from "../dom.ts";
import { btn, card, eyebrow, gauge, pill, bandTone } from "../ui.ts";
import { TIER_NAME, TIER_BLURB, CLUSTER_NAME, CONFIDENCE_TEXT } from "../labels.ts";
import { toSkillStates, scoreRep, TIERS, type DiagnosticResult, type Tier, type TierCalibration } from "../../diagnostic.ts";
import type { ScreenCtx } from "../screen.ts";

export function results(ctx: ScreenCtx): HTMLElement {
  const r = ctx.state.result;
  if (!r) return h("div", {});

  return h(
    "div",
    { class: "stack" },
    headline(r),
    tierBreakdown(r),
    clusterGrid(r),
    calibration(r),
    r.integrityOk ? null : integrityBanner(),
    feedbackReview(ctx),
    footnote(r),
    transparency(r),
    h("div", { class: "row" }, btn("Take it again", () => ctx.restart())),
  );
}

function headline(r: DiagnosticResult): HTMLElement {
  const tone = bandTone(r.riskBand);
  const blurb =
    r.riskBand === "Low"
      ? "Your unassisted edge is largely intact."
      : r.riskBand === "Moderate"
        ? "Some erosion — focused, spaced practice pays off quickly."
        : "Significant atrophy — but skill like this is recoverable.";
  return card(
    eyebrow("Your baseline"),
    h(
      "div",
      { class: "headline" },
      h(
        "div",
        { class: "headline-num" },
        h("span", { class: `big big-${tone}` }, round(r.overallAtrophyIndex)),
        h("span", { class: "big-unit" }, "/ 100 atrophy"),
      ),
      pill(`${r.riskBand} risk`, tone),
    ),
    gauge(r.overallAtrophyIndex, r.riskBand),
    h("p", { class: "lede" }, blurb),
  );
}

function tierBreakdown(r: DiagnosticResult): HTMLElement {
  return card(
    h("h2", { class: "section-title" }, "By tier"),
    h(
      "div",
      { class: "tier-cards" },
      ...r.tiers.map((t) =>
        h(
          "div",
          { class: "tier-card" },
          h("div", { class: "tier-card-head" }, h("strong", {}, TIER_NAME[t.tier]), h("span", { class: "tier-key" }, t.tier)),
          h("p", { class: "fine" }, TIER_BLURB[t.tier]),
          h(
            "div",
            { class: "tier-bar" },
            h("div", { class: `tier-bar-fill tier-${t.tier.toLowerCase()}`, style: `width:${Math.max(0, Math.min(100, t.atrophyIndex))}%` }),
          ),
          h(
            "dl",
            { class: "stats" },
            stat("Atrophy", round(t.atrophyIndex)),
            stat("Skill retained", pct(t.latentSkill)),
            stat("Observations", round(t.observations)),
          ),
        ),
      ),
    ),
  );
}

function clusterGrid(r: DiagnosticResult): HTMLElement {
  const groups = TIERS.map((tier: Tier) => {
    const cells = r.clusters
      .filter((c) => c.tier === tier)
      .map((c) =>
        h(
          "div",
          { class: `cluster-cell${c.reliable ? "" : " provisional"}` },
          h("span", { class: "cluster-name" }, CLUSTER_NAME[c.cluster]),
          h("span", { class: "cluster-skill" }, pct(c.latentSkill)),
          c.reliable ? null : h("span", { class: "cluster-tag" }, "provisional"),
        ),
      );
    return h("div", { class: "cluster-group" }, h("h3", { class: "cluster-group-title" }, TIER_NAME[tier]), ...cells);
  });

  return card(
    h("h2", { class: "section-title" }, "By skill cluster"),
    h("p", { class: "fine" }, "Cluster numbers are low-confidence at baseline — they firm up as the model accumulates reps."),
    h("div", { class: "cluster-grid" }, ...groups),
  );
}

function calibration(r: DiagnosticResult): HTMLElement {
  const tone = r.overconfidenceFlag === true ? "high" : r.overconfidenceFlag === false ? "low" : "muted";
  const verdict =
    r.overconfidenceFlag === true
      ? "Overconfident — your walked-in belief ran ahead of your measured skill."
      : r.overconfidenceFlag === false
        ? "Well-calibrated — your walked-in belief matched your measured skill."
        : "Not enough data yet to judge your calibration.";

  const cells = r.tierCalibration.map((c: TierCalibration) =>
    h(
      "div",
      { class: `calib-cell${c.cleanReps === 0 ? " provisional" : ""}` },
      h("span", { class: "cluster-name" }, TIER_NAME[c.tier]),
      h(
        "span",
        { class: "calib-line" },
        `believed ${CONFIDENCE_TEXT[c.priorLabel]} (${pct(c.priorProb)}) · scored ${pct(c.measuredAccuracy)}`,
      ),
      h(
        "span",
        { class: `calib-gap ${c.gap > 0.05 ? "over" : c.gap < -0.05 ? "under" : "ok"}` },
        signed(c.gap),
      ),
    ),
  );

  return card(
    h("h2", { class: "section-title" }, "Calibration — belief vs reality"),
    h("div", { class: "row gap" }, pill(verdict, tone)),
    h("dl", { class: "stats wide" }, stat("Walked-in gap (globalGap)", signed(r.globalGap))),
    h(
      "p",
      { class: "fine" },
      "Captured before any questions — so it isn't distorted by how earlier reps felt. Positive = you walked in overconfident.",
    ),
    h("div", { class: "calib-grid" }, ...cells),
  );
}

function feedbackReview(ctx: ScreenCtx): HTMLElement {
  // captures pair with the battery by index
  const items = ctx.state.captures
    .map((cap, i) => {
      const rep = ctx.battery[i];
      if (!rep || cap.submission === null) return null;
      return { rep, score: scoreRep(rep, cap.submission) };
    })
    .filter((x): x is { rep: (typeof ctx.battery)[number]; score: number } => x !== null);

  return h(
    "details",
    { class: "transparency" },
    h("summary", {}, `Review your answers (${items.filter((i) => i.score >= 0.999).length}/${items.length} fully correct)`),
    h(
      "div",
      { class: "review" },
      ...items.map((it) =>
        h(
          "div",
          { class: "review-item" },
          h("span", { class: `mark ${it.score >= 0.999 ? "ok" : it.score <= 0.001 ? "no" : "part"}` }, it.score >= 0.999 ? "✓" : it.score <= 0.001 ? "✗" : "~"),
          h("span", { class: "review-cluster" }, CLUSTER_NAME[it.rep.cluster]),
          h("span", { class: "review-prompt" }, it.rep.prompt.split("\n")[0]),
        ),
      ),
    ),
  );
}

function integrityBanner(): HTMLElement {
  return h(
    "div",
    { class: "banner" },
    h("strong", {}, "Some reps were marked assisted. "),
    "Those are excluded from the skill estimate and the calibration windows (assisted success isn't unassisted skill).",
  );
}

function footnote(r: DiagnosticResult): HTMLElement {
  return h(
    "p",
    { class: "fine center" },
    `Based on ${r.scoredRepCount} clean scored rep${r.scoredRepCount === 1 ? "" : "s"} · ` +
      `intake prior weighted as ${r.priorStrength} pseudo-observations · ` +
      `${formatDate(r.generatedAt)} · schema v${r.schemaVersion}`,
  );
}

function transparency(r: DiagnosticResult): HTMLElement {
  return h(
    "details",
    { class: "transparency" },
    h("summary", {}, "Model handoff — the SkillState seeded for each cluster"),
    h("pre", { class: "json" }, JSON.stringify(toSkillStates(r), null, 2)),
  );
}

// helpers
function stat(label: string, value: string): HTMLElement {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, value));
}

function signed(x: number, dp = 2): string {
  const m = 10 ** dp;
  const v = Math.round(x * m) / m;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(dp)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
