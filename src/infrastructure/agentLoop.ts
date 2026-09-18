import type { Driver } from "@/domain/drivers";
import type { ChatMessage } from "@/domain/models";
import { parseToolCall, type ToolCall } from "@/domain/toolDefs";
import type { LocalTools } from "@/infrastructure/localTools";

export type ToolDecision = "allow" | "deny";

export type ToolCheck = (
  tool: string,
  input: Record<string, unknown>,
) => Promise<ToolDecision> | ToolDecision;

const FENCE = /```tool:([a-z]+)\s*\n([\s\S]*?)```/g;

export function parseToolFences(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of text.matchAll(FENCE)) {
    const name = match[1] ?? "";
    let input: unknown;
    try {
      input = JSON.parse(match[2] ?? "{}") as unknown;
    } catch {
      continue;
    }
    const parsed = parseToolCall({ name, input });
    if (parsed !== undefined) calls.push(parsed);
  }
  return calls;
}

export const TOOL_SYSTEM = [
  "You have file and shell tools. To use one, emit a fenced block:",
  "```tool:write",
  '{"path": "a/b.ts", "content": "..."}',
  "```",
  "Tools: read {path} · write {path, content} · edit {path, oldString, newString} ·",
  "bash {command} · glob {pattern} · grep {pattern, include?}.",
  "One call per fence; you may emit several. Text outside fences is your reply.",
].join("\n");

export interface LoopResult {
  transcript: ChatMessage[];
  answer: string;
  filesChanged: string[];
  turns: number;
}

export async function runToolLoop(
  driver: Driver,
  tools: LocalTools,
  system: string,
  task: string,
  opts: {
    maxTurns?: number;
    check?: ToolCheck;
    emit?: (text: string) => void;
  } = {},
): Promise<LoopResult> {
  const maxTurns = opts.maxTurns ?? 12;
  const check = opts.check ?? (() => "allow" as const);
  const transcript: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: task },
  ];
  const filesChanged = new Set<string>();
  let answer = "";
  let turns = 0;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    turns = turn + 1;
    let text = "";
    await driver.streamMessage(transcript, (token) => {
      text += token;
      opts.emit?.(token);
    });
    transcript.push({ role: "assistant", content: text });
    const calls = parseToolFences(text);
    if (calls.length === 0) {
      answer = text;
      break;
    }
    answer = text;
    for (const call of calls) {
      const decision = await check(call.name, call.input);
      if (decision === "deny") {
        transcript.push({
          role: "tool",
          name: call.name,
          content: `denied by policy: ${call.name}`,
        });
        continue;
      }
      const result = await runLocalTool(tools, call);
      if ((call.name === "write" || call.name === "edit") && result.ok) {
        const path = call.input.path;
        if (typeof path === "string") filesChanged.add(path);
      }
      transcript.push({ role: "tool", name: call.name, content: result.output.slice(0, 8000) });
    }
  }
  return { transcript, answer, filesChanged: [...filesChanged], turns };
}

async function runLocalTool(
  tools: LocalTools,
  call: ToolCall,
): Promise<{ ok: boolean; output: string }> {
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (call.name) {
    case "read":
      return tools.read(s(call.input.path));
    case "write":
      return tools.write(s(call.input.path), s(call.input.content));
    case "edit":
      return tools.edit(
        s(call.input.path),
        s(call.input.oldString),
        s(call.input.newString),
        call.input.replaceAll === true,
      );
    case "bash":
      return tools.bash(s(call.input.command));
    case "glob":
      return tools.glob(s(call.input.pattern));
    case "grep":
      return tools.grep(
        s(call.input.pattern),
        typeof call.input.include === "string" ? call.input.include : undefined,
      );
  }
}
