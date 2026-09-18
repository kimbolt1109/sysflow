import { describe, expect, it } from "vitest";
import {
  pickMode,
  runCouncil,
  runRelay,
  runWorkers,
  type CouncilEvent,
  type ExecuteOutcome,
  type Orchestrant,
  type PlanDraft,
  type Review,
} from "@/domain/orchestrator";

class ScriptAgent implements Orchestrant {
  approve = true;
  constructor(
    readonly name: string,
    private readonly plan: string,
    private readonly scoreOthers: number,
  ) {}

  async draft(): Promise<string> {
    return this.plan;
  }

  async critique(
    _task: string,
    drafts: PlanDraft[],
  ): Promise<Record<string, { score: number; note: string }>> {
    const out: Record<string, { score: number; note: string }> = {};
    for (const d of drafts) out[d.agent] = { score: this.scoreOthers, note: "reviewed" };
    return out;
  }

  async synthesize(_task: string, drafts: PlanDraft[], _notes: string[]): Promise<string> {
    return `merged: ${drafts.map((d) => d.agent).join("+")}`;
  }

  async execute(plan: string): Promise<ExecuteOutcome> {
    return { summary: `did: ${plan.slice(0, 40)}`, filesChanged: [`${this.name}.ts`] };
  }

  async review(): Promise<Review> {
    return this.approve
      ? { approved: true, notes: "lgtm" }
      : { approved: false, notes: "needs work" };
  }

  async retro(): Promise<string> {
    return `${this.name} contributed`;
  }
}

describe("orchestrator", () => {
  it("runs fan-out, critique, synthesis, execution, and retro", async () => {
    const events: CouncilEvent[] = [];
    const agents = [new ScriptAgent("a", "plan A", 9), new ScriptAgent("b", "plan B", 6)];

    const result = await runCouncil(agents, "ship it", { emit: (e) => events.push(e) });

    expect(result.lead).toBe("b");
    expect(result.plan).toContain("merged");
    expect(result.outcome.filesChanged).toEqual(["b.ts"]);
    expect(result.retros).toEqual({ a: "a contributed", b: "b contributed" });
    expect(result.pausedForUser).toBe(false);
    const phases = events.map((e) => e.phase);
    for (const want of [
      "PLANNING",
      "DEBATE",
      "SYNTHESIS",
      "EXECUTION",
      "REVIEW",
      "DONE",
    ] as const) {
      expect(phases).toContain(want);
    }
  });

  it("pauses for the user after consecutive rejections", async () => {
    const a = new ScriptAgent("a", "A", 5);
    const b = new ScriptAgent("b", "B", 5);
    const c = new ScriptAgent("c", "C", 5);
    b.approve = false;
    c.approve = false;

    const result = await runCouncil([a, b, c], "task", { maxRejections: 2, preferredLead: "a" });

    expect(result.pausedForUser).toBe(true);
    expect(result.lead).toBe("a");
  });

  it("honors muted agents via the active filter", async () => {
    const agents = [new ScriptAgent("a", "A", 9), new ScriptAgent("b", "B", 1)];

    const result = await runCouncil(agents, "task", { active: (name) => name !== "b" });

    expect(result.lead).toBe("a");
    expect(result.board.plans.b).toBeUndefined();
  });

  it("relays agents across one shared transcript", async () => {
    const { transcript } = await runRelay(
      [new ScriptAgent("a", "A", 1), new ScriptAgent("b", "B", 1)],
      "build it",
    );

    expect(transcript).toHaveLength(3);
    expect(transcript[1]).toContain("[a]");
    expect(transcript[2]).toContain("[b]");
  });

  it("runs workers without overlapping file owners", async () => {
    const { outcomes, board } = await runWorkers(
      [new ScriptAgent("a", "A", 1), new ScriptAgent("b", "B", 1)],
      "task",
      [
        { id: "s1", brief: "one", files: ["a.ts"] },
        { id: "s2", brief: "two", files: ["b.ts"] },
      ],
    );

    expect(Object.keys(outcomes).sort()).toEqual(["s1", "s2"]);
    expect(board.files).toEqual({});
  });

  it("picks modes heuristically for auto", () => {
    expect(pickMode(10, 0, 1)).toBe("solo");
    expect(pickMode(2000, 1, 3)).toBe("council");
    expect(pickMode(100, 5, 2)).toBe("workers");
    expect(pickMode(100, 1, 2)).toBe("relay");
  });
});
