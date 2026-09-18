import { describe, expect, it } from "vitest";
import {
  CliDriver,
  cliVersion,
  findOnPath,
  headlessArgs,
  isDirectPath,
  quoteCmdArg,
  resolveLaunch,
  type CliDriverDef,
} from "@/infrastructure/cliDrivers";
import { AuthError, DriverError } from "@/lib/errors";

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
});
