import {
  addCritique,
  emptyBlackboard,
  logDecision,
  pickLead,
  setPhase,
  setPlan,
  type Blackboard,
  type BoardPhase,
} from "@/domain/blackboard";
import type { OrchestrationMode } from "@/domain/models";

export interface PlanDraft {
  agent: string;
  plan: string;
}

export interface Review {
  approved: boolean;
  notes: string;
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
  retros: Record<string, string>;
  phases: BoardPhase[];
  pausedForUser: boolean;
}

function isActive(opts: CouncilOptions, name: string): boolean {
  return opts.active === undefined || opts.active(name);
}

export async function runCouncil(
  agents: Orchestrant[],
  task: string,
  opts: CouncilOptions = {},
): Promise<CouncilResult> {
  const live = agents.filter((a) => isActive(opts, a.name));
  if (live.length === 0) throw new Error("council needs at least one active agent");
  const board = emptyBlackboard(task);
  const phases: BoardPhase[] = [];
  const emit = (phase: BoardPhase, message: string, agent?: string): void => {
    phases.push(phase);
    opts.emit?.({ phase, message, agent });
  };

  setPhase(board, "PLANNING");
  emit("PLANNING", `fan-out to ${live.length} agents`);
  await Promise.all(
    live.map(async (agent) => {
      const plan = await agent.draft(task);
      setPlan(board, agent.name, plan);
      emit("PLANNING", "drafted an approach", agent.name);
    }),
  );

  const rounds = opts.critiqueRounds ?? 1;
  setPhase(board, "DEBATE");
  for (let round = 0; round < rounds; round += 1) {
    const drafts: PlanDraft[] = live.map((a) => ({
      agent: a.name,
      plan: board.plans[a.name] ?? "",
    }));
    await Promise.all(
      live.map(async (agent) => {
        const verdicts = await agent.critique(
          task,
          drafts.filter((d) => d.agent !== agent.name),
        );
        for (const [target, verdict] of Object.entries(verdicts)) {
          if (board.plans[target] === undefined) continue;
          addCritique(board, target, agent.name, verdict.score, verdict.note);
        }
        emit("DEBATE", `critiqued round ${round + 1}`, agent.name);
      }),
    );
  }

  setPhase(board, "SYNTHESIS");
  const lead = pickLead(board, opts.preferredLead);
  const drafts: PlanDraft[] = live.map((a) => ({ agent: a.name, plan: board.plans[a.name] ?? "" }));
  const notes = Object.entries(board.critiques).flatMap(([target, list]) =>
    list.map((c) => `${c.by} on ${target} ${c.score}/10: ${c.note}`),
  );
  const plan = await live.find((a) => a.name === lead)?.synthesize(task, drafts, notes);
  if (plan === undefined) throw new Error(`lead ${lead} went silent`);
  logDecision(
    board,
    `lead=${lead}; alternatives=${
      drafts
        .filter((d) => d.agent !== lead)
        .map((d) => d.agent)
        .join(",") || "(none)"
    }`,
  );
  emit("SYNTHESIS", "merged final plan", lead);

  setPhase(board, "EXECUTION");
  emit("EXECUTION", "executing with tools", lead);
  const executor = live.find((a) => a.name === lead);
  if (executor === undefined) throw new Error(`lead ${lead} left the council`);
  const outcome = await executor.execute(plan);

  setPhase(board, "REVIEW");
  const reviewers = live.filter((a) => a.name !== lead);
  const maxRejections = opts.maxRejections ?? 2;
  let rejections = 0;
  for (const reviewer of reviewers) {
    const verdict = await reviewer.review(plan, outcome);
    emit("REVIEW", verdict.approved ? "approved" : `rejected: ${verdict.notes}`, reviewer.name);
    if (!verdict.approved) {
      rejections += 1;
      logDecision(board, `rejection by ${reviewer.name}: ${verdict.notes}`);
      if (rejections >= maxRejections) {
        return { board, lead, plan, outcome, retros: {}, phases, pausedForUser: true };
      }
    }
  }

  setPhase(board, "DONE");
  const retros: Record<string, string> = {};
  for (const agent of live) {
    retros[agent.name] = await agent.retro();
    emit("DONE", "summarized its contribution", agent.name);
  }
  return { board, lead, plan, outcome, retros, phases, pausedForUser: false };
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
    const turn = await agent.execute(transcript.join("\n"));
    transcript.push(`[${agent.name}] ${turn.summary}`);
    emit?.({ phase: "EXECUTION", agent: agent.name, message: "took its turn" });
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
        const outcome = await agent.execute(`${task}\nsubtask ${subtask.id}: ${subtask.brief}`);
        outcomes[subtask.id] = outcome;
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
