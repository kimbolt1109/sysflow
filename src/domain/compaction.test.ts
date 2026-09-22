import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/domain/models.js";
import { buildExtractiveSummary, compactHistory, elideToolOutputs } from "@/domain/compaction.js";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("compaction", () => {
  it("elides old tool outputs but keeps recent ones", () => {
    const messages: ChatMessage[] = [
      msg("user", "one"),
      { role: "tool", content: "old output here" },
      msg("user", "two"),
      { role: "tool", content: "new output here" },
    ];

    const elided = elideToolOutputs(messages, 1);

    expect(elided[1]?.content).toContain("elided");
    expect(elided[3]?.content).toBe("new output here");
  });

  it("preserves the original task and recent window in the summary", () => {
    const messages: ChatMessage[] = [msg("user", "fix the login bug"), msg("assistant", "looking")];
    const summary = buildExtractiveSummary(messages, 2);

    expect(summary).toContain("fix the login bug");
    expect(summary).toContain("looking");
  });

  it("leaves small transcripts alone", () => {
    const messages: ChatMessage[] = [msg("user", "hi")];

    const result = compactHistory(messages, 200000, 0.85);

    expect(result.compacted).toBe(false);
    expect(result.history).toHaveLength(1);
  });

  it("compacts at 85% keeping the summary plus recent window", () => {
    const messages: ChatMessage[] = [
      msg("user", "task: rewrite everything"),
      msg("assistant", "x".repeat(400)),
    ];

    const result = compactHistory(messages, 100, 0.85, 2, "keep auth details");

    expect(result.compacted).toBe(true);
    expect(result.history[0]?.role).toBe("system");
    expect(result.summary).toContain("task: rewrite everything");
    expect(result.summary).toContain("keep auth details");
    expect(result.history).toHaveLength(3);
  });
});
