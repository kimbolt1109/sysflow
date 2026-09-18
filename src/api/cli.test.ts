import { describe, expect, it } from "vitest";
import { helpText, parseArgv } from "@/api/cli";

describe("cli", () => {
  it("defaults to the repl", () => {
    expect(parseArgv([]).command).toBe("repl");
  });

  it("parses headless prompts and agents", () => {
    const args = parseArgv(["-p", "fix it", "--agents", "a,b", "--mode", "council"]);

    expect(args.command).toBe("headless");
    expect(args.prompt).toBe("fix it");
    expect(args.agents).toEqual(["a", "b"]);
    expect(args.mode).toBe("council");
  });

  it("parses continue and resume", () => {
    expect(parseArgv(["-c"]).continueLatest).toBe(true);
    expect(parseArgv(["-r"]).resume).toBe("latest");
    expect(parseArgv(["-r", "abc"]).resume).toBe("abc");
  });

  it("parses subcommands and flags", () => {
    expect(parseArgv(["models"]).command).toBe("models");
    expect(parseArgv(["doctor"]).command).toBe("doctor");
    expect(parseArgv(["-y"]).dangerouslySkip).toBe(true);
    expect(parseArgv(["--json"]).outputFormat).toBe("json");
    expect(parseArgv(["--output-format", "stream-json"]).outputFormat).toBe("stream-json");
    expect(parseArgv(["--permission-mode", "plan"]).permissionMode).toBe("plan");
  });

  it("rejects invalid modes", () => {
    expect(() => parseArgv(["--mode", "nope"])).toThrow("--mode must be");
    expect(() => parseArgv(["-p"])).toThrow("missing value");
  });

  it("documents the cli surface", () => {
    expect(helpText()).toContain("flow -p");
  });
});
