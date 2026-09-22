import type { OrchestrationMode } from "@/domain/models.js";
import type { PermissionMode } from "@/domain/permissions.js";

export type CliCommand =
  | "repl"
  | "headless"
  | "models"
  | "doctor"
  | "sessions"
  | "mcp"
  | "config"
  | "update"
  | "tui"
  | "help"
  | "version";

export type OutputFormat = "text" | "json" | "stream-json";

export interface CliArgs {
  command: CliCommand;
  prompt?: string;
  agents: string[];
  mode?: OrchestrationMode;
  model?: string;
  continueLatest: boolean;
  resume?: string;
  outputFormat: OutputFormat;
  dangerouslySkip: boolean;
  permissionMode?: PermissionMode;
  passthrough: boolean;
  maxCost?: number;
  verbose: boolean;
  notify: boolean;
  rest: string[];
}

const MODES: OrchestrationMode[] = ["solo", "council", "relay", "workers", "auto"];
const PERMISSION_MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function parseArgv(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "repl",
    agents: [],
    continueLatest: false,
    outputFormat: "text",
    dangerouslySkip: false,
    passthrough: false,
    verbose: false,
    notify: true,
    rest: [],
  };
  let positional: string[] | undefined;
  let i = 0;
  const next = (): string | undefined => {
    i += 1;
    return argv[i];
  };
  while (i < argv.length) {
    const tok = argv[i] ?? "";
    if (tok === "-p" || tok === "--prompt" || tok === "--single") {
      const value = next();
      if (value === undefined) throw new Error("missing value for -p/--prompt");
      args.prompt = value;
      args.command = "headless";
    } else if (tok === "--agents") {
      const value = next();
      if (value === undefined) throw new Error("missing value for --agents");
      args.agents = splitList(value);
    } else if (tok === "--mode") {
      const value = next();
      if (value === undefined || !MODES.includes(value as OrchestrationMode)) {
        throw new Error(`--mode must be one of ${MODES.join("|")}`);
      }
      args.mode = value as OrchestrationMode;
    } else if (tok === "--model" || tok === "--models") {
      const value = next();
      if (value === undefined) throw new Error("missing value for --model(s)");
      const list = splitList(value);
      args.model = list[0];
      if (list.length > 1) args.agents = list;
    } else if (tok === "-c" || tok === "--continue") {
      args.continueLatest = true;
    } else if (tok === "-r" || tok === "--resume") {
      const peek = argv[i + 1];
      if (peek !== undefined && !peek.startsWith("-")) {
        args.resume = peek;
        i += 1;
      } else {
        args.resume = "latest";
      }
    } else if (tok === "--output-format") {
      const value = next();
      if (value !== "text" && value !== "json" && value !== "stream-json") {
        throw new Error("--output-format must be text|json|stream-json");
      }
      args.outputFormat = value;
      if (value !== "text") args.command = "headless";
    } else if (tok === "--json") {
      args.outputFormat = "json";
      args.command = "headless";
    } else if (tok === "-y" || tok === "--yolo" || tok === "--dangerously-skip-permissions") {
      args.dangerouslySkip = true;
    } else if (tok === "--passthrough") {
      args.passthrough = true;
    } else if (tok === "--permission-mode") {
      const value = next();
      if (value === undefined || !PERMISSION_MODES.includes(value as PermissionMode)) {
        throw new Error(`--permission-mode must be one of ${PERMISSION_MODES.join("|")}`);
      }
      args.permissionMode = value as PermissionMode;
    } else if (tok === "--max-cost") {
      const value = next();
      const n = value === undefined ? NaN : Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error("--max-cost must be a non-negative number");
      args.maxCost = n;
    } else if (tok === "--verbose") {
      args.verbose = true;
    } else if (tok === "--no-notify") {
      args.notify = false;
    } else if (tok === "--help" || tok === "-h") {
      args.command = "help";
    } else if (tok === "--version" || tok === "-v") {
      args.command = "version";
    } else if (!tok.startsWith("-") && positional === undefined) {
      positional = [tok, ...argv.slice(i + 1)];
      break;
    } else {
      args.rest.push(tok);
    }
    i += 1;
  }
  if (positional !== undefined && positional.length > 0) {
    const [head, ...tail] = positional as [string, ...string[]];
    if (
      head === "models" ||
      head === "doctor" ||
      head === "sessions" ||
      head === "update" ||
      head === "tui"
    ) {
      args.command = head;
      args.rest.push(...tail);
    } else if (head === "mcp" || head === "config") {
      args.command = head;
      args.rest.push(...tail);
    } else if (args.prompt === undefined && args.command !== "headless") {
      args.rest.push(head, ...tail);
    } else {
      args.rest.push(head, ...tail);
    }
  }
  if (args.command === "repl" && args.prompt !== undefined) args.command = "headless";
  return args;
}

export function helpText(): string {
  return [
    "flow — unified multi-model, multi-agent AI coding CLI",
    "",
    "Usage:",
    "  flow                          selector → session",
    "  flow -c | flow -r [id]        continue / resume",
    "  flow sessions                 session browser",
    '  flow -p "task" [--agents a,b] [--mode council] [--output-format json|stream-json]',
    "  flow models                   list models",
    "  flow tui                      full-screen terminal UI",
    "  flow doctor | flow mcp ... | flow config ... | flow update",
    "",
    "Flags: -y/--dangerously-skip-permissions, --permission-mode, --model(s),",
    "  --mode, --max-cost, --verbose, --no-notify, --json, --passthrough",
  ].join("\n");
}
