import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HookRunner,
  loadHooks,
  loadProjectHooks,
  loadUserHooks,
} from "@/infrastructure/hookRunner.js";

const NODE = JSON.stringify(process.execPath);

describe("hookRunner", () => {
  it("loads no hooks when settings are absent", () => {
    expect(loadHooks("/nonexistent-data", "/nonexistent-proj")).toEqual([]);
  });

  it("proceeds when no hook matches", async () => {
    const runner = new HookRunner([]);

    await expect(runner.fire("Stop", { session_id: "s" })).resolves.toEqual({
      decision: "proceed",
    });
  });

  it("blocks on exit code 2", async () => {
    const runner = new HookRunner([
      {
        event: "PreToolUse",
        command: `${NODE} -e "process.stderr.write('no'); process.exit(2)"`,
        timeoutMs: 5000,
      },
    ]);

    await expect(runner.fire("PreToolUse", { tool_name: "Bash" })).resolves.toEqual({
      decision: "block",
      reason: "no",
    });
  });

  it("honors stdout JSON decisions", async () => {
    const runner = new HookRunner([
      {
        event: "SessionStart",
        command: `${NODE} -e "process.stdout.write(JSON.stringify({decision:'block',reason:'r'}))"`,
        timeoutMs: 5000,
      },
    ]);

    await expect(runner.fire("SessionStart", {})).resolves.toEqual({
      decision: "block",
      reason: "r",
    });
  });

  describe("user vs project hooks", () => {
    let dir = "";
    let proj = "";

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "flow-hooks-"));
      proj = join(dir, "proj");
      mkdirSync(join(proj, ".flow"), { recursive: true });
      writeFileSync(
        join(dir, "settings.json"),
        JSON.stringify({ hooks: { Stop: "user-cmd" } }),
        "utf8",
      );
      writeFileSync(
        join(proj, ".flow", "settings.json"),
        JSON.stringify({ hooks: { Stop: "project-cmd" } }),
        "utf8",
      );
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("splits user and project hooks for trust gating", () => {
      expect(loadUserHooks(dir).map((h) => h.command)).toEqual(["user-cmd"]);
      expect(loadProjectHooks(proj).map((h) => h.command)).toEqual(["project-cmd"]);
      expect(loadHooks(dir, proj)).toHaveLength(2);
    });
  });
});
