import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgv } from "@/api/cli";
import { formatHeadless, runHeadless } from "@/api/headless";
import { createApp } from "@/app";
import { loadConfig } from "@/config";
import type { Driver } from "@/domain/drivers";
import { matchRouting } from "@/domain/routing";
import { MockDriver } from "@/infrastructure/mockDriver";

describe("cli integration", () => {
  let dir = "";
  let proj = "";
  let data = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-cli-"));
    proj = join(dir, "proj");
    data = join(dir, "data");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a headless prompt through the app factory and logs the session", async () => {
    const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });
    const app = createApp(config, { driver: new MockDriver("mock/test") });

    const result = await runHeadless(app, parseArgv(["-p", "hello"]), () => {});

    expect(result.text).toBe("mock:hello");
    expect(result.model).toBe(config.defaultModel);
    const log = app.sessions.load(result.sessionId);
    expect(log).toHaveLength(2);
  });

  it("emits stream-json tokens and formats json output", async () => {
    const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });
    const app = createApp(config, { driver: new MockDriver("mock/test") });
    const emitted: string[] = [];

    const result = await runHeadless(
      app,
      parseArgv(["-p", "hi", "--output-format", "stream-json"]),
      (line) => emitted.push(line),
    );

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.every((line) => JSON.parse(line).type === "token")).toBe(true);
    const formatted = JSON.parse(formatHeadless(result, parseArgv(["--json"]))) as {
      result: string;
    };
    expect(formatted.result).toBe("mock:hi");
  });

  it("routes gemini models to agy by default", () => {
    const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });

    expect(matchRouting(config.routing, "google/gemini-pro").command).toBe("agy");
  });

  it("reads and writes files through app tools", async () => {
    const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });
    const app = createApp(config, { driver: new MockDriver("mock/test") });

    expect((await app.tools.write("note.txt", "hello")).ok).toBe(true);
    expect((await app.tools.read("note.txt")).output).toBe("hello");
  });

  it("records usage cost and enforces --max-cost", async () => {
    const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });
    config.defaultModel = "anthropic/claude-sonnet";
    const mock = new MockDriver("mock/big");
    const pricey: Driver = {
      id: mock.id,
      kind: mock.kind,
      countTokens: (text) => mock.countTokens(text),
      getQuota: () => mock.getQuota(),
      healthCheck: () => mock.healthCheck(),
      sendMessage: async () => ({ text: "big", usage: { input: 1_000_000, output: 0 } }),
      streamMessage: async () => ({ text: "big", usage: { input: 1_000_000, output: 0 } }),
    };
    const app = createApp(config, { driver: pricey });

    const result = await runHeadless(app, parseArgv(["-p", "hi"]), () => {}, undefined, {
      notify: false,
    });

    expect(result.cost).toBeCloseTo(3);
    expect(
      app.dailyUsage().providers[Object.keys(app.dailyUsage().providers)[0] as string]?.cost,
    ).toBeCloseTo(3);

    await expect(
      runHeadless(app, parseArgv(["-p", "hi", "--max-cost", "1"]), () => {}, undefined, {
        notify: false,
      }),
    ).rejects.toThrow("exceeded --max-cost");
  });
});
