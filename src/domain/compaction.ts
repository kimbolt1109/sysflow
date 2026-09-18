import type { ChatMessage } from "@/domain/models";
import { buildContextUsage, estimateTokens, shouldCompact } from "@/domain/tokenizer";

export interface CompactResult {
  history: ChatMessage[];
  compacted: boolean;
  summary: string;
}

export function elideToolOutputs(messages: ChatMessage[], keepLastTurns: number): ChatMessage[] {
  let turnsSeen = 0;
  const out: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as ChatMessage;
    if (message.role === "user") turnsSeen += 1;
    if (message.role === "tool" && turnsSeen >= keepLastTurns) {
      out.unshift({
        role: "tool",
        name: message.name,
        content: `[elided ${estimateTokens(message.content)}t tool output]`,
      });
    } else {
      out.unshift(message);
    }
  }
  return out;
}

export function buildExtractiveSummary(messages: ChatMessage[], keepVerbatim: number): string {
  const firstUser = messages.find((m) => m.role === "user")?.content ?? "(no task)";
  const lastAssistant =
    [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "(no progress)";
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
  const kept = messages.slice(-keepVerbatim);
  return [
    "# Compacted context (extractive fallback — a live driver would summarize via the model)",
    "",
    "## Original task",
    firstUser.slice(0, 2000),
    "",
    "## Constraints",
    "(none recorded)",
    "",
    "## Current plan / last state",
    lastAssistant.slice(0, 2000),
    "",
    "## Todos",
    "(none recorded)",
    "",
    "## Decision log",
    "(none recorded)",
    "",
    `## Message counts: ${[...counts.entries()].map(([role, n]) => `${role}=${n}`).join(", ")}`,
    `## Kept verbatim: last ${kept.length} messages`,
  ].join("\n");
}

export function compactHistory(
  messages: ChatMessage[],
  window: number,
  threshold: number,
  keepVerbatim = 10,
  focus?: string,
): CompactResult {
  const elided = elideToolOutputs(messages, 5);
  const usage = buildContextUsage(
    { system: "", tools: "", memory: "", skills: "", mcp: "", messages: elided },
    window,
  );
  if (!shouldCompact(usage, threshold)) {
    return { history: elided, compacted: false, summary: "" };
  }
  let summary = buildExtractiveSummary(elided, keepVerbatim);
  if (focus !== undefined && focus !== "") {
    summary += `\n\n## Compact focus\n${focus.slice(0, 1000)}`;
  }
  const history: ChatMessage[] = [
    { role: "system", content: summary },
    ...elided.slice(-keepVerbatim),
  ];
  return { history, compacted: true, summary };
}
