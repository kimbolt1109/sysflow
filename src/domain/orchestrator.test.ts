import { describe, expect, it } from "vitest";
import {
  finishCouncil,
  pickMode,
  planCouncil,
  runCouncil,
  runRelay,
  runWorkers,
  type CouncilEvent,
  type ExecuteOutcome,
  type Orchestrant,
  type PlanDraft,
  type Review,
  type VerifyLens,
  type VerifyVerdict,
} from "@/domain/orchestrator.js";

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

  async verify(_plan: string, _outcome: ExecuteOutcome, lens: VerifyLens): Promise<VerifyVerdict> {
    return { score: 90, passed: true, notes: `${lens} looks good`, checks: ["spec read"] };
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

  it("splits planning from finishing", async () => {
    const agents = [new ScriptAgent("a", "plan-a", 9), new ScriptAgent("b", "plan-b", 9)];
    const events: CouncilEvent[] = [];

    const staged = await planCouncil(agents, "ship it", { emit: (e) => events.push(e) });

    expect(staged.lead).toBe("a");
    expect(staged.plan).toContain("merged: a+b");
    expect(events.some((e) => e.phase === "SYNTHESIS")).toBe(true);
    expect(events.some((e) => e.phase === "EXECUTION")).toBe(false);

    const result = await finishCouncil(staged, { emit: (e) => events.push(e) });

    expect(result.pausedForUser).toBe(false);
    expect(result.outcome.summary).toContain("did: merged");
    expect(result.verify).toHaveLength(2);
    expect(result.verify[0]).toMatchObject({ agent: "a", score: 90, passed: true });
    expect(events.some((e) => e.phase === "VERIFY")).toBe(true);
  });

  it("pauses when verification fails its benchmark", async () => {
    class FailingAgent extends ScriptAgent {
      override async verify(): Promise<VerifyVerdict> {
        return { score: 20, passed: false, notes: "broken", checks: [] };
      }
    }
    const agents = [new FailingAgent("a", "plan A", 9), new ScriptAgent("b", "plan B", 9)];

    const result = await runCouncil(agents, "ship it", {});

    expect(result.pausedForUser).toBe(true);
    expect(result.pauseReason).toContain("verification failed");
    expect(result.verify.some((v) => !v.passed)).toBe(true);
  });

  it("picks modes heuristically for auto", () => {
    expect(pickMode(10, 0, 1)).toBe("solo");
    expect(pickMode(2000, 1, 3)).toBe("council");
    expect(pickMode(100, 5, 2)).toBe("workers");
    expect(pickMode(100, 1, 2)).toBe("relay");
  });

  it("drops an agent whose draft fails and carries on without it", async () => {
    class FlakyAgent extends ScriptAgent {
      override async draft(): Promise<string> {
        throw new Error("agy timed out after 120s");
      }
    }
    const events: CouncilEvent[] = [];
    const agents = [new ScriptAgent("a", "plan A", 9), new FlakyAgent("flaky", "never", 5)];

    const staged = await planCouncil(agents, "task", { emit: (e) => events.push(e) });

    expect(staged.live.map((a) => a.name)).toEqual(["a"]);
    expect(staged.lead).toBe("a");
    const dropped = events.find((e) => e.agent === "flaky");
    expect(dropped?.message).toContain("dropped out");
    expect(dropped?.message).toContain("agy timed out");
  });

  it("fails only when every agent fails to draft, naming each", async () => {
    class FlakyAgent extends ScriptAgent {
      override async draft(): Promise<string> {
        throw new Error(`${this.name} timed out`);
      }
    }
    const agents = [new FlakyAgent("x", "", 5), new FlakyAgent("y", "", 5)];

    await expect(planCouncil(agents, "task")).rejects.toThrow(/every agent failed to draft.*x.*y/);
  });

  it("skips a failed critique without losing the run", async () => {
    class GrumpyAgent extends ScriptAgent {
      override async critique(): Promise<Record<string, { score: number; note: string }>> {
        throw new Error("boom");
      }
    }
    const events: CouncilEvent[] = [];
    const agents = [new ScriptAgent("a", "plan A", 9), new GrumpyAgent("grumpy", "plan G", 5)];

    const staged = await planCouncil(agents, "task", { emit: (e) => events.push(e) });

    expect(staged.plan).toContain("merged");
    expect(events.find((e) => e.agent === "grumpy" && e.phase === "DEBATE")?.message).toContain(
      "skipped critique round 1",
    );
  });

  it("keeps the lead's own draft when synthesis fails", async () => {
    class NoMergeAgent extends ScriptAgent {
      override async synthesize(): Promise<string> {
        throw new Error("timed out");
      }
    }
    const agents = [new NoMergeAgent("lead", "the lead plan", 9), new ScriptAgent("b", "B", 1)];

    const staged = await planCouncil(agents, "task", { preferredLead: "lead" });

    expect(staged.plan).toBe("the lead plan");
  });

  it("previews drafts and scores in emitted events", async () => {
    const events: CouncilEvent[] = [];
    const agents = [new ScriptAgent("a", "plan A in detail", 9), new ScriptAgent("b", "plan B", 6)];

    await planCouncil(agents, "ship it", { emit: (e) => events.push(e) });

    const drafts = events.filter((e) => e.phase === "PLANNING" && e.agent !== undefined);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.message).join(" ")).toContain("plan A in detail");
    const debates = events.filter((e) => e.phase === "DEBATE");
    expect(debates.map((d) => d.message).join(" ")).toMatch(/a=\d/);
    const synthesis = events.find((e) => e.phase === "SYNTHESIS");
    expect(synthesis?.message).toContain("merged");
  });

  it("names the lead when execution fails", async () => {
    class ExplodingAgent extends ScriptAgent {
      override async execute(): Promise<ExecuteOutcome> {
        throw new Error("agy timed out after 120s");
      }
    }
    const agents = [new ExplodingAgent("lead", "plan", 9), new ScriptAgent("b", "plan B", 1)];

    await expect(runCouncil(agents, "task", { preferredLead: "lead" })).rejects.toThrow(
      "execution failed for lead",
    );
  });

  it("skips a grader that errors and still finishes", async () => {
    class FlakyVerifyAgent extends ScriptAgent {
      override async verify(): Promise<VerifyVerdict> {
        throw new Error("boom");
      }
    }
    const events: CouncilEvent[] = [];
    const agents = [new FlakyVerifyAgent("v", "plan", 9), new ScriptAgent("b", "plan B", 9)];

    const result = await runCouncil(agents, "task", {
      preferredLead: "b",
      emit: (e) => events.push(e),
    });

    expect(result.pausedForUser).toBe(false);
    expect(result.verify.map((v) => v.agent)).toEqual(["b"]);
    expect(events.find((e) => e.agent === "v" && e.phase === "VERIFY")?.message).toContain(
      "could not grade",
    );
  });

  it("leaves unscored verdicts out of the average instead of counting them as 50%", async () => {
    class MumblingAgent extends ScriptAgent {
      override async verify(): Promise<VerifyVerdict> {
        return { score: 0, passed: true, notes: "no score returned", checks: [], unscored: true };
      }
    }
    const agents = [new MumblingAgent("m", "plan", 9), new ScriptAgent("b", "plan B", 9)];

    const result = await runCouncil(agents, "task", { preferredLead: "b" });

    expect(result.pausedForUser).toBe(false);
    expect(result.verify.find((v) => v.agent === "m")?.unscored).toBe(true);
  });

  it("hands an all-unscored verification to the reviewers", async () => {
    class MumblingAgent extends ScriptAgent {
      override async verify(): Promise<VerifyVerdict> {
        return { score: 0, passed: true, notes: "no score returned", checks: [], unscored: true };
      }
    }
    const events: CouncilEvent[] = [];
    const agents = [new MumblingAgent("a", "plan A", 9), new MumblingAgent("b", "plan B", 9)];

    const result = await runCouncil(agents, "task", { emit: (e) => events.push(e) });

    expect(result.pausedForUser).toBe(false);
    expect(events.some((e) => e.message.startsWith("inconclusive"))).toBe(true);
    expect(events.some((e) => e.phase === "REVIEW")).toBe(true);
  });

  it("treats a reviewer that errors as an abstention", async () => {
    class BrokenReviewer extends ScriptAgent {
      override async review(): Promise<Review> {
        throw new Error("timed out");
      }
    }
    const events: CouncilEvent[] = [];
    const agents = [new ScriptAgent("a", "plan A", 9), new BrokenReviewer("r", "plan R", 1)];

    const result = await runCouncil(agents, "task", {
      preferredLead: "a",
      emit: (e) => events.push(e),
    });

    expect(result.pausedForUser).toBe(false);
    expect(events.find((e) => e.agent === "r" && e.phase === "REVIEW")?.message).toContain(
      "abstained",
    );
  });

  it("keeps the finished run when a retro fails", async () => {
    class NoRetroAgent extends ScriptAgent {
      override async retro(): Promise<string> {
        throw new Error("tired");
      }
    }
    const agents = [new NoRetroAgent("a", "plan A", 9), new ScriptAgent("b", "plan B", 1)];

    const result = await runCouncil(agents, "task", { preferredLead: "a" });

    expect(result.pausedForUser).toBe(false);
    expect(result.retros.a).toContain("no retro");
  });

  it("names the agent when its relay turn fails", async () => {
    class ExplodingAgent extends ScriptAgent {
      override async execute(): Promise<ExecuteOutcome> {
        throw new Error("boom");
      }
    }

    await expect(
      runRelay([new ScriptAgent("a", "A", 1), new ExplodingAgent("bad", "B", 1)], "task"),
    ).rejects.toThrow("relay turn failed for bad");
  });

  it("names the agent and subtask when a worker fails", async () => {
    class ExplodingAgent extends ScriptAgent {
      override async execute(): Promise<ExecuteOutcome> {
        throw new Error("boom");
      }
    }

    await expect(
      runWorkers([new ExplodingAgent("w", "W", 1)], "task", [
        { id: "s1", brief: "one", files: [] },
      ]),
    ).rejects.toThrow("worker failed for w on s1");
  });

  it("previews execution, verification, and retro in emitted events", async () => {
    const events: CouncilEvent[] = [];
    const agents = [new ScriptAgent("a", "plan A", 9), new ScriptAgent("b", "plan B", 9)];

    await runCouncil(agents, "ship it", { emit: (e) => events.push(e) });

    expect(
      events.find((e) => e.phase === "EXECUTION" && e.message.startsWith("finished:")),
    ).toBeDefined();
    expect(events.find((e) => e.phase === "VERIFY")?.message).toMatch(/scored 90%/);
    expect(events.find((e) => e.phase === "DONE")?.message).toContain("contributed");
  });
});
