import { h, round } from "../dom.ts";
import { btn, card, eyebrow, pill } from "../ui.ts";
import type { ScreenCtx } from "../screen.ts";

export function welcome(ctx: ScreenCtx): HTMLElement {
  const { emit, pendingResume, history } = ctx;

  const intro = card(
    eyebrow("Skills baseline · ~12 minutes"),
    h("h1", { class: "display" }, "How sharp are you without the assist?"),
    h(
      "p",
      { class: "lede" },
      "Five quick questions, a gut-read on how sharp you feel in each area, then about fifteen short reps you solve ",
      h("strong", {}, "unaided"),
      " — no feedback until the end, so nothing skews your performance. You'll get a baseline: where your " +
        "unassisted skill stands, and how well your going-in confidence matched it.",
    ),
    h(
      "div",
      { class: "row" },
      btn("Begin diagnostic", () => emit({ type: "startIntake" })),
      pendingResume
        ? btn("Resume in-progress session", () => emit({ type: "resume", persisted: pendingResume }), {
            variant: "ghost",
          })
        : null,
    ),
    h("p", { class: "fine" }, "Nothing leaves your browser. No account, no server scoring."),
  );

  const previous = history.length
    ? card(
        h("h2", { class: "section-title" }, "Previous attempts"),
        h(
          "ul",
          { class: "history" },
          ...history
            .slice()
            .reverse()
            .map((r) =>
              h(
                "li",
                { class: "history-item" },
                h("span", { class: "history-date" }, formatDate(r.generatedAt)),
                pill(`${round(r.overallAtrophyIndex)} atrophy`, "muted"),
                pill(r.riskBand, r.riskBand.toLowerCase() as "low" | "moderate" | "high"),
              ),
            ),
        ),
      )
    : null;

  return h("div", { class: "stack" }, intro, previous);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
