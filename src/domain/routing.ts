import type { RoutingRule } from "@/domain/models.js";

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if ("\\^$+?.()|{}[]".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchRouting(rules: RoutingRule[], modelId: string): RoutingRule {
  for (const rule of rules) {
    if (globToRegExp(rule.match).test(modelId)) {
      return rule;
    }
  }
  return { match: "*", driver: "cli", command: "opencode" };
}

/** CLIs whose model listings use their own ids; those models only mean something to them. */
const CLI_SOURCES = new Set(["agy", "opencode", "grok"]);

export function isCliSourced(source: string | undefined): boolean {
  return source !== undefined && CLI_SOURCES.has(source);
}

/** Routes a model, honoring where it was discovered: agy's "claude-opus-4-6-thinking" is
 * not a model the claude CLI knows, so a model a CLI listed runs through that CLI. */
export function routeFor(rules: RoutingRule[], modelId: string, source?: string): RoutingRule {
  if (source !== undefined && isCliSourced(source)) {
    return (
      rules.find((r) => r.driver === "cli" && r.command === source) ?? {
        match: modelId,
        driver: "cli",
        command: source,
      }
    );
  }
  return matchRouting(rules, modelId);
}

export function isNativeRule(rule: RoutingRule): boolean {
  return rule.driver === "native";
}
