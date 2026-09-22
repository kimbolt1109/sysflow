export type BoardPhase =
  "PLANNING" | "DEBATE" | "SYNTHESIS" | "EXECUTION" | "VERIFY" | "REVIEW" | "DONE";

export interface Critique {
  by: string;
  score: number;
  note: string;
}

export interface FileEntry {
  owner: string;
  status: string;
}

export interface TodoEntry {
  id: string;
  text: string;
  state: "pending" | "active" | "done";
}

export interface Blackboard {
  task: string;
  constraints: string[];
  plans: Record<string, string>;
  critiques: Record<string, Critique[]>;
  decisionLog: string[];
  todos: TodoEntry[];
  files: Record<string, FileEntry>;
  phase: BoardPhase;
}

export function emptyBlackboard(task: string, constraints: string[] = []): Blackboard {
  return {
    task,
    constraints,
    plans: {},
    critiques: {},
    decisionLog: [],
    todos: [],
    files: {},
    phase: "PLANNING",
  };
}

export function setPlan(board: Blackboard, agent: string, plan: string): void {
  board.plans[agent] = plan;
}

export function addCritique(
  board: Blackboard,
  agent: string,
  by: string,
  score: number,
  note: string,
): void {
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw new Error(`critique score must be an integer 1–10, got ${score}`);
  }
  const list = board.critiques[agent] ?? [];
  list.push({ by, score, note });
  board.critiques[agent] = list;
}

export function averageScore(board: Blackboard, agent: string): number | undefined {
  const list = board.critiques[agent] ?? [];
  if (list.length === 0) return undefined;
  return list.reduce((sum, c) => sum + c.score, 0) / list.length;
}

export function pickLead(board: Blackboard, preferred?: string): string {
  const planners = Object.keys(board.plans);
  if (planners.length === 0) throw new Error("no plans drafted yet");
  if (preferred !== undefined && planners.includes(preferred)) return preferred;
  let best = planners[0] as string;
  let bestScore = -1;
  for (const agent of planners) {
    const score = averageScore(board, agent);
    if (score !== undefined && score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }
  return best;
}

export function acquireFile(board: Blackboard, path: string, agent: string): boolean {
  const held = board.files[path];
  if (held !== undefined && held.owner !== agent) return false;
  board.files[path] = { owner: agent, status: "editing" };
  return true;
}

export function releaseFile(board: Blackboard, path: string, agent: string): void {
  const held = board.files[path];
  if (held !== undefined && held.owner === agent) {
    delete board.files[path];
  }
}

export function logDecision(board: Blackboard, entry: string): void {
  board.decisionLog.push(entry);
}

export function setPhase(board: Blackboard, phase: BoardPhase): void {
  board.phase = phase;
}

export function summarizeBoard(board: Blackboard, budget = 2000): string {
  const lines = [
    `task: ${board.task}`,
    `phase: ${board.phase}`,
    `constraints: ${board.constraints.join("; ") || "(none)"}`,
  ];
  for (const [agent, plan] of Object.entries(board.plans)) {
    lines.push(`plan[${agent}]: ${plan.slice(0, 400)}`);
  }
  for (const [agent, critiques] of Object.entries(board.critiques)) {
    const avg = averageScore(board, agent);
    lines.push(`critiques[${agent}] avg=${avg === undefined ? "n/a" : avg.toFixed(1)}`);
    for (const c of critiques) lines.push(`  - ${c.by} ${c.score}/10: ${c.note.slice(0, 200)}`);
  }
  if (board.decisionLog.length > 0)
    lines.push(`decisions: ${board.decisionLog.join(" | ").slice(0, 500)}`);
  const files = Object.entries(board.files);
  if (files.length > 0)
    lines.push(`files: ${files.map(([p, f]) => `${p}(${f.owner})`).join(", ")}`);
  const text = lines.join("\n");
  return text.length > budget ? `${text.slice(0, budget)}\n…[board summarized]` : text;
}
