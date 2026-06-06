/** Display copy — keeps human strings out of logic modules. */

import type { Tier, ClusterId, IntakeResponses, IntakeAnswer, ConfidenceLabel } from "../diagnostic.ts";

/** Display text for the 5-point ordinal confidence scale (v2.1). */
export const CONFIDENCE_TEXT: Record<ConfidenceLabel, string> = {
  guess: "Just guessing",
  leaning: "Leaning one way",
  fairlySure: "Fairly sure",
  confident: "Confident",
  certain: "Certain",
};

export const TIER_NAME: Record<Tier, string> = {
  T1: "Quick Recall",
  T2: "Scenario Analysis",
  T3: "First Principles",
};

export const TIER_BLURB: Record<Tier, string> = {
  T1: "Fast, closed-loop recall — syntax, complexity, sizing. Decays first.",
  T2: "Applied judgement — debugging, reading code, choosing structures.",
  T3: "Open-ended reasoning — system design, scaling, derivation. Most durable.",
};

export const CLUSTER_NAME: Record<ClusterId, string> = {
  syntax_idioms: "Syntax & idioms",
  complexity_estimation: "Complexity estimation",
  mental_sizing: "Mental sizing",
  debugging: "Debugging",
  code_reading: "Code reading",
  structure_choice: "Structure choice",
  system_design: "System design",
  scaling_reasoning: "Scaling reasoning",
  derivation: "Derivation",
};

/** The five intake questions (compute §4). `value` is the IntakeAnswer 0/1/2. */
export interface IntakeOption {
  value: IntakeAnswer;
  label: string;
}
export interface IntakeQuestion {
  field: keyof IntakeResponses;
  prompt: string;
  options: IntakeOption[];
}

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    field: "timeline",
    prompt: "How long have you been leaning on AI coding assistants?",
    options: [
      { value: 0, label: "Less than 6 months" },
      { value: 1, label: "1–2 years" },
      { value: 2, label: "3+ years" },
    ],
  },
  {
    field: "delegation",
    prompt: "How often do you hand the actual coding to an assistant?",
    options: [
      { value: 0, label: "Rarely" },
      { value: 1, label: "Sometimes" },
      { value: 2, label: "Almost always" },
    ],
  },
  {
    field: "recency",
    prompt: "When did you last solve a non-trivial problem fully unaided?",
    options: [
      { value: 0, label: "In the last 7 days" },
      { value: 1, label: "In the last 30 days" },
      { value: 2, label: "Longer ago, or I can't remember" },
    ],
  },
  {
    field: "reserve",
    prompt: "How many years were you coding before AI tools were part of your work?",
    options: [
      { value: 0, label: "8+ years" },
      { value: 1, label: "3–7 years" },
      { value: 2, label: "0–2 years" },
    ],
  },
  {
    field: "confidence",
    prompt: "Right now, how sharp do you feel working without assistance?",
    options: [
      { value: 0, label: "Worried" },
      { value: 1, label: "A bit rusty" },
      { value: 2, label: "Still sharp" },
    ],
  },
];
