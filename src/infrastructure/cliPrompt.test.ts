import { describe, expect, it } from "vitest";
import { renderCliPrompt } from "@/infrastructure/cliPrompt.js";
import type { ChatMessage } from "@/domain/models.js";

describe("renderCliPrompt", () => {
  it("passes a bare user message through untouched", () => {
    expect(renderCliPrompt([{ role: "user", content: "hello" }], 1000)).toBe("hello");
  });

  it("keeps system instructions the CLI would otherwise never see", () => {
    const prompt = renderCliPrompt(
      [
        { role: "system", content: 'Reply ONLY as JSON like {"score": 7}.' },
        { role: "user", content: "score these plans" },
      ],
      10000,
    );

    expect(prompt).toContain('<instructions>\nReply ONLY as JSON like {"score": 7}.');
    expect(prompt).toContain("<task>\nscore these plans\n</task>");
    expect(prompt.indexOf("<instructions>")).toBeLessThan(prompt.indexOf("<task>"));
  });

  it("carries earlier turns so follow-up questions have context", () => {
    const prompt = renderCliPrompt(
      [
        { role: "system", content: "be brief" },
        { role: "user", content: "my name is Ada" },
        { role: "assistant", content: "Hi Ada" },
        { role: "user", content: "what is my name?" },
      ],
      10000,
    );

    expect(prompt).toContain("[user]\nmy name is Ada");
    expect(prompt).toContain("[assistant]\nHi Ada");
    expect(prompt).toContain("<task>\nwhat is my name?\n</task>");
  });

  it("delivers tool results after the task instead of resending the task alone", () => {
    const prompt = renderCliPrompt(
      [
        { role: "system", content: "tools available" },
        { role: "user", content: "read config" },
        { role: "assistant", content: '```tool:read\n{"path": "a.ts"}\n```' },
        { role: "tool", name: "read", content: "export const a = 1;" },
      ],
      10000,
    );

    expect(prompt).toContain("<progress>");
    expect(prompt).toContain("[tool result: read]\nexport const a = 1;");
    expect(prompt).toMatch(/Continue the task/);
    expect(prompt.indexOf("<task>")).toBeLessThan(prompt.indexOf("<progress>"));
  });

  it("drops the oldest history first when over budget", () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 40; i += 1) {
      history.push({ role: "user", content: `question ${i} ${"x".repeat(200)}` });
      history.push({ role: "assistant", content: `answer ${i} ${"y".repeat(200)}` });
    }
    const prompt = renderCliPrompt(
      [{ role: "system", content: "sys" }, ...history, { role: "user", content: "latest" }],
      4000,
    );

    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt).toContain("earlier messages omitted");
    expect(prompt).toContain("answer 39");
    expect(prompt).not.toContain("question 0 ");
    expect(prompt).toContain("<task>\nlatest\n</task>");
  });

  it("clips one oversized tool result instead of dropping it", () => {
    const prompt = renderCliPrompt(
      [
        { role: "user", content: "grep it" },
        { role: "tool", name: "grep", content: `${"a".repeat(9000)}TAIL` },
      ],
      3000,
    );

    expect(prompt.length).toBeLessThanOrEqual(3000);
    expect(prompt).toContain("TAIL");
    expect(prompt).toContain("[truncated]");
  });
});
