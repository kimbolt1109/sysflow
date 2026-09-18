import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPermissionRules, saveAlwaysAllow } from "@/infrastructure/permissionStore";

describe("permissionStore", () => {
  let dir = "";
  let data = "";
  let proj = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-perm-"));
    data = join(dir, "data");
    proj = join(dir, "proj");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns no rules when no settings exist", () => {
    expect(loadPermissionRules(data, proj)).toEqual([]);
  });

  it("merges user, project, and local rules with local last", () => {
    mkdirSync(data, { recursive: true });
    mkdirSync(join(proj, ".flow"), { recursive: true });
    writeFileSync(
      join(data, "settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash(*)"] } }),
    );
    writeFileSync(
      join(proj, ".flow", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git commit:*)"] } }),
    );

    const rules = loadPermissionRules(data, proj);

    expect(rules).toEqual([
      { tool: "Bash", pattern: "*", decision: "deny" },
      { tool: "Bash", pattern: "git commit:*", decision: "allow" },
    ]);
  });

  it("persists always-allow rules to settings.local.json", () => {
    saveAlwaysAllow(proj, { tool: "Bash", pattern: "git commit:*", decision: "allow" });

    const rules = loadPermissionRules(data, proj);
    expect(rules).toEqual([{ tool: "Bash", pattern: "git commit:*", decision: "allow" }]);
  });

  it("rejects invalid rule text", () => {
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash"] } }),
    );

    expect(() => loadPermissionRules(data, proj)).toThrow("invalid permission rule");
  });
});
