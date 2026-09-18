import { describe, expect, it } from "vitest";
import { badge, CouncilSession, phaseLine } from "@/api/council";
import type { ExecuteOutcome, Orchestrant, Review } from "@/domain/orchestrator";

class ScriptAgent implements Orchestrant {
  constructor(readonly name: string) {}

  async draft(): Promise<string> {
    return `${this.name}-plan`;
  }

  async critique(): Promise<Record<string, { score: number; note: string }>> {
    return {};
  }

  async synthesize(task: string): Promise<string> {
    return `plan for ${task}`;
  }

  async execute(plan: string): Promise<ExecuteOutcome> {
    return { summary: `${this.name} did ${plan.slice(0, 20)}`, filesChanged: [] };
  }

  async review(): Promise<Review> {
    return { approved: true, notes: "lgtm" };
  }

  async retro(): Promise<string> {
    return `${this.name} helped`;
  }
}

describe("council session", () => {
  it("renders badges and phase lines", () => {
    expect(badge("claude", 0)).toContain("[claude]");
    expect(phaseLine("DEBATE")).toContain("DEBATE");
  });

  it("handles interjection commands", () => {
    const session = new CouncilSession([new ScriptAgent("a"), new ScriptAgent("b")]);

    expect(session.interject("mute", "b")).toBe("muted b");
    expect(session.interject("mode", "relay")).toBe("mode=relay");
    expect(session.interject("round", "3")).toBe("rounds=3");
    expect(session.interject("round", "9")).toContain("1–5");
    expect(session.interject("promote", "a")).toBe("a is now lead");
    expect(session.interject("agents", "")).toContain("[a]");
  });

  it("runs solo execution for a single live agent", async () => {
    const records: unknown[] = [];
    const session = new CouncilSession([new ScriptAgent("a")], (r) => records.push(r));
    const lines: string[] = [];

    const result = await session.run("do it", (line) => lines.push(line));

    expect(result.text).toContain("a did");
    expect(lines.join("\n")).toContain("EXECUTION");
    expect(records.length).toBeGreaterThan(0);
  });

  it("runs council phases for two agents", async () => {
    const session = new CouncilSession([new ScriptAgent("a"), new ScriptAgent("b")]);
    const lines: string[] = [];

    const result = await session.run("ship it", (line) => lines.push(line));
    const shown = lines.join("\n");

    expect(shown).toContain("PLANNING");
    expect(shown).toContain("DEBATE");
    expect(shown).toContain("SYNTHESIS");
    expect(result.text).toContain("retro:");
  });
});
