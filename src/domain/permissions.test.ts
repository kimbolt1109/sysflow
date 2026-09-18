import { describe, expect, it } from "vitest";
import { checkPermission, matchesGlob, parseRule } from "@/domain/permissions";

describe("permissions", () => {
  it("matches gitignore-style globs", () => {
    expect(matchesGlob("git commit:*", "git commit -m hi")).toBe(true);
    expect(matchesGlob("docs/**", "docs/a/b.md")).toBe(true);
    expect(matchesGlob("docs/**", "src/a.ts")).toBe(false);
    expect(matchesGlob("~/.zshrc", "~/.zshrc")).toBe(true);
  });

  it("parses Tool(pattern) rules", () => {
    expect(parseRule("Bash(git commit:*)", "allow")).toEqual({
      tool: "Bash",
      pattern: "git commit:*",
      decision: "allow",
    });
    expect(() => parseRule("Bash", "allow")).toThrow("invalid permission rule");
  });

  it("applies last matching rule wins", () => {
    const rules = [parseRule("Bash(*)", "deny"), parseRule("Bash(git commit:*)", "allow")];

    expect(checkPermission("default", rules, "Bash", "git commit -m x")).toBe("allow");
    expect(checkPermission("default", rules, "Bash", "rm -rf /")).toBe("deny");
  });

  it("auto-allows reads but asks for writes by default", () => {
    expect(checkPermission("default", [], "Read", "~/.zshrc")).toBe("allow");
    expect(checkPermission("default", [], "Edit", "docs/a.md")).toBe("ask");
  });

  it("matches domain-qualified web rules", () => {
    expect(
      checkPermission("default", [parseRule("WebFetch(domain:github.com)", "allow")], "WebFetch", {
        url: "https://github.com/x/y",
      }),
    ).toBe("allow");
    expect(
      checkPermission("default", [parseRule("WebFetch(domain:github.com)", "allow")], "WebFetch", {
        url: "https://example.com/z",
      }),
    ).toBe("ask");
  });

  it("bypasses everything in bypassPermissions mode", () => {
    expect(checkPermission("bypassPermissions", [], "Bash", "rm -rf /")).toBe("allow");
  });

  it("restricts plan mode to read-only tools", () => {
    expect(checkPermission("plan", [], "Read", "a")).toBe("allow");
    expect(checkPermission("plan", [], "Bash", "ls")).toBe("ask");
  });
});
