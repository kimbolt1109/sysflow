export type ThinkingLevel = "low" | "medium" | "high" | "xhigh";

export const THINKING_LEVELS: ThinkingLevel[] = ["low", "medium", "high", "xhigh"];

export const THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
  low: "low — answer directly with minimal deliberation.",
  medium: "medium — balance thoroughness and speed.",
  high: "high — think carefully step by step; correctness over speed.",
  xhigh: "xhigh — deliberate exhaustively and verify each step before answering.",
};

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as string[]).includes(value);
}

export function thinkingDirective(level: ThinkingLevel): string {
  return `Reasoning effort: ${level}. ${THINKING_DESCRIPTIONS[level]}`;
}

export const RECENT_CAP = 8;

export function pushRecent(previous: string[], picked: string[]): string[] {
  const out = [...picked];
  for (const id of previous) {
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, RECENT_CAP);
}
