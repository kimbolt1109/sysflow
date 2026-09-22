import type { ChatMessage } from "@/domain/models.js";

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function messageTokens(message: ChatMessage): number {
  return estimateTokens(message.content) + 4 + (message.images?.length ?? 0) * IMAGE_TOKENS;
}

/** rough per-image estimate (Anthropic-class vision pricing); documented, not exact. */
export const IMAGE_TOKENS = 1500;

export function transcriptTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

export interface ContextParts {
  system: string;
  tools: string;
  memory: string;
  skills: string;
  mcp: string;
  messages: ChatMessage[];
}

export interface ContextUsage {
  system: number;
  tools: number;
  memory: number;
  skills: number;
  mcp: number;
  messages: number;
  total: number;
  window: number;
  pct: number;
}

export function buildContextUsage(parts: ContextParts, window: number): ContextUsage {
  const system = estimateTokens(parts.system);
  const tools = estimateTokens(parts.tools);
  const memory = estimateTokens(parts.memory);
  const skills = estimateTokens(parts.skills);
  const mcp = estimateTokens(parts.mcp);
  const messages = transcriptTokens(parts.messages);
  const total = system + tools + memory + skills + mcp + messages;
  return {
    system,
    tools,
    memory,
    skills,
    mcp,
    messages,
    total,
    window,
    pct: window > 0 ? total / window : 0,
  };
}

export function shouldCompact(usage: ContextUsage, threshold: number): boolean {
  return usage.pct >= threshold;
}

function bar(pct: number, width = 16): string {
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export function renderContextBars(usage: ContextUsage): string {
  const rows: Array<[string, number]> = [
    ["system", usage.system],
    ["tools", usage.tools],
    ["memory", usage.memory],
    ["skills", usage.skills],
    ["mcp", usage.mcp],
    ["messages", usage.messages],
  ];
  const lines = rows.map(([name, tokens]) => {
    const share = usage.total > 0 ? tokens / usage.total : 0;
    return `${name.padEnd(8)} ${bar(share)} ${tokens}t`;
  });
  lines.push(`total ${usage.total}t / ${usage.window}t (${(usage.pct * 100).toFixed(1)}%)`);
  return lines.join("\n");
}
