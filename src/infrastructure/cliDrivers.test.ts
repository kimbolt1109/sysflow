import { describe, expect, it } from "vitest";
import {
  CliDriver,
  cliVersion,
  extractCliText,
  findOnPath,
  headlessArgs,
  isDirectPath,
  modelArgs,
  quoteCmdArg,
  resolveLaunch,
  type CliDriverDef,
} from "@/infrastructure/cliDrivers.js";
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
    expect(headlessArgs("agy", "hi", ["--yolo"])).toEqual([
      "-p",
      "hi",
      "--output-format",
      "json",
      "--yolo",
    ]);
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
