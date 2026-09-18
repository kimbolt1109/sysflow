import type { Driver } from "@/domain/drivers";
import type { ExecuteOutcome, Orchestrant, PlanDraft, Review } from "@/domain/orchestrator";
import { runToolLoop, TOOL_SYSTEM, type ToolCheck } from "@/infrastructure/agentLoop";
import type { LocalTools } from "@/infrastructure/localTools";

export class DriverAgent implements Orchestrant {
  constructor(
    readonly name: string,
    private readonly driver: Driver,
    private readonly tools: LocalTools,
    private readonly check: ToolCheck,
  ) {}

  private ask(system: string, user: string): Promise<string> {
    return this.driver
      .sendMessage([
        { role: "system", content: system },
        { role: "user", content: user },
      ])
      .then((r) => r.text);
  }

  draft(task: string): Promise<string> {
    return this.ask(
      `You are ${this.name}, a planning agent. Draft a concrete approach for the task. Planning only: do NOT write files and do NOT emit tool fences.`,
      task,
    );
  }

  async critique(
    task: string,
    drafts: PlanDraft[],
  ): Promise<Record<string, { score: number; note: string }>> {
    const reply = await this.ask(
      'Score each plan 1-10 with a one-line note. Reply ONLY as JSON like {"agent": {"score": 7, "note": "..."}}.',
      `task: ${task}\n${drafts.map((d) => `${d.agent}: ${d.plan}`).join("\n")}`,
    );
    const parsed = parseScores(reply);
    const out: Record<string, { score: number; note: string }> = {};
    for (const d of drafts) {
      const verdict = parsed[d.agent] ?? { score: 5, note: "no verdict" };
      out[d.agent] = { score: clampScore(verdict.score), note: verdict.note };
    }
    return out;
  }

  synthesize(task: string, drafts: PlanDraft[], notes: string[]): Promise<string> {
    return this.ask(
      "Merge the drafts into one final plan using the critiques. Reply with the plan only.",
      `task: ${task}\n${drafts.map((d) => `${d.agent}: ${d.plan}`).join("\n")}\ncritiques:\n${notes.join("\n")}`,
    );
  }

  async execute(plan: string): Promise<ExecuteOutcome> {
    const result = await runToolLoop(this.driver, this.tools, TOOL_SYSTEM, plan, {
      check: this.check,
    });
    return { summary: result.answer, filesChanged: result.filesChanged };
  }

  async review(plan: string, outcome: ExecuteOutcome): Promise<Review> {
    const reply = await this.ask(
      "Review the plan and outcome. Reply with APPROVE or REJECT: <notes>.",
      `plan: ${plan}\noutcome: ${outcome.summary}`,
    );
    if (/^\s*approve\b/i.test(reply)) return { approved: true, notes: reply.slice(0, 300) };
    return { approved: false, notes: reply.slice(0, 300) };
  }

  retro(): Promise<string> {
    return this.ask(
      "One paragraph: what did you contribute to this task?",
      "Summarize your contribution.",
    );
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function parseScores(reply: string): Record<string, { score: number; note: string }> {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as Record<
      string,
      { score?: unknown; note?: unknown }
    >;
    const out: Record<string, { score: number; note: string }> = {};
    for (const [agent, verdict] of Object.entries(parsed)) {
      out[agent] = {
        score: typeof verdict.score === "number" ? verdict.score : 5,
        note: typeof verdict.note === "string" ? verdict.note : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}
