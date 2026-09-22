export type ToolName =
  | "read"
  | "write"
  | "edit"
  | "bash"
  | "glob"
  | "grep"
  | "task"
  | "skill"
  | "question"
  | "webfetch"
  | "mcp"
  | "browse"
  | "screenshot"
  | "click"
  | "type"
  | "key";

export interface ToolResult {
  ok: boolean;
  output: string;
  images?: string[];
}

export interface ToolsPort {
  readonly rootDir: string;
  chdir(path: string): void;
  read(path: string): Promise<ToolResult>;
  write(path: string, content: string): Promise<ToolResult>;
  remove(path: string): Promise<ToolResult>;
  edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<ToolResult>;
  bash(command: string, timeoutMs?: number): Promise<ToolResult>;
  glob(pattern: string): Promise<ToolResult>;
  grep(pattern: string, include?: string): Promise<ToolResult>;
  screenshot(): Promise<ToolResult>;
  click(x: number, y: number, button?: string): Promise<ToolResult>;
  type(text: string): Promise<ToolResult>;
  key(name: string): Promise<ToolResult>;
}

export interface ToolCall {
  name: ToolName;
  input: Record<string, unknown>;
}

export function parseToolCall(value: unknown): ToolCall | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = record.name;
  if (
    name !== "read" &&
    name !== "write" &&
    name !== "edit" &&
    name !== "bash" &&
    name !== "glob" &&
    name !== "grep" &&
    name !== "task" &&
    name !== "skill" &&
    name !== "question" &&
    name !== "webfetch" &&
    name !== "mcp" &&
    name !== "browse" &&
    name !== "screenshot" &&
    name !== "click" &&
    name !== "type" &&
    name !== "key"
  ) {
    return undefined;
  }
  const input = record.input;
  if (typeof input !== "object" || input === null) return undefined;
  return { name, input: input as Record<string, unknown> };
}

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  read: "Read file contents (capped).",
  write: "Create or overwrite a file (creates parent dirs).",
  edit: "Exact-string replace in an existing file.",
  bash: "Execute a shell command with timeout.",
  glob: "Find files matching a pattern (*, **, ?).",
  grep: "Search file contents with a regex.",
  task: "Spawn a subagent: {subagent_type, prompt}.",
  skill: "Load a skill body: {name} — load first, then follow it.",
  question: "Ask the user: {question, options?: string[]} — use when blocked on a choice.",
  webfetch: "Fetch a URL as text: {url} — research docs, issues, and references.",
  mcp: "List available MCP tools, then call one as mcp__server__tool.",
  browse: "Open a URL in the real browser: {url} — then screenshot and walk the flow.",
  screenshot: "Capture the screen to a PNG and see it on the next turn.",
  click: "Click at screen pixels: {x, y, button?: left|right|middle}.",
  type: "Type text into the focused window: {text}.",
  key: "Press a key: {name} (Enter, Tab, Esc, arrows, F1–F12, …).",
};
