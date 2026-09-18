import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CouncilSession } from "@/api/council";
import { createApp } from "@/app";
import { loadConfig } from "@/config";
import { runCouncil, type ExecuteOutcome, type Orchestrant, type Review } from "@/domain/orchestrator";

class ScriptAgent implements Orchestrant {
  constructor(
    readonly name: string,
    private readonly score: number,
  ) {}

  async draft(): Promise<string> {
    return `${this.name} plan`;
  }

  async critique(): Promise<Record<string, { score: number; note: string }>> {
    return {};
  }

  async synthesize(task: string): Promise<string> {
    return `final plan for ${task}`;
  }

  async execute(): Promise<ExecuteOutcome> {
    return { summary: `${this.name} executed`, filesChanged: [] };
  }

  async review(): Promise<Review> {
    return { approved: true, notes: "lgtm" };
  }

  async retro(): Promise<string> {
    return `${this.name} retro`;
  }
}

describe("council e2e", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-council-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("drives fan-out to retro with phases in the session log", async () => {
    const config = loadConfig(
      { APP_DATA_DIR: join(dir, "data"), APP_LOG_LEVEL: "error" },
      { cwd: join(dir, "proj") },
    );
    const app = createApp(config);
    const sessionId = "council-e2e";
    const agents = [new ScriptAgent("a", 9), new ScriptAgent("b", 6)];

    const result = await runCouncil(agents, "ship it", {
      emit: (e) => app.sessions.append(sessionId, { type: "council-event", ...e }),
    });
    app.sessions.append(sessionId, { type: "council-end", lead: result.lead });

    const phases = app.sessions
      .load(sessionId)
      .map((r) => (r as { phase?: string }).phase)
      .filter((p): p is string => typeof p === "string");
    for (const want of ["PLANNING", "DEBATE", "SYNTHESIS", "EXECUTION", "REVIEW", "DONE"]) {
      expect(phases).toContain(want);
    }
    expect(result.lead).toBe("a");
  });

  it("runs a council session headlessly with mock agents", async () => {
    const session = new CouncilSession([new ScriptAgent("a", 9), new ScriptAgent("b", 6)]);
    const lines: string[] = [];

    const result = await session.run("do the thing", (line) => lines.push(line));

    expect(result.text).toContain("retro:");
    expect(result.sessionRecords.length).toBeGreaterThan(5);
    expect(lines.join("\n")).toContain("SYNTHESIS");
  });
});
