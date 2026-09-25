import { describe, expect, it } from "vitest";
import { isCliSourced, matchRouting, routeFor } from "@/domain/routing.js";
import type { RoutingRule } from "@/domain/models.js";

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

  it("treats ? as a single-character wildcard like permissions", () => {
    const rules: RoutingRule[] = [{ match: "model-?", driver: "cli", command: "m" }];

    expect(matchRouting(rules, "model-a").command).toBe("m");
    expect(matchRouting(rules, "model-ab").command).toBe("opencode");
  });

  it("runs a CLI-listed model through the CLI that listed it", () => {
    const viaAgy = routeFor(RULES, "anthropic/claude-opus-4-6-thinking", "agy");

    expect(viaAgy.command).toBe("agy");
    expect(viaAgy.args).toEqual(["--dangerously-skip-permissions"]);
    expect(routeFor(RULES, "anthropic/claude-sonnet-4-5", "opencode").command).toBe("opencode");
  });

  it("routes registry and API-discovered models by pattern as before", () => {
    expect(routeFor(RULES, "anthropic/claude-sonnet", "registry").command).toBe("claude");
    expect(routeFor(RULES, "ollama/llama3", "ollama").command).toBe("opencode");
    expect(routeFor(RULES, "anthropic/claude-sonnet").command).toBe("claude");
  });

  it("synthesizes a route when the listing CLI has no rule", () => {
    expect(routeFor([], "google/gemini-3.8-flash-high", "agy")).toMatchObject({
      driver: "cli",
      command: "agy",
    });
    expect(isCliSourced("agy")).toBe(true);
    expect(isCliSourced("openrouter")).toBe(false);
  });
});
