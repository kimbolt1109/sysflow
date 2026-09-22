import { decideAll, type DecisionAnswer, type DecisionQuestion } from "@/domain/decide.js";

/** Talk to a Laya-compatible decision server, falling back to the local engine.
 * Server protocol (sys decide protocol): POST {base}/decide with
 * {state, questions}, expecting {answers} in sys decision shape.
 * Anything unexpected falls back to local — decisions never hard-fail.
 */
export async function answerQuestions(
  serverUrl: string | undefined,
  state: string,
  questions: Record<string, DecisionQuestion>,
  fetchFn: typeof fetch = fetch,
): Promise<{ answers: Record<string, DecisionAnswer>; source: "laya" | "local" }> {
  if (serverUrl !== undefined && serverUrl !== "") {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetchFn(`${serverUrl.replace(/\/+$/, "")}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state, questions }),
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { answers?: unknown };
          if (typeof data.answers === "object" && data.answers !== null) {
            return { answers: data.answers as Record<string, DecisionAnswer>, source: "laya" };
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // fall through to the local engine
    }
  }
  return { answers: decideAll(state, questions), source: "local" };
}

/** Validate agent-supplied questions; returns the questions or an error message. */
export function parseDecisionQuestions(value: unknown): Record<string, DecisionQuestion> | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "decide needs {questions: {name: {type, instructions, criteria?}}}";
  }
  const out: Record<string, DecisionQuestion> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null)
      return `decide: question "${name}" is not an object`;
    const question = raw as Record<string, unknown>;
    if (question.type === "choice") {
      if (typeof question.criteria !== "object" || question.criteria === null) {
        return `decide: choice "${name}" needs criteria: {option: cues}`;
      }
      out[name] = {
        type: "choice",
        instructions: typeof question.instructions === "string" ? question.instructions : "",
        criteria: question.criteria as Record<string, string>,
      };
    } else if (question.type === "score") {
      if (!Array.isArray(question.criteria)) {
        return `decide: score "${name}" needs criteria: [levels...]`;
      }
      out[name] = {
        type: "score",
        instructions: typeof question.instructions === "string" ? question.instructions : "",
        criteria: question.criteria.filter((c): c is string => typeof c === "string"),
      };
    } else if (question.type === "noul") {
      const list = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
      out[name] = {
        type: "noul",
        instructions: typeof question.instructions === "string" ? question.instructions : "",
        affirm: list(question.affirm),
        deny: list(question.deny),
      };
    } else {
      return `decide: question "${name}" has unknown type (choice|score|noul)`;
    }
  }
  if (Object.keys(out).length === 0) return "decide needs at least one question";
  return out;
}
