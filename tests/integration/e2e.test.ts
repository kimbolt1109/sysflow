import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CouncilSession } from "@/api/council.js";
import { createApp } from "@/app.js";
import { loadConfig } from "@/config.js";
import { DriverAgent } from "@/infrastructure/driverAgent.js";
import { MockDriver } from "@/infrastructure/mockDriver.js";

// Full-stack harness: a scripted driver behind the real DriverAgent + tool
// loop, running inside a temp git repo. Proves headless council tasks change
// files and leave phase records in the session log.
class ScriptDriver extends MockDriver {
  private readonly script: string[];

  constructor(script: string[]) {
    super("mock/e2e");
    this.script = [...script];
  }

  override async sendMessage(): Promise<{
    text: string;
    usage: { input: number; output: number };
  }> {
    const text = this.script.shift() ?? "done";
    return { text, usage: { input: 1, output: this.countTokens(text) } };
  }

  override async streamMessage(
    _messages: Parameters<MockDriver["streamMessage"]>[0],
    onToken: (token: string) => void,
  ): Promise<{ text: string; usage: { input: number; output: number } }> {
    const result = await this.sendMessage();
    onToken(result.text);
    return result;
  }
}

describe("e2e", () => {
  let dir = "";
  let proj = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-e2e-"));
    proj = join(dir, "repo");
    mkdirSync(proj, { recursive: true });
    execFileSync("git", ["init"], { cwd: proj });
    execFileSync("git", ["config", "user.email", "e2e@flow"], { cwd: proj });
    execFileSync("git", ["config", "user.name", "e2e"], { cwd: proj });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a headless council task that changes files in a git repo", async () => {
    const config = loadConfig(
      { APP_DATA_DIR: join(dir, "data"), APP_LOG_LEVEL: "error" },
      { cwd: proj },
    );
    const app = createApp(config);
    const driver = new ScriptDriver([
      'creating the file\n```tool:write\n{"path": "hello.txt", "content": "hello e2e"}\n```',
      "all set",
    ]);
    const session = new CouncilSession(
      [new DriverAgent("mock/e2e", driver, app.tools, () => "allow")],
      (record) => app.sessions.append("e2e-session", record),
    );
    const lines: string[] = [];

    const result = await session.run("create hello.txt", (line) => lines.push(line));

    expect(result.text).toContain("all set");
    expect((await app.tools.read("hello.txt")).output).toBe("hello e2e");
    const phases = result.sessionRecords
      .map((r) => (r as { phase?: string }).phase)
      .filter((p): p is string => typeof p === "string");
    expect(phases).toContain("EXECUTION");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: proj, encoding: "utf8" });
    expect(status).toContain("hello.txt");
  });
});
