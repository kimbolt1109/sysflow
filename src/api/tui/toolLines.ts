const TOOL_FENCE = /```tool:[A-Za-z0-9_]+\s*\n[\s\S]*?```/g;
const FAILED = /^(denied|hook blocked|exit \d|[a-z]+ failed|[a-z]+ timed out|[a-z]+ unavailable)/i;

/** Hides tool-call fences in a streamed reply: finished fences become their own tool
 * lines, and a fence still streaming is cut off instead of shown half-written. */
export function stripToolFences(text: string): string {
  let out = text.replace(TOOL_FENCE, "");
  const open = out.indexOf("```tool:");
  if (open >= 0) out = out.slice(0, open);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "read src/config.ts", "bash npm test", "mcp__github__search {q}". */
export function describeToolCall(name: string, input: Record<string, unknown>): string {
  const keys = ["path", "command", "pattern", "url", "name", "subagent_type", "question", "text"];
  const target = keys.map((k) => input[k]).find((v): v is string => typeof v === "string");
  if (target !== undefined && target.trim() !== "") return `${name} ${oneLine(target, 80)}`;
  const json = JSON.stringify(input);
  return json === "{}" ? name : `${name} ${oneLine(json, 80)}`;
}

/** The dim result note under a tool line: counts for listings, the first line otherwise. */
export function summarizeToolOutput(name: string, output: string): string {
  const lines = output.split(/\r?\n/).filter((l) => l.trim() !== "");
  const first = oneLine(lines[0] ?? "", 100);
  if (lines.length === 0) return name === "glob" || name === "grep" ? "no matches" : "done";
  if (FAILED.test(first)) return first;
  if (name === "read") return `${lines.length} line${lines.length === 1 ? "" : "s"}`;
  if (name === "glob" || name === "grep") {
    return `${lines.length} match${lines.length === 1 ? "" : "es"}`;
  }
  return lines.length > 1 ? `${first} (+${lines.length - 1} lines)` : first;
}

export function isFailedToolSummary(summary: string): boolean {
  return FAILED.test(summary);
}
