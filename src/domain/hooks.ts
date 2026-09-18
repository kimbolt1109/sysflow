export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact"
  | "Notification"
  | "Stop"
  | "AgentStop"
  | "AgentMessage"
  | "AgentHandoff";

export const HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "Notification",
  "Stop",
  "AgentStop",
  "AgentMessage",
  "AgentHandoff",
];

export interface HookDef {
  event: HookEvent;
  command: string;
  timeoutMs: number;
}

export type HookDecision = { decision: "proceed" } | { decision: "block"; reason: string };

export function parseHookDecision(stdout: string, exitCode: number, stderr: string): HookDecision {
  if (exitCode === 2) {
    return { decision: "block", reason: stderr.trim() === "" ? "blocked by hook" : stderr.trim() };
  }
  if (exitCode !== 0) {
    return { decision: "block", reason: `hook failed with exit ${exitCode}: ${stderr.trim()}` };
  }
  const trimmed = stdout.trim();
  if (trimmed === "") return { decision: "proceed" };
  try {
    const parsed = JSON.parse(trimmed) as { decision?: unknown; reason?: unknown };
    if (parsed.decision === "block") {
      return {
        decision: "block",
        reason: typeof parsed.reason === "string" ? parsed.reason : "blocked by hook",
      };
    }
    return { decision: "proceed" };
  } catch {
    return { decision: "proceed" };
  }
}

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as string[]).includes(value);
}

export interface HooksPort {
  readonly size: number;
  fire(event: HookEvent, payload: Record<string, unknown>): Promise<HookDecision>;
}
