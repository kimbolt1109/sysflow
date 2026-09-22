import { describe, expect, it } from "vitest";
import { badge, CouncilSession, phaseLine } from "@/api/council.js";
import type {
  ExecuteOutcome,
  Orchestrant,
  Review,
  VerifyLens,
  VerifyVerdict,
} from "@/domain/orchestrator.js";

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

  async verify(_plan: string, _outcome: ExecuteOutcome, lens: VerifyLens): Promise<VerifyVerdict> {
    return { score: 85, passed: true, notes: `${lens} ok`, checks: ["plan read"] };
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
    expect(result.text).toContain("## plan");
    expect(result.text).toContain("plan for ship it");
    expect(result.text).toContain("## verification");
    expect(result.text).toContain("85%");
    expect(result.text).toContain("retro:");
  });

  it("persists verify verdicts and retros to council-end records", async () => {
    const records: unknown[] = [];
    const session = new CouncilSession([new ScriptAgent("a"), new ScriptAgent("b")], (r) =>
      records.push(r),
    );

    await session.run("ship it", () => {});

    const end = records.find(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && (r as { type?: unknown }).type === "council-end",
    ) as
      | {
          verify: Array<{ agent: string; score: number; passed: boolean }>;
          retros: Record<string, string>;
        }
      | undefined;
    expect(end).toBeDefined();
    expect(end?.verify.length).toBeGreaterThan(0);
    expect(end?.verify.every((v) => v.passed)).toBe(true);
    expect(end?.retros).toEqual({ a: "a helped", b: "b helped" });
  });

  it("pauses for approval in plan mode and resumes on approve", async () => {
    const session = new CouncilSession([new ScriptAgent("a"), new ScriptAgent("b")]);
    session.planMode = true;
    const lines: string[] = [];

    const planned = await session.run("ship it", (line) => lines.push(line));

    expect(planned.text).toContain("awaiting approval");
    expect(planned.text).toContain("plan for ship it");
    expect(planned.text).not.toContain("## result");

    const approved = await session.approve((line) => lines.push(line));

    expect(approved?.text).toContain("## result");
    expect(approved?.text).toContain("retro:");
    expect(await session.approve(() => {})).toBeUndefined();
  });

  it("discards pending plans on fresh tasks and toggles plan mode", async () => {
    const session = new CouncilSession([new ScriptAgent("a"), new ScriptAgent("b")]);
    session.planMode = true;

    await session.run("first", () => {});
    expect(session.pendingPlan).not.toBeUndefined();
    expect(session.interject("plan", "")).toContain("plan-mode off");
    expect(session.pendingPlan).toBeUndefined();

    expect(session.interject("plan", "on")).toContain("plan-mode on");
    expect(session.interject("plan", "bogus")).toContain("usage");
    await session.run("second", () => {});
    expect(session.pendingPlan?.task).toBe("second");
    await session.run("third", () => {});
    expect(session.pendingPlan?.task).toBe("third");
  });
});
