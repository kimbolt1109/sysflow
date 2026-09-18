import { describe, expect, it } from "vitest";
import { matchRouting } from "@/domain/routing";
import type { RoutingRule } from "@/domain/models";

const RULES: RoutingRule[] = [
  {
    match: "anthropic/*",
    driver: "cli",
    command: "claude",
    args: ["--dangerously-skip-permissions"],
  },
  {
    match: "openai/gpt-oss-*",
    driver: "cli",
    command: "agy",
    args: ["--dangerously-skip-permissions"],
  },
  { match: "openai/gpt-*", driver: "cli", command: "codex" },
  {
    match: "google/gemini-*",
    driver: "cli",
    command: "agy",
    args: ["--dangerously-skip-permissions"],
  },
  { match: "grok/*", driver: "cli", command: "grok", args: ["--always-approve"] },
  { match: "*", driver: "cli", command: "opencode" },
];

describe("routing", () => {
  it("routes anthropic models to claude", () => {
    expect(matchRouting(RULES, "anthropic/claude-sonnet").command).toBe("claude");
  });

  it("routes gpt models to codex", () => {
    expect(matchRouting(RULES, "openai/gpt-5").command).toBe("codex");
  });

  it("routes gemini models to the agy CLI with skip-permissions flags", () => {
    const rule = matchRouting(RULES, "google/gemini-pro");

    expect(rule.command).toBe("agy");
    expect(rule.args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("routes gpt-oss models to agy before the codex rule", () => {
    expect(matchRouting(RULES, "openai/gpt-oss-120b-medium").command).toBe("agy");
  });

  it("routes grok models to the grok CLI", () => {
    expect(matchRouting(RULES, "grok/grok-4.6").command).toBe("grok");
  });

  it("falls back to opencode for everything else", () => {
    expect(matchRouting(RULES, "ollama/llama3").command).toBe("opencode");
  });

  it("uses the built-in opencode fallback when no rule matches", () => {
    expect(matchRouting([], "any/model").command).toBe("opencode");
  });
});
