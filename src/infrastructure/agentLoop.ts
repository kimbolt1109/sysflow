import type { Driver } from "@/domain/drivers";
import type { HookDecision } from "@/domain/hooks";
import { parseMcpToolName } from "@/domain/mcp";
import type { ChatMessage } from "@/domain/models";
import { parseToolCall, type ToolCall, type ToolsPort } from "@/domain/toolDefs";

export type ToolDecision = "allow" | "deny";

export type ToolCheck = (
  tool: string,
  input: Record<string, unknown>,
) => Promise<ToolDecision> | ToolDecision;

export interface LoopHooks {
  before(name: string, input: Record<string, unknown>): Promise<HookDecision>;
  after(name: string, input: Record<string, unknown>, output: string): Promise<void>;
}

export interface LoopCall {
  name: string;
  input: Record<string, unknown>;
}

const FENCE = /```tool:([A-Za-z0-9_]+)\s*\n([\s\S]*?)```/g;

export function parseToolFences(text: string): LoopCall[] {
  const calls: LoopCall[] = [];
  for (const match of text.matchAll(FENCE)) {
    const name = match[1] ?? "";
    let input: unknown;
    try {
      input = JSON.parse(match[2] ?? "{}") as unknown;
    } catch {
      continue;
    }
    if (typeof input !== "object" || input === null) continue;
    if (parseToolCall({ name, input }) === undefined && parseMcpToolName(name) === undefined) {
      continue;
    }
    calls.push({ name, input: input as Record<string, unknown> });
  }
  return calls;
}

export const TOOL_SYSTEM = [
  "You have file, shell, subagent, and MCP tools. To use one, emit a fenced block:",
  "```tool:write",
  '{"path": "a/b.ts", "content": "..."}',
  "```",
  "Tools: read {path} · write {path, content} · edit {path, oldString, newString} ·",
  "bash {command} · glob {pattern} · grep {pattern, include?} ·",
  "task {subagent_type, prompt} (spawn a subagent) · mcp__server__tool {arguments}.",
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
  tools: ToolsPort,
  system: string,
  task: string,
  opts: {
    maxTurns?: number;
    check?: ToolCheck;
    emit?: (text: string) => void;
    hooks?: LoopHooks;
    onTask?: (subagent: string, prompt: string) => Promise<string>;
    onMcpTool?: (namespaced: string, args: unknown) => Promise<string>;
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
      transcript.push({ role: "tool", name: call.name, content: await runLoopCall(call) });
    }
  }
  return { transcript, answer, filesChanged: [...filesChanged], turns };

  async function runLoopCall(call: LoopCall): Promise<string> {
    const hook = await opts.hooks?.before(call.name, call.input);
    if (hook?.decision === "block") return `hook blocked ${call.name}: ${hook.reason}`;
    const decision = await check(call.name, call.input);
    if (decision === "deny") return `denied by policy: ${call.name}`;
    let output: string;
    if (call.name === "task") {
      output = await runTaskCall(call.input);
    } else if (parseMcpToolName(call.name) !== undefined) {
      output = await runMcpCall(call.name, call.input);
    } else {
      const local = await runLocalTool(tools, call as ToolCall);
      if ((call.name === "write" || call.name === "edit") && local.ok) {
        const path = call.input.path;
        if (typeof path === "string") filesChanged.add(path);
      }
      output = local.output;
    }
    await opts.hooks?.after(call.name, call.input, output);
    return output.slice(0, 8000);
  }

  async function runTaskCall(input: Record<string, unknown>): Promise<string> {
    if (opts.onTask === undefined) return "task tool unavailable: no subagents configured";
    const subagent = input.subagent_type;
    const prompt = input.prompt;
    if (typeof subagent !== "string" || typeof prompt !== "string") {
      return "task needs {subagent_type: string, prompt: string}";
    }
    try {
      return await opts.onTask(subagent, prompt);
    } catch (err) {
      return `subagent failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function runMcpCall(name: string, input: Record<string, unknown>): Promise<string> {
    if (opts.onMcpTool === undefined) return `mcp unavailable: ${name} (no MCP servers configured)`;
    try {
      return await opts.onMcpTool(name, input);
    } catch (err) {
      return `mcp ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

async function runLocalTool(
  tools: ToolsPort,
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
    case "task":
      return { ok: false, output: "task is handled by the loop" };
  }
}
