import type { RoutingRule } from "@/domain/models.js";

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") {
      out += ".*";
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

export function isNativeRule(rule: RoutingRule): boolean {
  return rule.driver === "native";
}
