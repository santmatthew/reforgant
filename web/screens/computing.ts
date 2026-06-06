import { h } from "../dom.ts";
import { card, eyebrow } from "../ui.ts";
import type { ScreenCtx } from "../screen.ts";

/** Momentary screen while main computes the result and dispatches `setResult`. */
export function computing(_ctx: ScreenCtx): HTMLElement {
  return card(
    eyebrow("Scoring"),
    h("div", { class: "computing" }, h("div", { class: "spinner", "aria-hidden": "true" })),
    h("h1", { class: "title center" }, "Reading your baseline…"),
    h("p", { class: "lede center" }, "Folding the intake prior into your unassisted reps."),
  );
}
