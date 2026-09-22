import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ChatMessage, QuotaInfo } from "@/domain/models.js";
import type { Driver, SendResult } from "@/domain/drivers.js";
import { AuthError, DriverError } from "@/lib/errors.js";

export interface CliDriverDef {
  command: string;
  extraArgs?: string[];
  argvPrefix?: string[];
  timeoutMs?: number;
  /** model id to select inside the CLI (passed via its --model flag) */
  cliModel?: string;
}

const TEXT_KEYS = new Set(["text", "delta", "result", "output_text", "response"]);
const SKIP_KEYS = new Set([
  "prompt",
  "command",
  "input",
  "query",
  "cwd",
  "tools",
  "slash_commands",
  "skills",
  "agents",
  "plugins",
  "mcp_servers",
  "model",
  "session_id",
  "uuid",
]);

function collectText(value: unknown, skipKey = ""): string[] {
  if (typeof value === "string") {
    return TEXT_KEYS.has(skipKey) || skipKey === "" ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v) => collectText(v));
  if (typeof value === "object" && value !== null) {
    const out: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof entry === "string" && TEXT_KEYS.has(key)) out.push(entry);
      else if (typeof entry === "object") out.push(...collectText(entry, key));
    }
    return out;
  }
  return [];
}

export function extractCliText(stdout: string): string {
  const parts: string[] = [];
  let pending: string[] = [];
  const flushDoc = (): void => {
    if (pending.length === 0) return;
    const doc = pending.join("\n");
    pending = [];
    try {
      parts.push(...collectText(JSON.parse(doc) as unknown));
    } catch {
      for (const line of doc.split("\n")) {
        const trimmed = line.trim();
        if (trimmed !== "") parts.push(trimmed);
      }
    }
  };
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (pending.length > 0 || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      pending.push(line);
      if (pending.length > 200) {
        flushDoc();
        continue;
      }
      try {
        parts.push(...collectText(JSON.parse(pending.join("\n")) as unknown));
        pending = [];
      } catch {
        // keep accumulating: multi-line JSON document
      }
      continue;
    }
    parts.push(trimmed);
  }
  flushDoc();
  const text = parts
    .filter((p) => p !== "")
    .join("\n")
    .slice(0, 32000);
  return text === "" ? stdout.slice(0, 32000) : text;
}

export function modelArgs(command: string, cliModel?: string): string[] {
  if (cliModel === undefined || cliModel === "") return [];
  switch (command) {
    case "codex":
    case "grok":
      return ["-m", cliModel];
    default:
      return ["--model", cliModel];
  }
}
export function headlessArgs(command: string, prompt: string, extraArgs: string[] = []): string[] {
  switch (command) {
    case "claude":
      return ["-p", prompt, "--output-format", "stream-json", "--verbose", ...extraArgs];
    case "codex":
      return ["exec", "--json", prompt, ...extraArgs];
    case "opencode":
      return ["run", prompt, "--format", "json", ...extraArgs];
    case "aider":
      return ["--message", prompt, ...extraArgs];
    case "agy":
      // verified against agy 1.2.6: print mode, json output, approval via --dangerously-skip-permissions
      return ["-p", prompt, "--output-format", "json", ...extraArgs];
    case "grok":
      // verified against grok --help: -p/--single, --output-format plain|json|streaming-json
      return ["-p", prompt, "--output-format", "json", ...extraArgs];
    default:
      return ["-p", prompt, "--output-format", "json", ...extraArgs];
  }
}

export function isDirectPath(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

const pathCache = new Map<string, string | undefined>();

export function findOnPath(command: string): string | undefined {
  if (pathCache.has(command)) return pathCache.get(command);
  const found = findOnPathUncached(command);
  pathCache.set(command, found);
  return found;
}

function findOnPathUncached(command: string): string | undefined {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const found = spawnSync(probe, [command], { encoding: "utf8", timeout: 5000 });
    if (found.status !== 0) return undefined;
    const lines = found.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (process.platform === "win32") {
      const exe = lines.find((l) => /\.exe$/i.test(l));
      if (exe !== undefined) return exe;
      for (const line of lines) {
        const ps1 = siblingPs1(line);
        if (ps1 !== undefined) return ps1;
      }
      return (
        lines.find((l) => /\.ps1$/i.test(l)) ??
        lines.find((l) => /\.(cmd|bat|com)$/i.test(l)) ??
        lines[0]
      );
    }
    return lines[0];
  } catch {
    return undefined;
  }
}

export function passthrough(command: string, args: string[] = []): number {
  const launch = resolveLaunch(command, args);
  const result = spawnSync(launch.file, launch.argv, { stdio: "inherit", shell: false });
  if (result.error !== undefined) {
    throw new DriverError(`${command} failed to start: ${result.error.message}`);
  }
  return result.status ?? 1;
}

export function cliVersion(command: string, timeoutMs = 10000): string | undefined {
  try {
    const launch = resolveLaunch(command, ["--version"]);
    const found = spawnSync(launch.file, launch.argv, { encoding: "utf8", timeout: timeoutMs });
    if (found.status !== 0) return undefined;
    const line = `${found.stdout}${found.stderr}`.split(/\r?\n/).find((l) => l.trim() !== "");
    return line?.trim();
  } catch {
    return undefined;
  }
}

export function quoteCmdArg(arg: string): string {
  return `'${arg.replace(/'/g, "''")}'`;
}

export function resolveLaunch(command: string, args: string[]): { file: string; argv: string[] } {
  const resolved = isDirectPath(command) ? command : (findOnPath(command) ?? command);
  const lower = resolved.toLowerCase();
  if (lower.endsWith(".ps1")) {
    return {
      file: "powershell.exe",
      argv: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolved,
        ...args,
      ],
    };
  }
  if (lower.endsWith(".cmd") || lower.endsWith(".bat") || lower.endsWith(".com")) {
    const script = `& ${quoteCmdArg(resolved)}${args.length > 0 ? ` ${args.map(quoteCmdArg).join(" ")}` : ""}`;
    return {
      file: "powershell.exe",
      argv: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    };
  }
  return { file: resolved, argv: args };
}

function siblingPs1(path: string): string | undefined {
  const base = path.replace(/\.[^\\/]*$/, "");
  const candidate = `${base}.ps1`;
  if (base !== path && existsSync(candidate)) return candidate;
  return undefined;
}

export class CliDriver implements Driver {
  readonly kind = "cli" as const;
  readonly id: string;
  private readonly command: string;
  private readonly extraArgs: string[];
  private readonly argvPrefix: string[];
  private readonly cliModel?: string;
  private readonly timeoutMs: number;
  private requests = 0;
  private estimatedTokens = 0;

  constructor(modelId: string, def: CliDriverDef) {
    this.id = modelId;
    this.command = def.command;
    this.extraArgs = def.extraArgs ?? [];
    this.argvPrefix = def.argvPrefix ?? [];
    this.cliModel = def.cliModel;
    this.timeoutMs = def.timeoutMs ?? 120000;
  }

  countTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async getQuota(): Promise<QuotaInfo> {
    return {
      provider: `cli:${this.command}`,
      requestsToday: this.requests,
      tokensToday: this.estimatedTokens,
      costToday: 0,
      estimated: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    if (!isDirectPath(this.command)) {
      const path = findOnPath(this.command);
      if (path === undefined) return { ok: false, detail: `${this.command} not on PATH` };
      const version = cliVersion(this.command);
      return { ok: true, detail: `${path}${version === undefined ? "" : ` (${version})`}` };
    }
    const version = cliVersion(this.command);
    if (version === undefined) return { ok: false, detail: `${this.command} not runnable` };
    return { ok: true, detail: version };
  }

  private requireBinary(): void {
    if (!isDirectPath(this.command) && findOnPath(this.command) === undefined) {
      throw new AuthError(`${this.command} not found (install it or set a provider key)`);
    }
  }

  private lastUserText(messages: ChatMessage[]): string {
    const last = [...messages].reverse().find((m) => m.role === "user");
    return last?.content ?? "";
  }

  private imageNote(messages: ChatMessage[]): string {
    const paths = messages.flatMap((m) => m.images ?? []);
    if (paths.length === 0) return "";
    return `\n[screenshots attached (${paths.join(", ")}) — this CLI cannot display images; continue without them]`;
  }

  private run(
    prompt: string,
    onStdout: (chunk: string) => void,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolvePromise, reject) => {
      const track = (child: ReturnType<typeof spawn>): void => {
        let stdout = "";
        let stderr = "";
        let truncated = false;
        const cap = 2 * 1024 * 1024;
        const pushStdout = (text: string): void => {
          onStdout(text);
          if (stdout.length >= cap) {
            truncated = true;
            return;
          }
          stdout += text.slice(0, cap - stdout.length);
        };
        child.stdout?.on("data", (chunk: Buffer) => {
          pushStdout(chunk.toString("utf8"));
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          if (stderr.length < cap) stderr += text.slice(0, cap - stderr.length);
          else truncated = true;
        });
        child.on("error", (err) => {
          reject(new DriverError(`${this.command} failed to start: ${err.message}`));
        });
        child.on("close", (code, signal) => {
          if (signal === "SIGTERM") {
            reject(
              new DriverError(
                `${this.command} timed out after ${this.timeoutMs}ms: ${stderr.slice(0, 500)}`,
              ),
            );
            return;
          }
          if (truncated) stdout += "\n…[output truncated at 2MB]";
          resolvePromise({ stdout, stderr, code: code ?? 1 });
        });
      };
      const args = [
        ...this.argvPrefix,
        ...modelArgs(this.command, this.cliModel),
        ...headlessArgs(this.command, prompt, this.extraArgs),
      ];
      const launch = resolveLaunch(this.command, args);
      const child = spawn(launch.file, launch.argv, { shell: false, timeout: this.timeoutMs });
      // Prompt travels via argv; close stdin so CLIs that append piped stdin don't wait on it.
      child.stdin?.end();
      track(child);
    });
  }

  async sendMessage(messages: ChatMessage[]): Promise<SendResult> {
    const prompt = this.lastUserText(messages) + this.imageNote(messages);
    this.requireBinary();
    const { stdout, stderr, code } = await this.run(prompt, () => {});
    if (code !== 0 && stdout.trim() === "") {
      throw new DriverError(`${this.command} exited with code ${code}: ${stderr.slice(0, 500)}`);
    }
    const text = extractCliText(stdout);
    this.requests += 1;
    const usage = { input: this.countTokens(prompt), output: this.countTokens(text) };
    this.estimatedTokens += usage.input + usage.output;
    return { text, usage };
  }

  async streamMessage(
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<SendResult> {
    const prompt = this.lastUserText(messages) + this.imageNote(messages);
    this.requireBinary();
    let buffer = "";
    const { stdout, stderr, code } = await this.run(prompt, (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parts = collectText(JSON.parse(trimmed) as unknown);
          for (const part of parts) onToken(part);
        } catch {
          continue;
        }
      }
    });
    if (code !== 0 && stdout.trim() === "") {
      throw new DriverError(`${this.command} exited with code ${code}: ${stderr.slice(0, 500)}`);
    }
    const text = extractCliText(stdout);
    this.requests += 1;
    const usage = { input: this.countTokens(prompt), output: this.countTokens(text) };
    this.estimatedTokens += usage.input + usage.output;
    return { text, usage };
  }
}
