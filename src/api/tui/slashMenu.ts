import type { CustomCommand } from "@/domain/commands.js";
import type { SkillDef } from "@/domain/skills.js";
import type { SubagentDef } from "@/domain/subagents.js";

export type SlashGroup = "builtin" | "skill" | "subagent" | "custom";

export interface SlashEntry {
  command: string;
  hint: string;
  group: SlashGroup;
  aliases?: string[];
}

const BUILTINS: SlashEntry[] = [
  { command: "/help", hint: "commands and shortcuts", group: "builtin" },
  { command: "/clear", hint: "clear the transcript", group: "builtin", aliases: ["/new"] },
  { command: "/model", hint: "show the active model", group: "builtin" },
  { command: "/models", hint: "list known models", group: "builtin" },
  { command: "/skills", hint: "list skills, /<skill> runs one", group: "builtin" },
  { command: "/agents", hint: "council roster and subagents", group: "builtin" },
  { command: "/plan", hint: "toggle plan-mode: pause councils for /approve", group: "builtin" },
  { command: "/approve", hint: "execute the pending plan", group: "builtin" },
  { command: "/cost", hint: "session spend and daily usage", group: "builtin" },
  { command: "/context", hint: "context window usage", group: "builtin" },
  { command: "/find", hint: "search the transcript, repeat to cycle", group: "builtin" },
  { command: "/dump", hint: "save the transcript to markdown", group: "builtin" },
  { command: "/triage", hint: "route and score text in one pass", group: "builtin" },
  { command: "/status", hint: "per-provider quotas and usage", group: "builtin" },
  { command: "/compact", hint: "summarize transcript, keep recent window", group: "builtin" },
  { command: "/undo", hint: "restore the last checkpoint", group: "builtin" },
  { command: "/rewind", hint: "list or restore a checkpoint", group: "builtin" },
  { command: "/sessions", hint: "list sessions with previews", group: "builtin" },
  { command: "/tasks", hint: "activity counts for this session", group: "builtin" },
  { command: "/export", hint: "write the transcript to markdown", group: "builtin" },
  { command: "/init", hint: "create project memory file", group: "builtin" },
  { command: "/memory", hint: "list memory files", group: "builtin" },
  { command: "/permissions", hint: "show or add permission rules", group: "builtin" },
  { command: "/reload", hint: "reload skills, subagents, commands", group: "builtin" },
  { command: "/review", hint: "review the working-tree diff", group: "builtin" },
  { command: "/exit", hint: "leave the session", group: "builtin", aliases: ["/quit"] },
];

export interface SlashCatalog {
  skills: SkillDef[];
  subagents: SubagentDef[];
  customCommands: CustomCommand[];
}

export function buildSlashCatalog(catalog: SlashCatalog): SlashEntry[] {
  const entries = [...BUILTINS];
  for (const skill of catalog.skills) {
    if (!skill.userInvocable) continue;
    entries.push({
      command: `/${skill.name}`,
      hint: `skill: ${skill.description}`,
      group: "skill",
    });
  }
  for (const subagent of catalog.subagents) {
    entries.push({
      command: `/agents run ${subagent.name}`,
      hint: `subagent: ${subagent.description}`,
      group: "subagent",
    });
  }
  for (const custom of catalog.customCommands) {
    if (!entries.some((e) => e.command === `/${custom.name}`)) {
      entries.push({
        command: `/${custom.name}`,
        hint: `custom command (${custom.source})`,
        group: "custom",
      });
    }
  }
  return entries;
}

/** Subsequence fuzzy score: lower is better, -1 means no match. */
export function fuzzyScore(needle: string, haystack: string): number {
  if (needle === "") return 0;
  let score = 0;
  let hi = 0;
  let consecutive = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi);
    if (found < 0) return -1;
    score += found - hi > 0 ? found - hi + 1 : 0;
    consecutive = found === hi ? consecutive + 1 : 0;
    if (consecutive > 1) score -= 1;
    hi = found + 1;
  }
  if (haystack.startsWith(needle)) score -= needle.length;
  return score;
}

/** Resolve aliases (/quit -> /exit, /new -> /clear) to the canonical command. */
export function resolveSlashAlias(token: string): string {
  const lower = token.toLowerCase();
  if (lower === "/quit" || lower === "/q") return "/exit";
  if (lower === "/new") return "/clear";
  return token;
}

export function filterSlash(input: string, catalog: SlashEntry[], limit = 8): SlashEntry[] {
  if (!input.startsWith("/") || input.includes(" ")) return [];
  const needle = input.slice(1).toLowerCase();
  if (needle === "") return catalog.slice(0, Math.max(0, limit));
  return catalog
    .map((entry) => {
      const names = [entry.command.slice(1).toLowerCase()];
      for (const alias of entry.aliases ?? []) names.push(alias.slice(1).toLowerCase());
      let best = -1;
      for (const name of names) {
        if (name.includes(needle)) {
          best = best < 0 ? 0 : Math.min(best, 0);
          continue;
        }
        const score = fuzzyScore(needle, name);
        if (score >= 0) best = best < 0 ? score + 10 : Math.min(best, score + 10);
      }
      return { entry, best };
    })
    .filter((scored) => scored.best >= 0)
    .sort((a, b) => a.best - b.best || a.entry.command.localeCompare(b.entry.command))
    .map((scored) => scored.entry)
    .slice(0, Math.max(0, limit));
}
