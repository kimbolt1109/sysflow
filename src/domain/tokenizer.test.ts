import { describe, expect, it } from "vitest";
import {
  buildContextUsage,
  estimateTokens,
  messageTokens,
  renderContextBars,
  shouldCompact,
  transcriptTokens,
} from "@/domain/tokenizer.js";

describe("tokenizer", () => {
  it("estimates chars/4 with a minimum of 1", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("")).toBe(1);
  });

  it("adds per-message overhead", () => {
    expect(messageTokens({ role: "user", content: "abcd" })).toBe(5);
    expect(transcriptTokens([])).toBe(0);
  });

  it("budgets tokens for attached images", () => {
    const plain = messageTokens({ role: "user", content: "abcd" });
    const withImages = messageTokens({ role: "user", content: "abcd", images: ["a.png", "b.png"] });

    expect(withImages - plain).toBe(3000);
  });

  it("builds a categorized usage with a percentage", () => {
    const usage = buildContextUsage(
      { system: "abcd", tools: "", memory: "", skills: "", mcp: "", messages: [] },
      100,
    );

    expect(usage.system).toBe(1);
    expect(usage.total).toBe(5);
    expect(usage.pct).toBeCloseTo(usage.total / 100);
  });

  it("fires compaction at the threshold", () => {
    const usage = buildContextUsage(
      { system: "", tools: "", memory: "", skills: "", mcp: "", messages: [] },
      10,
    );

    expect(shouldCompact(usage, 0.85)).toBe(usage.pct >= 0.85);
  });

  it("renders per-category bars", () => {
    const usage = buildContextUsage(
      {
        system: "abcd",
        tools: "",
        memory: "",
        skills: "",
        mcp: "",
        messages: [{ role: "user", content: "hello world, this is a longer message" }],
      },
      1000,
    );
    const rendered = renderContextBars(usage);

    expect(rendered).toContain("system");
    expect(rendered).toContain("messages");
    expect(rendered).toContain("total");
  });
});
