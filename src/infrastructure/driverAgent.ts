import type { Driver } from "@/domain/drivers.js";
import type { McpPort } from "@/domain/mcp.js";
import { formatMcpInventory } from "@/domain/mcp.js";
import type {
  ExecuteOutcome,
  Orchestrant,
  PlanDraft,
  Review,
  VerifyLens,
  VerifyVerdict,
} from "@/domain/orchestrator.js";
import type { SubagentDef } from "@/domain/subagents.js";
import type { ToolsPort } from "@/domain/toolDefs.js";
import { fetchPageText } from "@/lib/webfetch.js";
import { openBrowser } from "@/lib/browser.js";
import { answerQuestions } from "@/infrastructure/layaClient.js";
import { formatDecisions, type DecisionQuestion } from "@/domain/decide.js";
import {
  runToolLoop,
  TOOL_SYSTEM,
  type LoopHooks,
  type ToolCheck,
} from "@/infrastructure/agentLoop.js";

export interface AgentExtras {
  contextPrefix?: string;
  subagents?: SubagentDef[];
  skillBody?: (name: string) => string | undefined;
  onQuestion?: (question: string, options: string[]) => Promise<string>;
  mcp?: McpPort;
  depth?: number;
  hooks?: LoopHooks;
  fetchFn?: typeof fetch;
  openPage?: (url: string) => Promise<string>;
  layaUrl?: string;
}

const MAX_SUBAGENT_DEPTH = 1;

/** Read-only gate for planning and grading loops: observe freely, change nothing.
 * The `mcp` discovery, `browse`, and `screenshot` fences stay allowed so graders
 * can test the real flow; mutating calls (write/edit/bash/click/type/…) stay denied. */
export const readOnlyCheck: ToolCheck = (tool) =>
  tool === "read" ||
  tool === "glob" ||
  tool === "grep" ||
  tool === "mcp" ||
  tool === "browse" ||
  tool === "screenshot"
    ? "allow"
    : "deny";

export class DriverAgent implements Orchestrant {
  private readonly contextPrefix: string;
  private readonly subagents: SubagentDef[];
  private readonly skillBody?: (name: string) => string | undefined;
  private readonly onQuestion?: (question: string, options: string[]) => Promise<string>;
  private readonly mcp?: McpPort;
  private readonly depth: number;
  private readonly hooks?: LoopHooks;
  private readonly fetchFn: typeof fetch;
  private readonly openPage: (url: string) => Promise<string>;
  private readonly layaUrl?: string;

  constructor(
    readonly name: string,
    private readonly driver: Driver,
    private readonly tools: ToolsPort,
    private readonly check: ToolCheck,
    extras: AgentExtras = {},
  ) {
    this.contextPrefix = extras.contextPrefix ?? "";
    this.subagents = extras.subagents ?? [];
    this.skillBody = extras.skillBody;
    this.onQuestion = extras.onQuestion;
    this.mcp = extras.mcp;
    this.depth = extras.depth ?? 0;
    this.hooks = extras.hooks;
    this.fetchFn = extras.fetchFn ?? fetch;
    this.openPage = extras.openPage ?? ((url) => openBrowser(url));
    this.layaUrl = extras.layaUrl;
  }

  private ask(system: string, user: string): Promise<string> {
    const full = this.contextPrefix === "" ? system : `${this.contextPrefix}\n\n${system}`;
    return this.driver
      .sendMessage([
        { role: "system", content: full },
        { role: "user", content: user },
      ])
      .then((r) => r.text);
  }

  async draft(task: string): Promise<string> {
    // Planners explore read-only first: blind drafts miss constraints.
    const result = await runToolLoop(
      this.driver,
      this.tools,
      `You are ${this.name}, a planning agent. Explore with read-only tools (read, glob, grep, webfetch, skill) as needed, then draft a concrete approach for the task. Planning only: do NOT write files, run shell commands, or change anything. Your final message is the plan, with no tool fences.`,
      task,
      {
        check: readOnlyCheck,
        hooks: this.hooks,
        onSkill: (name) => this.skillBody?.(name),
        onQuestion: this.onQuestion,
        onWebfetch: (url) => fetchPageText(url, this.fetchFn),
        onBrowse: (url) => this.openPage(url),
        onDecide: (state, questions) => this.decideQuestions(state, questions),
        onListMcpTools: () => this.listMcpTools(),
        maxTurns: 6,
      },
    );
    return result.answer;
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
      hooks: this.hooks,
      onTask: (subagent, prompt) => this.spawnSubagent(subagent, prompt),
      onSkill: (name) => this.skillBody?.(name),
      onQuestion: this.onQuestion,
      onWebfetch: (url) => fetchPageText(url, this.fetchFn),
      onBrowse: (url) => this.openPage(url),
      onDecide: (state, questions) => this.decideQuestions(state, questions),
      onMcpTool: (name, args) => this.callMcp(name, args),
      onListMcpTools: () => this.listMcpTools(),
    });
    return { summary: result.answer, filesChanged: result.filesChanged };
  }

  private async spawnSubagent(name: string, prompt: string): Promise<string> {
    if (this.depth >= MAX_SUBAGENT_DEPTH) {
      return "subagent depth exceeded: handle this part yourself";
    }
    const def = this.subagents.find((s) => s.name === name);
    if (def === undefined) {
      return `unknown subagent "${name}" (available: ${this.subagents.map((s) => s.name).join(", ") || "none"})`;
    }
    const allowed = def.tools.map((t) => t.toLowerCase());
    const filtered: ToolCheck = (tool, input) => {
      if (allowed.length > 0 && !allowed.includes(tool)) return "deny";
      return this.check(tool, input);
    };
    const system = def.prompt === "" ? "You are a subagent. Complete the task." : def.prompt;
    const result = await runToolLoop(
      this.driver,
      this.tools,
      `${system}\n\n${TOOL_SYSTEM}`,
      prompt,
      {
        check: filtered,
        hooks: this.hooks,
        onSkill: (name) => this.skillBody?.(name),
        onQuestion: this.onQuestion,
        onWebfetch: (url) => fetchPageText(url, this.fetchFn),
        onBrowse: (url) => this.openPage(url),
        onDecide: (state, questions) => this.decideQuestions(state, questions),
        onMcpTool: (name, args) => this.callMcp(name, args),
        onListMcpTools: () => this.listMcpTools(),
        maxTurns: 8,
      },
    );
    return result.answer;
  }

  private async callMcp(name: string, args: unknown): Promise<string> {
    if (this.mcp === undefined) return `mcp unavailable: ${name} (no MCP servers configured)`;
    return this.mcp.call(name, args);
  }

  private async decideQuestions(
    state: string,
    questions: Record<string, DecisionQuestion>,
  ): Promise<string> {
    const { answers } = await answerQuestions(this.layaUrl, state, questions);
    return formatDecisions(answers);
  }

  private async listMcpTools(): Promise<string> {
    if (this.mcp === undefined) return "mcp unavailable (no MCP servers configured)";
    try {
      return formatMcpInventory(await this.mcp.toolInventory());
    } catch (err) {
      return `mcp inventory failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async review(plan: string, outcome: ExecuteOutcome): Promise<Review> {
    // Reviewers inspect the work, not just the summary: hunt for gaps.
    const result = await runToolLoop(
      this.driver,
      this.tools,
      "Review the plan and outcome. Inspect the code with read-only tools (read, glob, grep, webfetch, mcp) and hunt for what is missing: failing tests, absent docs, unhandled errors, uncovered edge cases. Reply with APPROVE or REJECT: <notes>.",
      `plan: ${plan}\noutcome: ${outcome.summary}`,
      {
        check: readOnlyCheck,
        hooks: this.hooks,
        onSkill: (name) => this.skillBody?.(name),
        onQuestion: this.onQuestion,
        onWebfetch: (url) => fetchPageText(url, this.fetchFn),
        onBrowse: (url) => this.openPage(url),
        onDecide: (state, questions) => this.decideQuestions(state, questions),
        onListMcpTools: () => this.listMcpTools(),
        maxTurns: 4,
      },
    );
    const reply = result.answer;
    if (/^\s*approve\b/i.test(reply)) return { approved: true, notes: reply.slice(0, 300) };
    return { approved: false, notes: reply.slice(0, 300) };
  }

  async verify(plan: string, outcome: ExecuteOutcome, lens: VerifyLens): Promise<VerifyVerdict> {
    // Graders verify against reality: read the code before scoring.
    const result = await runToolLoop(
      this.driver,
      this.tools,
      `Judge this outcome like a benchmark grader from the ${lens} perspective: ${lensGuidance(lens)} Inspect the code with read-only tools (read, glob, grep, webfetch, mcp) as needed, then score 0–100 (percent of the rubric satisfied) and cite concrete checks you performed. Your final message is ONLY JSON like {"score": 82, "passed": true, "notes": "...", "checks": ["..."]}.`,
      `plan: ${plan}\noutcome: ${outcome.summary}`,
      {
        check: readOnlyCheck,
        hooks: this.hooks,
        onSkill: (name) => this.skillBody?.(name),
        onQuestion: this.onQuestion,
        onWebfetch: (url) => fetchPageText(url, this.fetchFn),
        onBrowse: (url) => this.openPage(url),
        onDecide: (state, questions) => this.decideQuestions(state, questions),
        onListMcpTools: () => this.listMcpTools(),
        maxTurns: 4,
      },
    );
    return parseVerifyVerdict(result.answer);
  }

  retro(): Promise<string> {
    return this.ask(
      "Two short paragraphs: what worked, and what failed plus what future runs should do differently?",
      "Summarize lessons for the next run.",
    );
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function lensGuidance(lens: VerifyLens): string {
  switch (lens) {
    case "correctness":
      return "Does the outcome actually solve the task? Check each claim against the plan.";
    case "edge-cases":
      return "Probe edge cases and failure modes. What input or state breaks it?";
    case "requirements":
      return "Is every requirement and constraint from the task met? List gaps.";
    case "security":
      return "Flag unsafe, destructive, or policy-violating aspects of the outcome.";
    case "simplicity":
      return "Is it over-engineered? Could it be simpler without losing correctness?";
  }
}

export function parseVerifyVerdict(reply: string): VerifyVerdict {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  const fallback: VerifyVerdict = { score: 50, passed: true, notes: "", checks: [] };
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as {
      score?: unknown;
      passed?: unknown;
      notes?: unknown;
      checks?: unknown;
    };
    return {
      score: typeof parsed.score === "number" ? parsed.score : 50,
      passed: typeof parsed.passed === "boolean" ? parsed.passed : true,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : "",
      checks: Array.isArray(parsed.checks)
        ? parsed.checks.filter((c): c is string => typeof c === "string").slice(0, 10)
        : [],
    };
  } catch {
    return fallback;
  }
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
