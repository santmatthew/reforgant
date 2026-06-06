import { h, inlineCode } from "../dom.ts";
import { btn, card, eyebrow, progress } from "../ui.ts";
import { activeIndex } from "../state.ts";
import { TIER_NAME, CLUSTER_NAME } from "../labels.ts";
import { highlight } from "../highlight.ts";
import { mathToHtml } from "../math.ts";
import { REP_CODE, REP_MATH, type RubricUiPayload } from "../battery.ts";
import type { ScreenCtx } from "../screen.ts";
import type { Submission, McqPayload } from "../../diagnostic.ts";

/**
 * Rep screen. The answer is held locally and committed only on Submit (avoids
 * re-render thrash). The timer ticks via main's setInterval.
 */
export function rep(ctx: ScreenCtx): HTMLElement {
  const i = activeIndex(ctx.state);
  if (i === null) return h("div", {});
  const rep = ctx.battery[i];
  if (!rep) return h("div", {});

  let submission: Submission | null = null;

  const submitBtn = btn("Submit & continue →", () => {
    if (!submission) return;
    ctx.emit({ type: "setSubmission", i, submission });
    ctx.emit({ type: "submitRep", i, elapsedSeconds: ctx.elapsedSeconds() });
  }, { disabled: true });

  const setValid = (valid: boolean) => {
    (submitBtn as HTMLButtonElement).disabled = !valid;
  };
  const commit = (s: Submission, valid = true) => {
    submission = s;
    setValid(valid);
  };

  const code = REP_CODE[rep.id];
  const mathChoices = REP_MATH[rep.id]?.choices;
  const widget = buildWidget(rep, i, commit, mathChoices);

  return card(
    h(
      "div",
      { class: "rep-head" },
      eyebrow(`Rep ${i + 1} of ${ctx.battery.length} · ${TIER_NAME[rep.tier]} · ${CLUSTER_NAME[rep.cluster]}`),
      h("span", { class: "rep-timer", "data-rep-timer": "" }, formatElapsed(ctx.elapsedSeconds())),
    ),
    progress(i + 1, ctx.battery.length),
    h("div", { class: "rep-prompt" }, ...inlineCode(rep.prompt)),
    code ? h("pre", { class: "code-block" }, h("code", { html: highlight(code.code, code.lang) })) : null,
    h("p", { class: "fine" }, "Solve this unaided — no assistant, no search."),
    widget,
    h("div", { class: "row end" }, submitBtn),
  );
}

function buildWidget(
  rep: { format: string; payload: unknown },
  i: number,
  commit: (s: Submission, valid?: boolean) => void,
  mathChoices?: string[],
): HTMLElement {
  switch (rep.format) {
    case "mcq": {
      const choices = (rep.payload as McqPayload).choices ?? [];
      return h(
        "div",
        { class: "choices" },
        ...choices.map((label, idx) => {
          const tex = mathChoices?.[idx];
          const rendered = tex ? mathToHtml(tex) : null;
          return h(
            "label",
            { class: "choice" },
            h("input", {
              type: "radio",
              name: `rep-${i}`,
              onChange: () => commit({ kind: "mcq", choiceIndex: idx }),
            }),
            rendered ? h("span", { html: rendered }) : h("span", {}, label),
          );
        }),
      );
    }

    case "exact": {
      return h("input", {
        type: "text",
        class: "text-input",
        autocomplete: "off",
        placeholder: "Type your answer",
        "aria-label": "Your answer",
        onInput: (e: Event) => {
          const value = (e.target as HTMLInputElement).value;
          commit({ kind: "exact", value }, value.trim().length > 0);
        },
      });
    }

    case "numeric_tol": {
      const onNum = (el: HTMLInputElement) => {
        const raw = el.value;
        const n = Number(raw);
        commit({ kind: "numeric_tol", value: n }, raw.trim() !== "" && !Number.isNaN(n));
      };
      const input = h("input", {
        type: "number",
        class: "text-input",
        step: "any",
        placeholder: "Enter a number",
        "aria-label": "Your numeric answer",
        onInput: (e: Event) => onNum(e.target as HTMLInputElement),
      }) as HTMLInputElement;
      const bump = (delta: number) => {
        const cur = Number(input.value);
        input.value = String((Number.isFinite(cur) ? cur : 0) + delta);
        onNum(input);
        input.focus();
      };
      return h(
        "div",
        { class: "number-field" },
        input,
        h(
          "div",
          { class: "stepper" },
          h("button", { type: "button", class: "step-btn", tabindex: "-1", "aria-label": "Increment", onClick: () => bump(1) }, "▲"),
          h("button", { type: "button", class: "step-btn", tabindex: "-1", "aria-label": "Decrement", onClick: () => bump(-1) }, "▼"),
        ),
      );
    }

    case "rubric_program": {
      const options = (rep.payload as RubricUiPayload).options ?? [];
      const checked = new Set<string>();
      // empty selection is a valid submission (scored, just low)
      commit({ kind: "rubric_program", satisfied: [] }, true);
      return h(
        "div",
        { class: "checks" },
        h("p", { class: "fine" }, "Select every defect that applies."),
        ...options.map((opt) =>
          h(
            "label",
            { class: "choice" },
            h("input", {
              type: "checkbox",
              onChange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) checked.add(opt.id);
                else checked.delete(opt.id);
                commit({ kind: "rubric_program", satisfied: [...checked] }, true);
              },
            }),
            h("span", {}, opt.label),
          ),
        ),
      );
    }

    default:
      return h("div", { class: "fine" }, `Unsupported format: ${rep.format}`);
  }
}

function formatElapsed(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
