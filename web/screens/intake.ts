import { h } from "../dom.ts";
import { btn, card, eyebrow } from "../ui.ts";
import { INTAKE_QUESTIONS } from "../labels.ts";
import { intakeComplete } from "../state.ts";
import type { ScreenCtx } from "../screen.ts";
import type { IntakeResponses } from "../../diagnostic.ts";

/**
 * Selection is handled LOCALLY (native radios toggle the dot; we toggle the
 * label highlight and the Continue button) — no app-wide re-render per click, so
 * selecting is instant with no layout jump. Answers commit on Continue.
 */
export function intake(ctx: ScreenCtx): HTMLElement {
  const { state, emit } = ctx;
  const answers: Partial<IntakeResponses> = { ...(state.intake ?? {}) };

  const submitBtn = btn(
    "Start the baseline →",
    () => {
      for (const q of INTAKE_QUESTIONS) {
        const v = answers[q.field];
        if (v !== undefined) emit({ type: "answerIntake", field: q.field, value: v });
      }
      emit({ type: "submitIntake" });
    },
    { disabled: !intakeComplete(answers) },
  );
  const refresh = () => {
    (submitBtn as HTMLButtonElement).disabled = !intakeComplete(answers);
  };

  const questions = INTAKE_QUESTIONS.map((q, qi) => {
    const labels: HTMLElement[] = [];
    for (const opt of q.options) {
      const label = h(
        "label",
        { class: `choice${answers[q.field] === opt.value ? " choice-selected" : ""}` },
        h("input", {
          type: "radio",
          name: q.field,
          checked: answers[q.field] === opt.value,
          onChange: () => {
            answers[q.field] = opt.value;
            labels.forEach((l, idx) => l.classList.toggle("choice-selected", q.options[idx].value === opt.value));
            refresh();
          },
        }),
        h("span", {}, opt.label),
      );
      labels.push(label);
    }
    return h(
      "fieldset",
      { class: "question" },
      h("legend", { class: "question-prompt" }, h("span", { class: "qnum" }, String(qi + 1)), q.prompt),
      h("div", { class: "choices" }, ...labels),
    );
  });

  return card(
    eyebrow("Part A · Intake"),
    h("h1", { class: "title" }, "A few questions to set a starting point"),
    h(
      "p",
      { class: "lede" },
      "A quick read on your background so your first session feels tailored to you — answer as accurately as you can.",
    ),
    h("div", { class: "stack" }, ...questions),
    h("div", { class: "row end" }, submitBtn),
  );
}
