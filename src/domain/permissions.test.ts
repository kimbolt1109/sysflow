import { describe, expect, it } from "vitest";
import {
  checkPermission,
  isDestructive,
  matchesGlob,
  nextPermissionMode,
  parseRule,
} from "@/domain/permissions.js";

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

  it("auto-allows everything but destructive acts by default", () => {
    expect(checkPermission("default", [], "Read", "~/.zshrc")).toBe("allow");
    expect(checkPermission("default", [], "Edit", "docs/a.md")).toBe("allow");
    expect(checkPermission("default", [], "Bash", "npm run test")).toBe("allow");
    expect(checkPermission("default", [], "Bash", "rm -rf /tmp/x")).toBe("ask");
    expect(checkPermission("default", [], "Remove", "a.txt")).toBe("ask");
  });

  it("detects destructive operations", () => {
    expect(isDestructive("remove", { path: "a" })).toBe(true);
    expect(isDestructive("Bash", { command: "rm -rf /" })).toBe(true);
    expect(isDestructive("bash", { command: "git clean -fdx" })).toBe(true);
    expect(isDestructive("bash", { command: "Remove-Item -Recurse C:\\x" })).toBe(true);
    expect(isDestructive("bash", { command: "npm run test" })).toBe(false);
    expect(isDestructive("write", { path: "a" })).toBe(false);
    expect(isDestructive("click", { x: 1, y: 2 })).toBe(false);
  });

  it("cycles default, acceptEdits, and plan", () => {
    expect(nextPermissionMode("default")).toBe("acceptEdits");
    expect(nextPermissionMode("acceptEdits")).toBe("plan");
    expect(nextPermissionMode("plan")).toBe("default");
    expect(nextPermissionMode("bypassPermissions")).toBe("default");
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
    ).toBe("allow");
  });

  it("bypasses everything in bypassPermissions mode", () => {
    expect(checkPermission("bypassPermissions", [], "Bash", "rm -rf /")).toBe("allow");
  });

  it("restricts plan mode to read-only tools", () => {
    expect(checkPermission("plan", [], "Read", "a")).toBe("allow");
    expect(checkPermission("plan", [], "Bash", "ls")).toBe("ask");
  });

  it("matches lowercase runtime tool names", () => {
    expect(checkPermission("plan", [], "read", "a")).toBe("allow");
    expect(checkPermission("plan", [], "glob", "**/*.ts")).toBe("allow");
    expect(checkPermission("plan", [], "bash", "ls")).toBe("ask");
    expect(checkPermission("acceptEdits", [], "edit", "a.md")).toBe("allow");
    expect(checkPermission("acceptEdits", [], "write", "a.md")).toBe("allow");
    expect(checkPermission("acceptEdits", [], "bash", "ls")).toBe("allow");
    expect(checkPermission("default", [parseRule("read(*)", "deny")], "read", "a")).toBe("deny");
    expect(
      checkPermission("default", [parseRule("WebFetch(domain:github.com)", "allow")], "webfetch", {
        url: "https://github.com/x/y",
      }),
    ).toBe("allow");
  });
});
