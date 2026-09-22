import type { Driver } from "@/domain/drivers.js";
import type { HookDecision } from "@/domain/hooks.js";
import type { DecisionQuestion } from "@/domain/decide.js";
import { parseDecisionQuestions } from "@/infrastructure/layaClient.js";
import { parseMcpToolName } from "@/domain/mcp.js";
import type { ChatMessage, TokenUsage } from "@/domain/models.js";
import {
  parseToolCall,
  type ToolCall,
  type ToolResult,
  type ToolsPort,
} from "@/domain/toolDefs.js";

export type ToolDecision = "allow" | "deny" | "ask";

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
  "You have file, shell, web, subagent, skill, and MCP tools. To use one, emit a fenced block:",
  "```tool:write",
  '{"path": "a/b.ts", "content": "..."}',
  "```",
  "Tools: read {path} · write {path, content} · edit {path, oldString, newString} ·",
  "bash {command} · glob {pattern} · grep {pattern, include?} · webfetch {url} (page as text) ·",
  "task {subagent_type, prompt} (spawn a subagent) · skill {name} (load a skill body first) ·",
  "question {question, options?} (ask the user when blocked on a choice) ·",
  "screenshot (see the screen) · click {x, y, button?} · type {text} · key {name} ·",
  "browse {url} (open the real browser) · mcp {} (list available MCP tools) ·",
  "mcp__server__tool {arguments}.",
  "Test web work with the real flow: start the app detached, browse its URL,",
  "screenshot to see it, then click/type through everything that matters.",
  "decide {questions, state?} (choice/score/yes-no judgments without an LLM call;",
  "set APP_LAYA_URL for a Laya decision server, else a local heuristic answers).",
  "One call per fence; you may emit several. Text outside fences is your reply.",
].join("\n");

export interface LoopResult {
  transcript: ChatMessage[];
  answer: string;
  filesChanged: string[];
  turns: number;
  usage: TokenUsage;
}

export async function runToolLoop(
  driver: Driver,
  tools: ToolsPort,
  system: string,
  task: string,
  opts: {
    maxTurns?: number;
    /** prior turns replayed between system and task (solo continuity) */
    seed?: ChatMessage[];
    check?: ToolCheck;
    emit?: (text: string) => void;
    hooks?: LoopHooks;
    onTask?: (subagent: string, prompt: string) => Promise<string>;
    onSkill?: (name: string) => Promise<string | undefined> | string | undefined;
    onQuestion?: (question: string, options: string[]) => Promise<string>;
    onWebfetch?: (url: string) => Promise<string>;
    onBrowse?: (url: string) => Promise<string>;
    onDecide?: (state: string, questions: Record<string, DecisionQuestion>) => Promise<string>;
    onListMcpTools?: () => Promise<string>;
    onMcpTool?: (namespaced: string, args: unknown) => Promise<string>;
  } = {},
): Promise<LoopResult> {
  const maxTurns = opts.maxTurns ?? 12;
  const check = opts.check ?? (() => "allow" as const);
  const transcript: ChatMessage[] = [
    { role: "system", content: system },
    ...(opts.seed ?? []),
    { role: "user", content: task },
  ];
  const filesChanged = new Set<string>();
  let answer = "";
  let turns = 0;
  const usage: TokenUsage = { input: 0, output: 0 };
  for (let turn = 0; turn < maxTurns; turn += 1) {
    turns = turn + 1;
    let text = "";
    const streamed = await driver.streamMessage(transcript, (token) => {
      text += token;
      opts.emit?.(token);
    });
    usage.input += streamed.usage.input;
    usage.output += streamed.usage.output;
    transcript.push({ role: "assistant", content: text });
    const calls = parseToolFences(text);
    if (calls.length === 0) {
      answer = text;
      break;
    }
    answer = text;
    for (const call of calls) {
      const out = await runLoopCall(call);
      transcript.push({
        role: "tool",
        name: call.name,
        content: out.text,
        ...(out.images !== undefined ? { images: out.images } : {}),
      });
    }
  }
  return { transcript, answer, filesChanged: [...filesChanged], turns, usage };

  async function runLoopCall(call: LoopCall): Promise<{ text: string; images?: string[] }> {
    const hook = await opts.hooks?.before(call.name, call.input);
    if (hook?.decision === "block") return { text: `hook blocked ${call.name}: ${hook.reason}` };
    const decision = await check(call.name, call.input);
    if (decision === "deny") return { text: `denied by policy: ${call.name}` };
    if (decision === "ask") {
      if (opts.onQuestion === undefined) {
        return { text: `denied by policy: ${call.name} (needs approval; non-interactive)` };
      }
      const summary = JSON.stringify(call.input).slice(0, 200);
      const answer = await opts.onQuestion(`Allow ${call.name} ${summary}?`, [
        "allow once",
        "deny",
      ]);
      if (!/^\s*(allow|1|y|yes)\b/i.test(answer)) {
        return { text: `denied by policy: ${call.name}` };
      }
    }
    let output: string;
    let images: string[] | undefined;
    if (call.name === "task") {
      output = await runTaskCall(call.input);
    } else if (call.name === "skill") {
      output = await runSkillCall(call.input);
    } else if (call.name === "question") {
      output = await runQuestionCall(call.input);
    } else if (call.name === "webfetch") {
      output = await runWebfetchCall(call.input);
    } else if (call.name === "browse") {
      output = await runBrowseCall(call.input);
    } else if (call.name === "decide") {
      output = await runDecideCall(call.input);
    } else if (call.name === "mcp") {
      output = await runMcpListCall();
    } else if (parseMcpToolName(call.name) !== undefined) {
      output = await runMcpCall(call.name, call.input);
    } else {
      const local = await runLocalTool(tools, call as ToolCall);
      if ((call.name === "write" || call.name === "edit") && local.ok) {
        const path = call.input.path;
        if (typeof path === "string") filesChanged.add(path);
      }
      output = local.output;
      images = local.images;
    }
    await opts.hooks?.after(call.name, call.input, output);
    return { text: output.slice(0, 8000), images };
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

  async function runSkillCall(input: Record<string, unknown>): Promise<string> {
    const name = input.name;
    if (typeof name !== "string" || name === "") return "skill needs {name: string}";
    if (opts.onSkill === undefined) return `skill unavailable: ${name} (no skills configured)`;
    const body = await opts.onSkill(name);
    return body ?? `unknown skill "${name}"`;
  }

  async function runWebfetchCall(input: Record<string, unknown>): Promise<string> {
    const url = input.url;
    if (typeof url !== "string" || url.trim() === "") return "webfetch needs {url: string}";
    if (opts.onWebfetch === undefined)
      return `webfetch unavailable: ${url} (no fetcher configured)`;
    try {
      return await opts.onWebfetch(url);
    } catch (err) {
      return `webfetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function runBrowseCall(input: Record<string, unknown>): Promise<string> {
    const url = input.url;
    if (typeof url !== "string" || url.trim() === "") return "browse needs {url: string}";
    if (opts.onBrowse === undefined) return `browse unavailable: ${url} (no browser configured)`;
    try {
      return await opts.onBrowse(url);
    } catch (err) {
      return `browse failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function runDecideCall(input: Record<string, unknown>): Promise<string> {
    const parsed = parseDecisionQuestions(input.questions);
    if (typeof parsed === "string") return parsed;
    if (opts.onDecide === undefined) return "decide unavailable (no decision backend configured)";
    const state = typeof input.state === "string" ? input.state : "";
    try {
      return await opts.onDecide(state, parsed);
    } catch (err) {
      return `decide failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function runMcpListCall(): Promise<string> {
    if (opts.onListMcpTools === undefined) {
      return "mcp unavailable (no MCP servers configured)";
    }
    try {
      return await opts.onListMcpTools();
    } catch (err) {
      return `mcp inventory failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function runQuestionCall(input: Record<string, unknown>): Promise<string> {
    const question = input.question;
    if (typeof question !== "string" || question === "") {
      return "question needs {question: string, options?: string[]}";
    }
    const options = Array.isArray(input.options)
      ? input.options.filter((o): o is string => typeof o === "string")
      : [];
    if (opts.onQuestion === undefined) return "question unavailable (non-interactive session)";
    try {
      const answer = await opts.onQuestion(question, options);
      return `user answered: ${answer}`;
    } catch (err) {
      return `question failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

async function runLocalTool(tools: ToolsPort, call: ToolCall): Promise<ToolResult> {
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
    case "screenshot":
      return tools.screenshot();
    case "click": {
      const x = Number(call.input.x);
      const y = Number(call.input.y);
      const button = typeof call.input.button === "string" ? call.input.button : "left";
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, output: "click needs {x, y} numbers" };
      }
      return tools.click(x, y, button);
    }
    case "type":
      return tools.type(s(call.input.text));
    case "key":
      return tools.key(s(call.input.name));
    case "glob":
      return tools.glob(s(call.input.pattern));
    case "grep":
      return tools.grep(
        s(call.input.pattern),
        typeof call.input.include === "string" ? call.input.include : undefined,
      );
    case "task":
    case "skill":
    case "question":
    case "webfetch":
    case "mcp":
    case "browse":
    case "decide":
      return { ok: false, output: `${call.name} is handled by the loop` };
  }
}
