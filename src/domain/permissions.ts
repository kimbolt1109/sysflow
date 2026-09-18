export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type PermissionDecision = "allow" | "ask" | "deny";

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
  if (mode === "bypassPermissions") return "allow";
  if (mode === "plan")
    return tool === "Read" || tool === "Glob" || tool === "Grep" ? "allow" : "ask";
  if (mode === "acceptEdits" && (tool === "Read" || tool === "Edit" || tool === "Write")) {
    return "allow";
  }
  const target = targetFor(tool, input);
  let decision: PermissionDecision | undefined;
  for (const rule of rules) {
    if (rule.tool !== "*" && rule.tool !== tool) continue;
    if (matchesGlob(rule.pattern, target)) {
      decision = rule.decision;
    }
  }
  if (decision !== undefined) return decision;
  if (tool === "Read" || tool === "Glob" || tool === "Grep") return "allow";
  return "ask";
}
