import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CliDriver,
  cliDialect,
  cliInvocation,
  effortArgs,
  headlessArgs,
  modelArgs,
  type CliDriverDef,
} from "@/infrastructure/cliDrivers.js";
import {
  cliVersion,
  findOnPath,
  isDirectPath,
  quoteCmdArg,
  resolveLaunch,
} from "@/infrastructure/cliLaunch.js";
import { extractCliText } from "@/infrastructure/cliOutput.js";
import { AuthError, DriverError } from "@/lib/errors.js";

const FIXTURE = "tests/fixtures/cliEcho.js";

function driver(extra: Partial<CliDriverDef> = {}): CliDriver {
  return new CliDriver("test/model", {
    command: process.execPath,
    argvPrefix: [FIXTURE],
    ...extra,
  });
}

describe("cliDrivers", () => {
  it("builds per-CLI headless args", () => {
    expect(headlessArgs("claude", "hi", [])).toEqual([
      "-p",
      "hi",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(headlessArgs("codex", "hi", []).slice(0, 2)).toEqual(["exec", "--json"]);
    expect(cliDialect("C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe")).toBe("agy");
    expect(cliDialect("claude")).toBe("claude");
    expect(cliDialect("/usr/local/bin/grok")).toBe("grok");
    expect(cliDialect("C:\\npm\\opencode.CMD")).toBe("opencode");
  });

  it("sends agy prompts over stdin as stream-json, never argv", () => {
    const inv = cliInvocation("agy", 'say "hi"\nline two', {
      extraArgs: ["--dangerously-skip-permissions"],
      cliModel: "gemini-3.8-flash-high",
    });

    expect(inv.args).toEqual([
      "--model",
      "gemini-3.8-flash-high",
      "--dangerously-skip-permissions",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "-p=",
    ]);
    expect(JSON.parse(inv.stdin ?? "")).toEqual({
      event: "user",
      message: { role: "user", content: 'say "hi"\nline two' },
    });
  });

  it("swaps auto-approve flags for read-only modes on read-only calls", () => {
    const agy = cliInvocation("agy", "p", {
      extraArgs: ["--dangerously-skip-permissions"],
      readOnly: true,
    });
    expect(agy.args).not.toContain("--dangerously-skip-permissions");
    // agy's --mode plan executes its plan in print mode, so it is never used
    expect(agy.args).not.toContain("--mode");

    const claude = cliInvocation("claude", "p", {
      extraArgs: ["--dangerously-skip-permissions", "--permission-mode", "bypassPermissions"],
      readOnly: true,
    });
    expect(claude.args).not.toContain("--dangerously-skip-permissions");
    expect(claude.args).not.toContain("bypassPermissions");
    expect(claude.args.join(" ")).toContain("--permission-mode plan");

    const grok = cliInvocation("grok", "p", { extraArgs: ["--always-approve"], readOnly: true });
    expect(grok.args).not.toContain("--always-approve");

    const writer = cliInvocation("agy", "p", { extraArgs: ["--dangerously-skip-permissions"] });
    expect(writer.args).toContain("--dangerously-skip-permissions");
  });

  it("maps thinking level to CLI effort flags", () => {
    expect(effortArgs("agy", "high", "gemini-3.1-pro")).toEqual(["--effort", "high"]);
    expect(effortArgs("agy", "xhigh")).toEqual(["--effort", "high"]);
    expect(effortArgs("agy", "low", "gemini-3.8-flash-high")).toEqual([]);
    expect(effortArgs("claude", "xhigh")).toEqual(["--effort", "xhigh"]);
    expect(effortArgs("opencode", "high")).toEqual([]);
    expect(effortArgs("agy", undefined)).toEqual([]);
  });

  it("builds per-CLI --model flags", () => {
    expect(modelArgs("claude", "claude-sonnet-4-6")).toEqual(["--model", "claude-sonnet-4-6"]);
    expect(modelArgs("codex", "gpt-5")).toEqual(["-m", "gpt-5"]);
    expect(modelArgs("grok", "grok-4.6")).toEqual(["-m", "grok-4.6"]);
    expect(modelArgs("agy", "gemini-3.8-flash-high")).toEqual(["--model", "gemini-3.8-flash-high"]);
    expect(modelArgs("claude", undefined)).toEqual([]);
    expect(modelArgs("claude", "")).toEqual([]);
  });

  it("detects direct paths and PATH binaries", () => {
    expect(isDirectPath(process.execPath)).toBe(true);
    expect(isDirectPath("claude")).toBe(false);
    expect(findOnPath("definitely-not-a-real-binary-xyz")).toBeUndefined();
  });

  it("sends prompts to the subprocess and extracts text", async () => {
    const result = await driver().sendMessage([{ role: "user", content: "hello" }]);
    expect(result.text).toContain("answer to hello");
    expect(result.usage.input).toBeGreaterThan(0);
  });

  it("streams partial JSON lines to onToken", async () => {
    const tokens: string[] = [];
    const result = await driver().streamMessage([{ role: "user", content: "hi" }], (t) =>
      tokens.push(t),
    );

    expect(result.text).toContain("answer to hi");
    expect(tokens.join("")).toContain("answer to hi");
  });

  it("sends the system prompt and history, not just the last message", async () => {
    const result = await driver().sendMessage([
      { role: "system", content: "Reply ONLY as JSON." },
      { role: "user", content: "my name is Ada" },
      { role: "assistant", content: "Hi Ada" },
      { role: "user", content: "what is my name?" },
    ]);

    expect(result.text).toContain("Reply ONLY as JSON.");
    expect(result.text).toContain("my name is Ada");
    expect(result.text).toContain("what is my name?");
  });

  it("keeps quotes and newlines intact in argv prompts", async () => {
    const result = await driver({ argvPrefix: [FIXTURE, "raw"] }).sendMessage([
      { role: "user", content: 'say "hi there" {"path": "a b.ts"}\nline two' },
    ]);

    expect(result.text).toContain('say "hi there" {"path": "a b.ts"}');
    expect(result.text).toContain("line two");
  });

  it("launches npm .cmd shims directly so prompts survive quoting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shim-"));
    mkdirSync(join(dir, "node_modules", "echo"), { recursive: true });
    copyFileSync(FIXTURE, join(dir, "node_modules", "echo", "cli.js"));
    writeFileSync(
      join(dir, "echo.cmd"),
      '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\echo\\cli.js" %*\r\n',
    );
    const shimmed = new CliDriver("test/model", {
      command: join(dir, "echo.cmd"),
      argvPrefix: ["raw"],
      dialect: "generic",
    });

    const result = await shimmed.sendMessage([{ role: "user", content: 'quote "me" please' }]);

    expect(result.text).toContain('quote "me" please');
  });

  it("streams agy deltas over stdin and reports its real usage", async () => {
    const agy = driver({ argvPrefix: [FIXTURE, "agy"], dialect: "agy" });
    const tokens: string[] = [];

    const result = await agy.streamMessage(
      [
        { role: "system", content: "sys rules" },
        { role: "user", content: 'fix "it"\nplease' },
      ],
      (t) => tokens.push(t),
    );

    expect(tokens.length).toBe(2);
    expect(tokens.join("")).toBe(result.text);
    expect(result.text).toContain("sys rules");
    expect(result.text).toContain('fix "it"\nplease');
    expect(result.usage).toEqual({ input: 42, output: 7 });
  });

  it("runs agy read-only calls without auto-approval and with a read-only notice", async () => {
    const agy = driver({
      argvPrefix: [FIXTURE, "agy"],
      dialect: "agy",
      extraArgs: ["--dangerously-skip-permissions"],
    });

    const writer = await agy.sendMessage([{ role: "user", content: "x" }]);
    const reader = await agy.sendMessage([{ role: "user", content: "x" }], { readOnly: true });

    expect(writer.text).toContain("--dangerously-skip-permissions");
    expect(writer.text).not.toContain("READ-ONLY RUN");
    expect(reader.text).not.toContain("--dangerously-skip-permissions");
    expect(reader.text).toContain("READ-ONLY RUN");
  });

  it("turns agy ERROR results into driver errors", async () => {
    const agy = driver({ argvPrefix: [FIXTURE, "agy-error"], dialect: "agy" });

    await expect(agy.sendMessage([{ role: "user", content: "x" }])).rejects.toThrow(
      "quota exhausted",
    );
  });

  it("reports CLI failures", async () => {
    const failing = driver({ argvPrefix: [FIXTURE, "fail"] });

    await expect(failing.sendMessage([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      DriverError,
    );
  });

  it("rejects missing binaries", async () => {
    const missing = new CliDriver("test/model", { command: "definitely-not-a-real-binary-xyz" });

    expect((await missing.healthCheck()).ok).toBe(false);
    await expect(missing.sendMessage([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("times out hung subprocesses", async () => {
    const slow = driver({ argvPrefix: [FIXTURE, "slow"], timeoutMs: 500 });

    await expect(slow.sendMessage([{ role: "user", content: "x" }])).rejects.toThrow("timed out");
  });

  it("names the model in timeout errors", async () => {
    const slow = driver({ argvPrefix: [FIXTURE, "slow"], timeoutMs: 500 });

    await expect(slow.sendMessage([{ role: "user", content: "x" }])).rejects.toThrow("test/model");
  });

  it("reads versions", () => {
    expect(cliVersion(process.execPath)).toContain("v");
    expect(cliVersion("definitely-not-a-real-binary-xyz")).toBeUndefined();
  });

  it("resolves launches without a shell", () => {
    expect(resolveLaunch("definitely-not-a-real-binary-xyz", ["--version"])).toEqual({
      file: "definitely-not-a-real-binary-xyz",
      argv: ["--version"],
    });
    const node = resolveLaunch(process.execPath, ["--version"]);
    expect(node.file.toLowerCase()).toContain("node");
    expect(quoteCmdArg("it's")).toBe("'it''s'");
  });

  it("extracts the answer from agy-style json envelopes", () => {
    const envelope = JSON.stringify({
      conversation_id: "f600d235",
      status: "SUCCESS",
      response: "APPROVE: all good",
      duration_seconds: 60.5,
      num_turns: 1,
      usage: { input_tokens: 131101, output_tokens: 6879 },
    });

    expect(extractCliText(`${envelope}\n`)).toBe("APPROVE: all good");
  });

  it("extracts text from pretty-printed multi-line json", () => {
    const stdout = ["{", '  "status": "SUCCESS",', '  "response": "done deal"', "}"].join("\n");

    expect(extractCliText(stdout)).toBe("done deal");
  });

  it("keeps plain-text answers untouched", () => {
    expect(extractCliText("just an answer\n")).toBe("just an answer");
  });
});
