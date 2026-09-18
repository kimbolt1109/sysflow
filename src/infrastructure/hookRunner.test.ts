import { describe, expect, it } from "vitest";
import { HookRunner, loadHooks } from "@/infrastructure/hookRunner";

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
});
