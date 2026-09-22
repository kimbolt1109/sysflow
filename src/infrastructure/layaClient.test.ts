import { describe, expect, it } from "vitest";
import { answerQuestions, parseDecisionQuestions } from "@/infrastructure/layaClient.js";

const questions = {
  urgent: {
    type: "noul" as const,
    instructions: "urgent?",
    affirm: ["urgent", "asap"],
  },
};

describe("layaClient", () => {
  it("answers locally without a server", async () => {
    const result = await answerQuestions(undefined, "fix this asap", questions);

    expect(result.source).toBe("local");
    expect(result.answers.urgent).toMatchObject({ kind: "noul", value: true });
  });

  it("falls back to local when the server is unreachable", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    const result = await answerQuestions("http://localhost:9", "fix this asap", questions, failing);

    expect(result.source).toBe("local");
    expect(result.answers.urgent).toMatchObject({ kind: "noul", value: true });
  });

  it("uses a compatible server when it answers", async () => {
    const server = (async () =>
      new Response(
        JSON.stringify({ answers: { urgent: { kind: "noul", value: true, pTrue: 0.99 } } }),
        {
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;
    const result = await answerQuestions("http://localhost:8770", "anything", questions, server);

    expect(result.source).toBe("laya");
    expect(result.answers.urgent).toMatchObject({ pTrue: 0.99 });
  });

  it("validates agent-supplied questions", () => {
    expect(parseDecisionQuestions("nope")).toContain("decide needs");
    expect(parseDecisionQuestions({})).toContain("at least one");
    expect(parseDecisionQuestions({ q: { type: "vibes" } })).toContain("unknown type");
    expect(parseDecisionQuestions({ q: { type: "choice" } })).toContain("criteria");
    const parsed = parseDecisionQuestions(questions);
    expect(typeof parsed).toBe("object");
  });
});
