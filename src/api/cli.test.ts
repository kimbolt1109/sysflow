import { describe, expect, it } from "vitest";
import { helpText, parseArgv } from "@/api/cli.js";

describe("cli", () => {
  it("defaults to the tui", () => {
    expect(parseArgv([]).command).toBe("tui");
    expect(parseArgv(["repl"]).command).toBe("repl");
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
    expect(parseArgv(["tui"]).command).toBe("tui");
    expect(parseArgv(["repl"]).command).toBe("repl");
    expect(parseArgv(["-y"]).dangerouslySkip).toBe(true);
    expect(parseArgv(["--passthrough"]).passthrough).toBe(true);
    expect(parseArgv([]).passthrough).toBe(false);
    expect(parseArgv(["--json"]).outputFormat).toBe("json");
    expect(parseArgv(["--output-format", "stream-json"]).outputFormat).toBe("stream-json");
    expect(parseArgv(["--permission-mode", "plan"]).permissionMode).toBe("plan");
  });

  it("parses flags after the subcommand", () => {
    const repl = parseArgv(["repl", "-c"]);
    expect(repl.command).toBe("repl");
    expect(repl.continueLatest).toBe(true);

    const resume = parseArgv(["repl", "-r", "abc"]);
    expect(resume.resume).toBe("abc");

    const model = parseArgv(["repl", "--model", "openai/gpt-5"]);
    expect(model.model).toBe("openai/gpt-5");

    const unknown = parseArgv(["wat", "--verbose"]);
    expect(unknown.command).toBe("tui");
    expect(unknown.rest).toEqual(["wat"]);
    expect(unknown.verbose).toBe(true);
  });

  it("rejects invalid modes", () => {
    expect(() => parseArgv(["--mode", "nope"])).toThrow("--mode must be");
    expect(() => parseArgv(["-p"])).toThrow("missing value");
  });

  it("documents the cli surface", () => {
    expect(helpText()).toContain("sys -p");
  });
});
