import { h } from "../dom.ts";
import { btn, card, eyebrow } from "../ui.ts";
import { INTAKE_QUESTIONS } from "../labels.ts";
import { intakeComplete } from "../state.ts";
import type { ScreenCtx } from "../screen.ts";

export function intake(ctx: ScreenCtx): HTMLElement {
  const { state, emit } = ctx;
  const answers = state.intake ?? {};

  const questions = INTAKE_QUESTIONS.map((q, qi) => {
    const selected = answers[q.field];
    const options = q.options.map((opt) =>
      h(
        "label",
        { class: `choice${selected === opt.value ? " choice-selected" : ""}` },
        h("input", {
          type: "radio",
          name: q.field,
          checked: selected === opt.value,
          onChange: () => emit({ type: "answerIntake", field: q.field, value: opt.value }),
        }),
        h("span", {}, opt.label),
      ),
    );
    return h(
      "fieldset",
      { class: "question" },
      h("legend", { class: "question-prompt" }, h("span", { class: "qnum" }, String(qi + 1)), q.prompt),
      h("div", { class: "choices" }, ...options),
    );
  });

  const complete = intakeComplete(answers);

  return card(
    eyebrow("Part A · Intake"),
    h("h1", { class: "title" }, "A few questions to set a starting point"),
    h("p", { class: "lede" }, "A quick read on your background so your first session feels tailored to you — answer as accurately as you can."),
    h("div", { class: "stack" }, ...questions),
    h(
      "div",
      { class: "row end" },
      btn("Start the baseline →", () => emit({ type: "submitIntake" }), { disabled: !complete }),
    ),
  );
}
