export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type PermissionDecision = "allow" | "ask" | "deny";

/** Shift+Tab cycle order (bypass stays startup-flag-only). */
export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const order: PermissionMode[] = ["default", "acceptEdits", "plan"];
  const at = order.indexOf(mode);
  return order[(at + 1) % order.length] as PermissionMode;
}
export interface PermissionRule {
  tool: string;
  pattern: string;
  decision: PermissionDecision;
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (ch === "?") {
      out += ".";
      i += 1;
    } else if ("\\^$+?.()|{}[]".includes(ch ?? "")) {
      out += `\\${ch}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesGlob(pattern: string, value: string): boolean {
  // Trailing ":*" means "this prefix with any arguments": Bash(git commit:*)
  // matches both "git commit" and "git commit -m x".
  if (pattern.endsWith(":*")) {
    const head = pattern.slice(0, -":*".length);
    if (value === head || value.startsWith(`${head} `) || value.startsWith(`${head}/`)) {
      return true;
    }
  }
  return globToRegExp(pattern).test(value);
}

export function parseRule(text: string, decision: PermissionDecision): PermissionRule {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 1 || close !== text.length - 1) {
    throw new Error(`invalid permission rule "${text}" (want Tool(pattern))`);
  }
  const tool = text.slice(0, open).trim();
  const pattern = text.slice(open + 1, close).trim();
  if (tool === "" || pattern === "") {
    throw new Error(`invalid permission rule "${text}" (want Tool(pattern))`);
  }
  return { tool, pattern, decision };
}

export function targetFor(tool: string, input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input !== "object" || input === null) return "";
  const record = input as Record<string, unknown>;
  const command = record.command;
  if (typeof command === "string") return command;
  const path = record.path;
  if (typeof path === "string") return path;
  const domain = record.domain;
  if (typeof domain === "string") return domain;
  const url = record.url;
  if (typeof url === "string") {
    try {
      return `domain:${new URL(url).hostname}`;
    } catch {
      return `domain:${url}`;
    }
  }
  return "";
}

export function checkPermission(
  mode: PermissionMode,
  rules: PermissionRule[],
  tool: string,
  input: unknown,
): PermissionDecision {
  // Tool fences arrive lowercase ("read"); rules and modes may use any case.
  const name = tool.toLowerCase();
  if (mode === "bypassPermissions") return "allow";
  if (mode === "plan")
    return name === "read" || name === "glob" || name === "grep" ? "allow" : "ask";
  if (mode === "acceptEdits" && (name === "read" || name === "edit" || name === "write")) {
    return "allow";
  }
  const target = targetFor(tool, input);
  let decision: PermissionDecision | undefined;
  for (const rule of rules) {
    if (rule.tool !== "*" && rule.tool.toLowerCase() !== name) continue;
    if (matchesGlob(rule.pattern, target)) {
      decision = rule.decision;
    }
  }
  if (decision !== undefined) return decision;
  if (name === "read" || name === "glob" || name === "grep") return "allow";
  return isDestructive(tool, input) ? "ask" : "allow";
}

const DESTRUCTIVE_BASH: RegExp[] = [
  /\brm\s+[^\n]*-[a-z]*r/i,
  /\brmdir\s+\/s/i,
  /\bdel\s+[^\n]*\/s/i,
  /\brd\s+\/s/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /(^|[\s;&|])dd\s/i,
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;/,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /remove-item\b[^\n]*-recurse/i,
  /\bgit\s+clean\s+-[a-z]*f[a-z]*d/i,
  /\bgit\s+reset\s+--hard/i,
];

/** Critical operations that always need approval: data destruction. Case-insensitive on tool names. */
export function isDestructive(tool: string, input: unknown): boolean {
  const name = tool.toLowerCase();
  if (name === "remove") return true;
  if (name !== "bash") return false;
  const command = targetFor(tool, input);
  return DESTRUCTIVE_BASH.some((rx) => rx.test(command));
}
