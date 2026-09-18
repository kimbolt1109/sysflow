export type CommandStatus = "ready" | "m3" | "m4" | "m5" | "m7";

export interface SlashCommand {
  name: string;
  description: string;
  status: CommandStatus;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show help and available commands.", status: "ready" },
  { name: "clear", description: "Start a fresh conversation.", status: "ready" },
  { name: "compact", description: "Summarize the transcript to free context.", status: "ready" },
  { name: "context", description: "Show per-agent context usage bars.", status: "ready" },
  { name: "model", description: "Show the active model.", status: "ready" },
  { name: "models", description: "List registry models.", status: "ready" },
  { name: "agents", description: "Manage agents (multi-agent view).", status: "ready" },
  { name: "skills", description: "List available skills.", status: "ready" },
  { name: "permissions", description: "Show permission mode and rules.", status: "ready" },
  { name: "status", description: "Provider quota and usage status.", status: "m7" },
  { name: "usage", description: "Plan usage limits and rate limits.", status: "m7" },
  { name: "cost", description: "Session and daily cost.", status: "m7" },
  { name: "sessions", description: "List sessions with previews.", status: "ready" },
  { name: "resume", description: "Switch to another session in place.", status: "ready" },
  { name: "init", description: "Scaffold a FLOW.md for the project.", status: "ready" },
  { name: "memory", description: "Open memory files in an editor.", status: "ready" },
  { name: "mcp", description: "Manage MCP server connections.", status: "ready" },
  { name: "config", description: "View or edit configuration.", status: "ready" },
  { name: "doctor", description: "Diagnose setup and auth.", status: "ready" },
  { name: "review", description: "Review the working-tree diff.", status: "ready" },
  { name: "undo", description: "Undo the last file change.", status: "m7" },
  { name: "rewind", description: "Rewind to an earlier checkpoint.", status: "m7" },
  { name: "export", description: "Export the conversation to a file.", status: "m7" },
  { name: "theme", description: "Switch theme presets.", status: "m7" },
  { name: "add-dir", description: "Add a working directory.", status: "ready" },
  { name: "vim", description: "Toggle vim keybindings.", status: "m7" },
  { name: "exit", description: "Exit the session.", status: "ready" },
  { name: "mute", description: "Mute an agent (multi-agent).", status: "ready" },
  { name: "unmute", description: "Unmute an agent (multi-agent).", status: "ready" },
  { name: "promote", description: "Promote an agent to lead.", status: "ready" },
  { name: "handoff", description: "Hand execution to another agent.", status: "ready" },
  { name: "mode", description: "Switch orchestration mode.", status: "ready" },
  { name: "round", description: "Set critique rounds (council).", status: "ready" },
  { name: "stop-agent", description: "Stop an agent.", status: "ready" },
];

export function findCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name === name);
}

export function parseSlash(input: string): { name: string; args: string } | undefined {
  if (!input.startsWith("/")) return undefined;
  const [name, ...rest] = input.slice(1).split(/\s+/);
  if (name === undefined || name === "") return undefined;
  return { name, args: rest.join(" ").trim() };
}

export interface CustomCommand {
  name: string;
  template: string;
  source: string;
}

export function substituteArgs(template: string, args: string): string {
  const words = args.split(/\s+/).filter((w) => w !== "");
  let out = template.replace(/\$ARGUMENTS/g, args);
  words.forEach((word, index) => {
    out = out.replace(new RegExp(`\\$${index + 1}\\b`, "g"), word);
  });
  return out;
}
