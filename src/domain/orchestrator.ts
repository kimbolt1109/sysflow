import {
  addCritique,
  emptyBlackboard,
  logDecision,
  pickLead,
  setPhase,
  setPlan,
  type Blackboard,
  type BoardPhase,
} from "@/domain/blackboard.js";
import type { OrchestrationMode } from "@/domain/models.js";

export interface PlanDraft {
  agent: string;
  plan: string;
}

export interface Review {
  approved: boolean;
  notes: string;
}

export type VerifyLens = "correctness" | "edge-cases" | "requirements" | "security" | "simplicity";

export const VERIFY_LENSES: VerifyLens[] = [
  "correctness",
  "edge-cases",
  "requirements",
  "security",
  "simplicity",
];

export interface VerifyVerdict {
  /** 0–100, benchmark style: percent of the lens rubric satisfied. */
  score: number;
  passed: boolean;
  notes: string;
  /** Evidence behind the score, e.g. "unit tests: 12/12 pass". */
  checks: string[];
  /** the grader replied without a usable score; excluded from the average */
  unscored?: boolean;
}

export interface VerifySummary extends VerifyVerdict {
  agent: string;
  lens: VerifyLens;
}

export interface ExecuteOutcome {
  summary: string;
  filesChanged: string[];
}

export interface Orchestrant {
  name: string;
  draft(task: string): Promise<string>;
  critique(
    task: string,
    drafts: PlanDraft[],
  ): Promise<Record<string, { score: number; note: string }>>;
  synthesize(task: string, drafts: PlanDraft[], notes: string[]): Promise<string>;
  execute(plan: string): Promise<ExecuteOutcome>;
  verify?(plan: string, outcome: ExecuteOutcome, lens: VerifyLens): Promise<VerifyVerdict>;
  review(plan: string, outcome: ExecuteOutcome): Promise<Review>;
  retro(): Promise<string>;
}

export interface CouncilEvent {
  phase: BoardPhase;
  agent?: string;
  message: string;
}

export interface CouncilOptions {
  preferredLead?: string;
  critiqueRounds?: number;
  checkpointEvery?: number;
  maxRejections?: number;
  active?: (name: string) => boolean;
  emit?: (event: CouncilEvent) => void;
}

export interface CouncilResult {
  board: Blackboard;
  lead: string;
  plan: string;
  outcome: ExecuteOutcome;
  verify: VerifySummary[];
  retros: Record<string, string>;
  phases: BoardPhase[];
  pausedForUser: boolean;
  pauseReason?: string;
}

export const VERIFY_MIN_AVG = 70;

function preview(text: string, max = 160): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max)}…`;
}

function previewScores(verdicts: Record<string, { score: number; note: string }>): string {
  const parts = Object.entries(verdicts).map(([target, v]) => `${target}=${v.score}`);
  return parts.length > 0 ? parts.join(" ") : "no scores";
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clampPercent(score: number): number {
  if (!Number.isFinite(score)) return 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface CouncilPlan {
  live: Orchestrant[];
  board: Blackboard;
  lead: string;
  plan: string;
  phases: BoardPhase[];
}

function isActive(opts: CouncilOptions, name: string): boolean {
  return opts.active === undefined || opts.active(name);
}

function trackEmits(
  opts: CouncilOptions,
  phases: BoardPhase[],
): (phase: BoardPhase, message: string, agent?: string) => void {
  return (phase, message, agent) => {
    phases.push(phase);
    opts.emit?.({ phase, message, agent });
  };
}

export async function planCouncil(
  agents: Orchestrant[],
  task: string,
  opts: CouncilOptions = {},
): Promise<CouncilPlan> {
  const active = agents.filter((a) => isActive(opts, a.name));
  if (active.length === 0) throw new Error("council needs at least one active agent");
  const board = emptyBlackboard(task);
  const phases: BoardPhase[] = [];
  const emit = trackEmits(opts, phases);

  setPhase(board, "PLANNING");
  emit("PLANNING", `fan-out to ${active.length} agents`);
  // One slow or broken agent (a CLI timeout, an exhausted quota) drops out; the rest carry on.
  const failures: string[] = [];
  await Promise.all(
    active.map(async (agent) => {
      try {
        const plan = await agent.draft(task);
        setPlan(board, agent.name, plan);
        emit("PLANNING", `drafted an approach: ${preview(plan)}`, agent.name);
      } catch (err) {
        failures.push(`${agent.name}: ${reason(err)}`);
        emit("PLANNING", `dropped out — draft failed: ${preview(reason(err))}`, agent.name);
      }
    }),
  );
  const live = active.filter((a) => board.plans[a.name] !== undefined);
  if (live.length === 0) throw new Error(`every agent failed to draft (${failures.join("; ")})`);

  const rounds = opts.critiqueRounds ?? 1;
  setPhase(board, "DEBATE");
  for (let round = 0; round < rounds; round += 1) {
    const drafts: PlanDraft[] = live.map((a) => ({
      agent: a.name,
      plan: board.plans[a.name] ?? "",
    }));
    await Promise.all(
      live.map(async (agent) => {
        let verdicts: Record<string, { score: number; note: string }>;
        try {
          verdicts = await agent.critique(
            task,
            drafts.filter((d) => d.agent !== agent.name),
          );
        } catch (err) {
          emit(
            "DEBATE",
            `skipped critique round ${round + 1}: ${preview(reason(err))}`,
            agent.name,
          );
          return;
        }
        for (const [target, verdict] of Object.entries(verdicts)) {
          if (board.plans[target] === undefined) continue;
          addCritique(board, target, agent.name, verdict.score, verdict.note);
        }
        emit("DEBATE", `critiqued round ${round + 1}: ${previewScores(verdicts)}`, agent.name);
      }),
    );
  }

  setPhase(board, "SYNTHESIS");
  const lead = pickLead(board, opts.preferredLead);
  const drafts: PlanDraft[] = live.map((a) => ({ agent: a.name, plan: board.plans[a.name] ?? "" }));
  const notes = Object.entries(board.critiques).flatMap(([target, list]) =>
    list.map((c) => `${c.by} on ${target} ${c.score}/10: ${c.note}`),
  );
  const leader = live.find((a) => a.name === lead);
  if (leader === undefined) throw new Error(`lead ${lead} went silent`);
  let plan: string;
  try {
    plan = await leader.synthesize(task, drafts, notes);
  } catch (err) {
    // The lead's own draft already won the debate; use it rather than lose the run.
    plan = board.plans[lead] ?? "";
    emit("SYNTHESIS", `merge failed, keeping its own draft: ${preview(reason(err))}`, lead);
  }
  logDecision(
    board,
    `lead=${lead}; alternatives=${
      drafts
        .filter((d) => d.agent !== lead)
        .map((d) => d.agent)
        .join(",") || "(none)"
    }`,
  );
  emit("SYNTHESIS", `merged final plan: ${preview(plan)}`, lead);
  return { live, board, lead, plan, phases };
}

export async function finishCouncil(
  staged: CouncilPlan,
  opts: CouncilOptions = {},
): Promise<CouncilResult> {
  const { live, board, lead, plan } = staged;
  const phases = staged.phases;
  const emit = trackEmits(opts, phases);
  if (live.length === 0) throw new Error("council needs at least one active agent");

  setPhase(board, "EXECUTION");
  emit("EXECUTION", "executing with tools", lead);
  const executor = live.find((a) => a.name === lead);
  if (executor === undefined) throw new Error(`lead ${lead} left the council`);
  let outcome: ExecuteOutcome;
  try {
    outcome = await executor.execute(plan);
  } catch (err) {
    throw new Error(
      `execution failed for ${lead}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  emit("EXECUTION", `finished: ${preview(outcome.summary)}`, lead);

  setPhase(board, "VERIFY");
  const verify: VerifySummary[] = [];
  await Promise.all(
    live.map(async (agent, index) => {
      if (agent.verify === undefined) return;
      const lens = VERIFY_LENSES[index % VERIFY_LENSES.length] as VerifyLens;
      let verdict: VerifyVerdict;
      try {
        verdict = await agent.verify(plan, outcome, lens);
      } catch (err) {
        emit("VERIFY", `could not grade (${lens}): ${preview(reason(err))}`, agent.name);
        return;
      }
      const checks = verdict.checks.filter((c) => typeof c === "string");
      if (verdict.unscored === true) {
        verify.push({
          agent: agent.name,
          lens,
          score: 0,
          passed: true,
          notes: verdict.notes,
          checks,
          unscored: true,
        });
        logDecision(board, `verify ${agent.name} (${lens}) unscored: ${verdict.notes}`);
        emit("VERIFY", `returned no score (${lens}): ${preview(verdict.notes)}`, agent.name);
        return;
      }
      const score = clampPercent(verdict.score);
      verify.push({
        agent: agent.name,
        lens,
        score,
        passed: verdict.passed,
        notes: verdict.notes,
        checks,
      });
      logDecision(board, `verify ${agent.name} (${lens}) ${score}%: ${verdict.notes}`);
      emit(
        "VERIFY",
        `scored ${score}% from the ${lens} perspective: ${preview(verdict.notes)}`,
        agent.name,
      );
    }),
  );
  verify.sort((a, b) => (a.agent < b.agent ? -1 : 1));
  const scored = verify.filter((v) => v.unscored !== true);
  if (scored.length === 0 && live.some((a) => a.verify !== undefined)) {
    emit("VERIFY", "inconclusive — no grader returned a score; reviewers decide");
  }
  if (scored.length > 0) {
    const avg = scored.reduce((sum, v) => sum + v.score, 0) / scored.length;
    const failed = scored.filter((v) => !v.passed);
    if (avg < VERIFY_MIN_AVG || failed.length > 0) {
      const reason =
        failed.length > 0
          ? `verification failed: ${failed.map((v) => `${v.agent} (${v.lens}): ${v.notes}`).join("; ")}`
          : `verification scored ${avg.toFixed(0)}% on average (needs ${VERIFY_MIN_AVG}%)`;
      return {
        board,
        lead,
        plan,
        outcome,
        verify,
        retros: {},
        phases,
        pausedForUser: true,
        pauseReason: reason,
      };
    }
  }

  setPhase(board, "REVIEW");
  const reviewers = live.filter((a) => a.name !== lead);
  const maxRejections = opts.maxRejections ?? 2;
  let rejections = 0;
  for (const reviewer of reviewers) {
    let verdict: Review;
    try {
      verdict = await reviewer.review(plan, outcome);
    } catch (err) {
      emit("REVIEW", `abstained — review failed: ${preview(reason(err))}`, reviewer.name);
      continue;
    }
    emit(
      "REVIEW",
      verdict.approved ? `approved: ${preview(verdict.notes)}` : `rejected: ${verdict.notes}`,
      reviewer.name,
    );
    if (!verdict.approved) {
      rejections += 1;
      logDecision(board, `rejection by ${reviewer.name}: ${verdict.notes}`);
      if (rejections >= maxRejections) {
        return {
          board,
          lead,
          plan,
          outcome,
          verify,
          retros: {},
          phases,
          pausedForUser: true,
          pauseReason: `paused: ${rejections} reviewers rejected — lead ${lead} awaits your call (/promote, /handoff, or new instructions)`,
        };
      }
    }
  }

  setPhase(board, "DONE");
  const retros: Record<string, string> = {};
  for (const agent of live) {
    try {
      retros[agent.name] = await agent.retro();
    } catch (err) {
      // Retros are best-effort: never discard a finished run over a summary.
      retros[agent.name] = `(no retro: ${err instanceof Error ? err.message : String(err)})`;
    }
    emit("DONE", `summarized its contribution: ${preview(retros[agent.name] ?? "")}`, agent.name);
  }
  return { board, lead, plan, outcome, verify, retros, phases, pausedForUser: false };
}

export async function runCouncil(
  agents: Orchestrant[],
  task: string,
  opts: CouncilOptions = {},
): Promise<CouncilResult> {
  const staged = await planCouncil(agents, task, opts);
  return finishCouncil(staged, opts);
}

export async function runRelay(
  agents: Orchestrant[],
  task: string,
  emit?: (event: CouncilEvent) => void,
): Promise<{ transcript: string[]; board: Blackboard }> {
  const board = emptyBlackboard(task);
  setPhase(board, "EXECUTION");
  const transcript: string[] = [`task: ${task}`];
  for (const agent of agents) {
    let turn: ExecuteOutcome;
    try {
      turn = await agent.execute(transcript.join("\n"));
    } catch (err) {
      throw new Error(
        `relay turn failed for ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    transcript.push(`[${agent.name}] ${turn.summary}`);
    emit?.({
      phase: "EXECUTION",
      agent: agent.name,
      message: `took its turn: ${preview(turn.summary)}`,
    });
  }
  setPhase(board, "DONE");
  return { transcript, board };
}

export interface Subtask {
  id: string;
  brief: string;
  files: string[];
}

export async function runWorkers(
  agents: Orchestrant[],
  task: string,
  subtasks: Subtask[],
  emit?: (event: CouncilEvent) => void,
): Promise<{ outcomes: Record<string, ExecuteOutcome>; board: Blackboard }> {
  const board = emptyBlackboard(task);
  setPhase(board, "EXECUTION");
  const outcomes: Record<string, ExecuteOutcome> = {};
  const busy = new Set<string>();
  const queue = [...subtasks];
  await Promise.all(
    agents.map(async (agent) => {
      for (;;) {
        const next = queue.findIndex(
          (s) => !busy.has(s.id) && s.files.every((f) => board.files[f]?.owner === undefined),
        );
        if (next === -1) return;
        const [subtask] = queue.splice(next, 1);
        if (subtask === undefined) return;
        busy.add(subtask.id);
        for (const file of subtask.files) {
          board.files[file] = { owner: agent.name, status: "editing" };
        }
        emit?.({ phase: "EXECUTION", agent: agent.name, message: `owns ${subtask.id}` });
        let outcome: ExecuteOutcome;
        try {
          outcome = await agent.execute(`${task}\nsubtask ${subtask.id}: ${subtask.brief}`);
        } catch (err) {
          throw new Error(
            `worker failed for ${agent.name} on ${subtask.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        outcomes[subtask.id] = outcome;
        emit?.({
          phase: "EXECUTION",
          agent: agent.name,
          message: `finished ${subtask.id}: ${preview(outcome.summary)}`,
        });
        for (const file of subtask.files) {
          if (board.files[file]?.owner === agent.name) delete board.files[file];
        }
      }
    }),
  );
  setPhase(board, "DONE");
  return { outcomes, board };
}

export function pickMode(
  taskLength: number,
  fileCount: number,
  agentCount: number,
): OrchestrationMode {
  if (agentCount <= 1) return "solo";
  if (taskLength > 800) return "council";
  if (fileCount >= agentCount && fileCount > 1) return "workers";
  return "relay";
}
