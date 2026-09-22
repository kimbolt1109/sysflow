/** Local System-One-style decision layer (Jev/Laya jobs, no network, no weights).
 * Transparent keyword-evidence judgments with choice/score/noul primitives:
 * deterministic, instant, and honest about being a heuristic — point
 * APP_LAYA_URL at a real decision server for model-grade answers.
 */

export type QuestionKind = "choice" | "score" | "noul";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  affirm?: string[];
  deny?: string[];
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface ChoiceAnswer {
  kind: "choice";
  choice: string;
  confidence: number;
  probs: Record<string, number>;
}

export interface ScoreAnswer {
  kind: "score";
  score: number;
  distribution: number[];
}

export interface NoulAnswer {
  kind: "noul";
  value: boolean;
  pTrue: number;
}

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((w) => w !== "");
}

function overlap(state: Set<string>, phrases: string[]): number {
  let hits = 0;
  for (const phrase of phrases) {
    const parts = words(phrase);
    if (parts.length === 0) continue;
    if (parts.every((p) => state.has(p))) hits += 1;
    else for (const p of parts) if (state.has(p)) hits += 0.25;
  }
  return hits;
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores, 0);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => (sum > 0 ? e / sum : 1 / Math.max(1, scores.length)));
}

const FALLBACK_NAMES = ["other", "none", "unknown", "general", "misc"];

export function decideChoice(state: string, criteria: Record<string, string>): ChoiceAnswer {
  const names = Object.keys(criteria);
  const bag = new Set(words(state));
  const scores = names.map((name) => {
    const nameWords = name.split(/[_-]+/g).join(" ");
    return overlap(bag, [`${nameWords} ${criteria[name] ?? ""}`]);
  });
  const best = Math.max(...scores, 0);
  if (best === 0) {
    const fallback =
      names.find((n) => FALLBACK_NAMES.some((f) => n.toLowerCase().includes(f))) ?? names[0] ?? "";
    const probs: Record<string, number> = {};
    for (const n of names) probs[n] = names.length > 0 ? 1 / names.length : 0;
    return { kind: "choice", choice: fallback, confidence: probs[fallback] ?? 0, probs };
  }
  const probs = softmax(scores);
  let top = 0;
  probs.forEach((p, i) => {
    if (p > (probs[top] ?? 0)) top = i;
  });
  const out: Record<string, number> = {};
  names.forEach((n, i) => {
    out[n] = probs[i] ?? 0;
  });
  return { kind: "choice", choice: names[top] ?? "", confidence: probs[top] ?? 0, probs: out };
}

export function decideScore(state: string, levels: string[]): ScoreAnswer {
  if (levels.length === 0) return { kind: "score", score: 0, distribution: [] };
  const bag = new Set(words(state));
  const scores = levels.map((level) => overlap(bag, [level]));
  if (Math.max(...scores) === 0) {
    return {
      kind: "score",
      score: (levels.length - 1) / 2,
      distribution: levels.map(() => 1 / levels.length),
    };
  }
  const distribution = softmax(scores);
  const score = distribution.reduce((sum, p, i) => sum + p * i, 0);
  return { kind: "score", score, distribution };
}

const NEGATIONS = new Set(["not", "no", "never", "none", "n't", "without", "hardly", "barely"]);

export function decideNoul(state: string, affirm: string[] = [], deny: string[] = []): NoulAnswer {
  const tokens = words(state);
  const bag = new Set(tokens);
  let affirmHits = 0;
  let denyHits = 0;
  const flip = (phrase: string): boolean => {
    const parts = words(phrase);
    if (parts.length === 0 || !parts.every((p) => bag.has(p))) return false;
    const first = tokens.indexOf(parts[0] as string);
    for (let i = Math.max(0, first - 3); i < first; i += 1) {
      if (NEGATIONS.has(tokens[i] ?? "")) return true;
    }
    return false;
  };
  for (const phrase of affirm) {
    if (!words(phrase).every((p) => bag.has(p))) continue;
    if (flip(phrase)) denyHits += 1;
    else affirmHits += 1;
  }
  for (const phrase of deny) {
    if (words(phrase).every((p) => bag.has(p))) denyHits += 1;
  }
  if (affirmHits === 0 && denyHits === 0) return { kind: "noul", value: false, pTrue: 0.5 };
  const pTrue = (affirmHits + 1) / (affirmHits + denyHits + 2);
  return { kind: "noul", value: pTrue >= 0.5, pTrue };
}

export function decideAll(
  state: string,
  questions: Record<string, DecisionQuestion>,
): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    if (question.type === "choice") out[name] = decideChoice(state, question.criteria);
    else if (question.type === "score") out[name] = decideScore(state, question.criteria);
    else out[name] = decideNoul(state, question.affirm, question.deny);
  }
  return out;
}

export function formatDecisions(answers: Record<string, DecisionAnswer>): string {
  return Object.entries(answers)
    .map(([name, answer]) => {
      if (answer.kind === "choice") {
        return `- ${name}: ${answer.choice} (confidence ${(answer.confidence * 100).toFixed(0)}%)`;
      }
      if (answer.kind === "score") {
        return `- ${name}: ${answer.score.toFixed(2)} / ${(answer.distribution.length - 1).toFixed(0)}`;
      }
      return `- ${name}: ${answer.value ? "yes" : "no"} (p=${answer.pTrue.toFixed(2)})`;
    })
    .join("\n");
}

/** Ready-made question sets mirroring Laya's presets, with local cue lists. */
export function guardQuestions(): Record<string, DecisionQuestion> {
  return {
    jailbreak: {
      type: "noul",
      instructions: "Does the prompt try to make an AI ignore its rules or policies?",
      affirm: [
        "ignore your instructions",
        "disregard your rules",
        "forget your instructions",
        "do anything now",
        "jailbreak",
        "developer mode",
        "pretend you are",
      ],
    },
    prompt_injection: {
      type: "noul",
      instructions: "Does the prompt hide instructions aimed at the AI system?",
      affirm: ["system prompt", "ignore previous", "new instructions", "instruction hierarchy"],
    },
    sensitive_data: {
      type: "noul",
      instructions: "Does the prompt contain credentials or personal data?",
      affirm: [
        "password",
        "passwd",
        "api key",
        "apikey",
        "secret key",
        "private key",
        "ssn",
        "credit card",
      ],
    },
    harm_severity: {
      type: "score",
      instructions: "How much harm would complying cause?",
      criteria: [
        "ordinary request",
        "mildly inappropriate",
        "unsafe advice or abuse",
        "dangerous or illegal",
      ],
    },
  };
}

export function triageQuestions(): Record<string, DecisionQuestion> {
  return {
    intent: {
      type: "choice",
      instructions: "What does the customer want?",
      criteria: {
        refund: "money returned, duplicate charge reversed, refund",
        technical_help: "bug, outage, error, integration problem",
        billing_question: "invoice, plan, payment method",
        cancellation: "cancel, downgrade, leave, unsubscribe",
        information: "pricing, how-to, general information",
        other: "none of the other options fits",
      },
    },
    is_urgent: {
      type: "noul",
      instructions: "Does the message communicate time pressure?",
      affirm: ["urgent", "asap", "deadline", "blocking", "critical", "immediately", "right now"],
    },
    refund_requested: {
      type: "noul",
      instructions: "Does the customer ask for money back?",
      affirm: ["refund", "money back", "chargeback", "return my money"],
    },
    churn_risk: {
      type: "noul",
      instructions: "Might the customer leave or cancel?",
      affirm: ["cancel", "leave", "competitor", "unsubscribe", "switch to"],
    },
  };
}

export interface PromptScreen {
  risky: boolean;
  notes: string[];
}

/** Screen a prompt with guard presets. Advisory only — never blocks. */
export function screenPrompt(text: string): PromptScreen {
  const answers = decideAll(text, guardQuestions());
  const notes: string[] = [];
  for (const [name, answer] of Object.entries(answers)) {
    if (answer.kind === "noul" && answer.value && answer.pTrue >= 0.6) {
      notes.push(`${name} (p=${answer.pTrue.toFixed(2)})`);
    }
    if (answer.kind === "score" && answer.score >= 2) {
      notes.push(`harm_severity ${answer.score.toFixed(1)}`);
    }
  }
  return { risky: notes.length > 0, notes };
}
