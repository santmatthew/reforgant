/** Shared presentational building blocks (no app logic). */

import { h } from "./dom.ts";
import { CONFIDENCE_TEXT } from "./labels.ts";
import { CONFIDENCE_LABELS, type ConfidenceLabel } from "../diagnostic.ts";

/**
 * 5-point ordinal confidence selector (v2.1). Updates its own highlight in place
 * (no app-wide re-render), then calls onPick — so selecting feels instant.
 */
export function ordinalScale(
  selected: ConfidenceLabel | null,
  onPick: (label: ConfidenceLabel) => void,
): HTMLElement {
  const buttons: HTMLElement[] = [];
  const root = h("div", { class: "ordinal", role: "radiogroup", "aria-label": "Confidence" });
  for (const label of CONFIDENCE_LABELS) {
    const b = h(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(selected === label),
        class: `ordinal-opt${selected === label ? " ordinal-selected" : ""}`,
        onClick: () => {
          buttons.forEach((btn, idx) => {
            const on = CONFIDENCE_LABELS[idx] === label;
            btn.classList.toggle("ordinal-selected", on);
            btn.setAttribute("aria-checked", String(on));
          });
          onPick(label);
        },
      },
      CONFIDENCE_TEXT[label],
    );
    buttons.push(b);
    root.append(b);
  }
  return root;
}

export function card(...children: (Node | string | null | undefined | false)[]): HTMLElement {
  return h("section", { class: "card" }, ...children);
}

export function btn(
  label: string,
  onClick: () => void,
  opts: { variant?: "primary" | "ghost"; disabled?: boolean } = {},
): HTMLElement {
  return h("button", {
    class: `btn btn-${opts.variant ?? "primary"}`,
    type: "button",
    disabled: opts.disabled ?? false,
    onClick,
  }, label);
}

export function pill(text: string, tone?: "low" | "moderate" | "high" | "muted"): HTMLElement {
  return h("span", { class: `pill${tone ? ` pill-${tone}` : ""}` }, text);
}

export function progress(current: number, total: number): HTMLElement {
  const frac = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  return h(
    "div",
    { class: "progress", role: "progressbar", "aria-valuenow": String(current), "aria-valuemax": String(total) },
    h("div", { class: "progress-fill", style: `width:${frac * 100}%` }),
  );
}

export function eyebrow(text: string): HTMLElement {
  return h("p", { class: "eyebrow" }, text);
}

/** A horizontal 0–100 atrophy gauge with a marker and the band color. */
export function gauge(index: number, band: "Low" | "Moderate" | "High"): HTMLElement {
  const tone = band.toLowerCase();
  const clamped = Math.max(0, Math.min(100, index));
  return h(
    "div",
    { class: `gauge gauge-${tone}` },
    h(
      "div",
      { class: "gauge-track" },
      h("div", { class: "gauge-fill", style: `width:${clamped}%` }),
      h("div", { class: "gauge-marker", style: `left:${clamped}%` }),
    ),
    h(
      "div",
      { class: "gauge-scale" },
      h("span", {}, "0"),
      h("span", { class: "gauge-tick", style: "left:35%" }),
      h("span", { class: "gauge-tick", style: "left:65%" }),
      h("span", {}, "100"),
    ),
  );
}

export const bandTone = (band: "Low" | "Moderate" | "High"): "low" | "moderate" | "high" =>
  band.toLowerCase() as "low" | "moderate" | "high";
