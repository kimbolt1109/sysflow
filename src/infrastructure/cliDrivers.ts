import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { ChatMessage, QuotaInfo } from "@/domain/models.js";
import type { Driver, SendOptions, SendResult } from "@/domain/drivers.js";
import type { ThinkingLevel } from "@/domain/thinking.js";
import { streamParserFor, type CliStreamParser } from "@/infrastructure/cliOutput.js";
import { renderCliPrompt } from "@/infrastructure/cliPrompt.js";
import {
  cliVersion,
  findOnPath,
  isDirectPath,
  killTree,
  resolveLaunch,
} from "@/infrastructure/cliLaunch.js";
import { AuthError, DriverError } from "@/lib/errors.js";

export interface CliDriverDef {
  command: string;
  extraArgs?: string[];
  argvPrefix?: string[];
  timeoutMs?: number;
  /** model id to select inside the CLI (passed via its --model flag) */
  cliModel?: string;
  /** reasoning effort for CLIs that take one (agy, claude) */
  effort?: ThinkingLevel;
  /** whose flags and output format to speak; defaults to the command's basename */
  dialect?: string;
}

export interface CliInvocation {
  args: string[];
  /** written to the CLI's stdin; argv-prompt CLIs get an immediately closed stdin */
  stdin?: string;
}

/** Flags that auto-approve a CLI's own tools, and the flags that make it read-only instead.
 * Verified live: claude and grok `--permission-mode plan` refuse file writes in print mode.
 * agy 1.2.10 has no per-run read-only switch: `--mode plan` writes a plan and then carries
 * it out, and write_to_file needs no approval. Dropping its auto-approve flag still blocks
 * shell commands; the prompt's read-only notice has to cover file writes. */
const PERMISSION_FLAGS: Record<string, { approve: string[]; readOnly: string[] }> = {
  agy: { approve: ["--dangerously-skip-permissions"], readOnly: [] },
  claude: {
    approve: ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions"],
    readOnly: ["--permission-mode", "plan"],
  },
  grok: { approve: ["--always-approve"], readOnly: ["--permission-mode", "plan"] },
};

export function cliDialect(command: string): string {
  return basename(command)
    .replace(/\.(exe|cmd|bat|com|ps1)$/i, "")
    .toLowerCase();
}

export function modelArgs(dialect: string, cliModel?: string): string[] {
  if (cliModel === undefined || cliModel === "") return [];
  switch (dialect) {
    case "codex":
    case "grok":
      return ["-m", cliModel];
    default:
      return ["--model", cliModel];
  }
}

export function effortArgs(dialect: string, effort?: ThinkingLevel, cliModel?: string): string[] {
  if (effort === undefined) return [];
  switch (dialect) {
    case "agy":
      // agy ids like gemini-3.8-flash-high already pin their effort
      if (cliModel !== undefined && /-(low|medium|high)$/.test(cliModel)) return [];
      return ["--effort", effort === "xhigh" ? "high" : effort];
    case "claude":
      return ["--effort", effort];
    default:
      return [];
  }
}

/** Swaps a CLI's auto-approve flags for its read-only mode when the call must not mutate. */
export function permissionArgs(dialect: string, extraArgs: string[], readOnly: boolean): string[] {
  const flags = PERMISSION_FLAGS[dialect];
  if (!readOnly || flags === undefined) return extraArgs;
  const modeFlag = flags.readOnly[0];
  const out: string[] = [];
  for (let i = 0; i < extraArgs.length; i += 1) {
    const arg = extraArgs[i] ?? "";
    if (flags.approve.includes(arg)) continue;
    if (modeFlag !== undefined && arg.startsWith(`${modeFlag}=`)) continue;
    if (modeFlag !== undefined && arg === modeFlag) {
      i += 1;
      continue;
    }
    out.push(arg);
  }
  return [...out, ...flags.readOnly];
}

const READ_ONLY_NOTICE =
  "READ-ONLY RUN: do not create, modify, or delete any file and do not run shell commands. " +
  "Read and search freely, then answer in text.";

export function headlessArgs(dialect: string, prompt: string, extraArgs: string[] = []): string[] {
  switch (dialect) {
    case "claude":
      return ["-p", prompt, "--output-format", "stream-json", "--verbose", ...extraArgs];
    case "codex":
      return ["exec", "--json", prompt, ...extraArgs];
    case "opencode":
      return ["run", prompt, "--format", "json", ...extraArgs];
    case "aider":
      return ["--message", prompt, ...extraArgs];
    case "grok":
      // verified against grok --help: -p/--single, --output-format plain|json|streaming-json
      return ["-p", prompt, "--output-format", "json", ...extraArgs];
    default:
      return ["-p", prompt, "--output-format", "json", ...extraArgs];
  }
}

export function cliInvocation(
  dialect: string,
  prompt: string,
  opts: {
    extraArgs?: string[];
    cliModel?: string;
    effort?: ThinkingLevel;
    readOnly?: boolean;
  } = {},
): CliInvocation {
  const extra = permissionArgs(dialect, opts.extraArgs ?? [], opts.readOnly === true);
  const lead = [
    ...modelArgs(dialect, opts.cliModel),
    ...effortArgs(dialect, opts.effort, opts.cliModel),
  ];
  if (dialect === "agy") {
    // verified against agy 1.2.10: stream-json input takes `-p=` plus one
    // {"event":"user"} envelope per line; the prompt never touches argv.
    return {
      args: [
        ...lead,
        ...extra,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "-p=",
      ],
      stdin: `${JSON.stringify({ event: "user", message: { role: "user", content: prompt } })}\n`,
    };
  }
  return { args: [...lead, ...headlessArgs(dialect, prompt, extra)] };
}

/** Prompt size cap: stdin has no argv limit; Windows caps a whole command line at 32767 chars. */
function promptBudget(dialect: string): number {
  if (dialect === "agy") return 400_000;
  return process.platform === "win32" ? 20_000 : 100_000;
}

export class CliDriver implements Driver {
  readonly kind = "cli" as const;
  readonly id: string;
  private readonly command: string;
  private readonly dialect: string;
  private readonly extraArgs: string[];
  private readonly argvPrefix: string[];
  private readonly cliModel?: string;
  private readonly effort?: ThinkingLevel;
  private readonly timeoutMs: number;
  private requests = 0;
  private tokens = 0;

  constructor(modelId: string, def: CliDriverDef) {
    this.id = modelId;
    this.command = def.command;
    this.dialect = def.dialect ?? cliDialect(def.command);
    this.extraArgs = def.extraArgs ?? [];
    this.argvPrefix = def.argvPrefix ?? [];
    this.cliModel = def.cliModel;
    this.effort = def.effort;
    this.timeoutMs = def.timeoutMs ?? 120000;
  }

  countTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async getQuota(): Promise<QuotaInfo> {
    return {
      provider: `cli:${this.command}`,
      requestsToday: this.requests,
      tokensToday: this.tokens,
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

  private imageNote(messages: ChatMessage[]): string {
    const paths = messages.flatMap((m) => m.images ?? []);
    if (paths.length === 0) return "";
    return `\n[screenshots attached (${paths.join(", ")}) — this CLI cannot display images; continue without them]`;
  }

  private run(
    invocation: CliInvocation,
    promptChars: number,
    parser: CliStreamParser,
    onToken?: (token: string) => void,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolvePromise, reject) => {
      const launch = resolveLaunch(this.command, [...this.argvPrefix, ...invocation.args]);
      const child = spawn(launch.file, launch.argv, { shell: false, windowsHide: true });
      const cap = 2 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let partial = "";
      let truncated = false;
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, this.timeoutMs);
      const feed = (line: string): void => {
        for (const token of parser.feed(line)) onToken?.(token);
      };
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (text: string) => {
        if (stdout.length < cap) stdout += text.slice(0, cap - stdout.length);
        else truncated = true;
        partial += text;
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) feed(line);
      });
      child.stderr?.on("data", (text: string) => {
        if (stderr.length < cap) stderr += text.slice(0, cap - stderr.length);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new DriverError(`${this.command} failed to start: ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (partial !== "") feed(partial);
        if (timedOut) {
          const waited = (this.timeoutMs / 1000).toFixed(0);
          const detail = stderr.slice(0, 500);
          reject(
            new DriverError(
              `${this.id} via ${this.command} timed out after ${waited}s with no response ` +
                `(prompt ~${promptChars} chars; raise APP_CLI_TIMEOUT_MS or use fewer agents).` +
                (detail === "" ? "" : ` stderr: ${detail}`),
            ),
          );
          return;
        }
        if (truncated) stdout += "\n…[output truncated at 2MB]";
        resolvePromise({ stdout, stderr, code: code ?? 1 });
      });
      // A CLI that exits before reading stdin makes the write fail with EPIPE; its exit code tells the story.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(invocation.stdin);
    });
  }

  private async complete(
    messages: ChatMessage[],
    opts: SendOptions | undefined,
    onToken?: (token: string) => void,
  ): Promise<SendResult> {
    this.requireBinary();
    const readOnly = opts?.readOnly === true;
    const framed: ChatMessage[] = readOnly
      ? [{ role: "system", content: READ_ONLY_NOTICE }, ...messages]
      : messages;
    const prompt = renderCliPrompt(framed, promptBudget(this.dialect)) + this.imageNote(messages);
    const invocation = cliInvocation(this.dialect, prompt, {
      extraArgs: this.extraArgs,
      cliModel: this.cliModel,
      effort: this.effort,
      readOnly,
    });
    const parser = streamParserFor(this.dialect);
    const { stdout, stderr, code } = await this.run(invocation, prompt.length, parser, onToken);
    const outcome = parser.finish(stdout);
    if (outcome.error !== undefined) {
      throw new DriverError(`${this.id} via ${this.command}: ${outcome.error.slice(0, 500)}`);
    }
    if (code !== 0 && outcome.text.trim() === "") {
      throw new DriverError(`${this.command} exited with code ${code}: ${stderr.slice(0, 500)}`);
    }
    const reported = outcome.usage;
    const usage =
      reported !== undefined && reported.input + reported.output > 0
        ? reported
        : { input: this.countTokens(prompt), output: this.countTokens(outcome.text) };
    this.requests += 1;
    this.tokens += usage.input + usage.output;
    return { text: outcome.text, usage };
  }

  sendMessage(messages: ChatMessage[], opts?: SendOptions): Promise<SendResult> {
    return this.complete(messages, opts);
  }

  streamMessage(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    opts?: SendOptions,
  ): Promise<SendResult> {
    return this.complete(messages, opts, onToken);
  }
}
