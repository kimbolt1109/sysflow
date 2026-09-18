import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseToolFences, runToolLoop, TOOL_SYSTEM } from "@/infrastructure/agentLoop";
import { LocalTools } from "@/infrastructure/localTools";
import { MockDriver } from "@/infrastructure/mockDriver";

class ScriptDriver extends MockDriver {
  constructor(
    id: string,
    private readonly script: string[],
  ) {
    super(id);
  }

  override async sendMessage(): Promise<{
    text: string;
    usage: { input: number; output: number };
  }> {
    const text = this.script.shift() ?? "done";
    return { text, usage: { input: 1, output: this.countTokens(text) } };
  }

  override async streamMessage(
    messages: Parameters<MockDriver["streamMessage"]>[0],
    onToken: (token: string) => void,
  ): Promise<{ text: string; usage: { input: number; output: number } }> {
    const result = await this.sendMessage();
    onToken(result.text);
    return result;
  }
}

describe("agentLoop", () => {
  it("parses tool fences", () => {
    const calls = parseToolFences(
      'hi\n```tool:read\n{"path": "a.ts"}\n```\n```tool:bogus\n{}\n```',
    );

    expect(calls).toEqual([{ name: "read", input: { path: "a.ts" } }]);
  });

  it("documents the tool format", () => {
    expect(TOOL_SYSTEM).toContain("tool:write");
  });

  it("executes fences and feeds results back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        'creating\n```tool:write\n{"path": "out.txt", "content": "hey"}\n```',
        "all set",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "make out.txt");

      expect(result.answer).toBe("all set");
      expect(result.filesChanged).toEqual(["out.txt"]);
      expect(result.turns).toBe(2);
      expect((await tools.read("out.txt")).output).toBe("hey");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("denies tools when the check says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:write\n{"path": "x.txt", "content": "no"}\n```',
        "ok",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", { check: () => "deny" });

      expect(result.filesChanged).toEqual([]);
      expect(result.transcript.some((m) => m.content.includes("denied by policy"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
