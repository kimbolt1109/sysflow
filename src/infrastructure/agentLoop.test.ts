import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseToolFences, runToolLoop, TOOL_SYSTEM } from "@/infrastructure/agentLoop.js";
import { LocalTools } from "@/infrastructure/localTools.js";
import { MockDriver } from "@/infrastructure/mockDriver.js";
import type { ToolResult } from "@/domain/toolDefs.js";

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

  it("routes task fences to subagents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:task\n{"subagent_type": "rev", "prompt": "check it"}\n```',
        "wrapped up",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onTask: async (name, prompt) => `${name}:${prompt}`,
      });

      expect(result.answer).toBe("wrapped up");
      expect(result.transcript.some((m) => m.content === "rev:check it")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes mcp__ fences to MCP tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:mcp__echo__echo\n{"x": 1}\n```',
        "mcp done",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onMcpTool: async (name) => `called ${name}`,
      });

      expect(result.answer).toBe("mcp done");
      expect(result.transcript.some((m) => m.content === "called mcp__echo__echo")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes webfetch fences to the fetcher", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:webfetch\n{"url": "https://example.com/docs"}\n```',
        "researched",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onWebfetch: async (url) => `fetched ${url}`,
      });

      expect(result.answer).toBe("researched");
      expect(result.transcript.some((m) => m.content === "fetched https://example.com/docs")).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects webfetch fences without a url", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", ['```tool:webfetch\n{"url": ""}\n```', "ok"]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onWebfetch: async () => "never",
      });

      expect(result.transcript.some((m) => m.content.includes("webfetch needs"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists MCP tools through the mcp fence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", ["```tool:mcp\n{}\n```", "listed"]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onListMcpTools: async () => "mcp__fs__read",
      });

      expect(result.answer).toBe("listed");
      expect(result.transcript.some((m) => m.content === "mcp__fs__read")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports mcp unavailable without a lister", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", ["```tool:mcp\n{}\n```", "ok"]);

      const result = await runToolLoop(driver, tools, "sys", "task", {});

      expect(result.transcript.some((m) => m.content.includes("mcp unavailable"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes browse fences to the browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:browse\n{"url": "http://localhost:3000"}\n```',
        "walked it",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onBrowse: async (url) => `opened ${url}`,
      });

      expect(result.answer).toBe("walked it");
      expect(result.transcript.some((m) => m.content === "opened http://localhost:3000")).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replays seed turns before the task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", ["seeded answer"]);

      const result = await runToolLoop(driver, tools, "sys", "new task", {
        seed: [
          { role: "user", content: "old task" },
          { role: "assistant", content: "old answer" },
        ],
      });

      expect(result.answer).toBe("seeded answer");
      expect(result.transcript.map((m) => m.content)).toEqual([
        "sys",
        "old task",
        "old answer",
        "new task",
        "seeded answer",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("routes skill fences to skill bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:skill\n{"name": "review"}\n```',
        "used it",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onSkill: async (name) => (name === "review" ? "REVIEW BODY" : undefined),
      });

      expect(result.answer).toBe("used it");
      expect(result.transcript.some((m) => m.content === "REVIEW BODY")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("carries screenshot images onto tool transcript messages", async () => {
    class ShotTools extends LocalTools {
      override async screenshot(): Promise<ToolResult> {
        return { ok: true, output: "screenshot saved", images: ["shot.png"] };
      }
    }
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new ShotTools(dir);
      const driver = new ScriptDriver("mock/loop", ["```tool:screenshot\n{}\n```", "saw it"]);

      const result = await runToolLoop(driver, tools, "sys", "look");

      expect(result.answer).toBe("saw it");
      expect(result.transcript.some((m) => m.images?.includes("shot.png") ?? false)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers unknown skills gracefully", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", ['```tool:skill\n{"name": "nope"}\n```', "ok"]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onSkill: async () => undefined,
      });

      expect(result.transcript.some((m) => m.content.includes('unknown skill "nope"'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes question fences to the asker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:question\n{"question": "which?", "options": ["a", "b"]}\n```',
        "answered",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {
        onQuestion: async (question, options) => `${question}=${options.join("+")}`,
      });

      expect(result.answer).toBe("answered");
      expect(result.transcript.some((m) => m.content === "user answered: which?=a+b")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers questions gracefully without a handler", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:question\n{"question": "q?"}\n```',
        "ok",
      ]);

      const result = await runToolLoop(driver, tools, "sys", "task", {});

      expect(result.transcript.some((m) => m.content.includes("non-interactive"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("asks once for gated tools and honors the answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const fence = '```tool:bash\n{"command": "rm -rf /tmp/x"}\n```';
      const allowDriver = new ScriptDriver("mock/loop", [fence, "did it"]);
      const allowed = await runToolLoop(allowDriver, tools, "sys", "task", {
        check: () => "ask",
        onQuestion: async () => "allow once",
      });
      expect(allowed.transcript.some((m) => m.content.includes("did it"))).toBe(true);

      const denyDriver = new ScriptDriver("mock/loop", [fence, "never"]);
      const denied = await runToolLoop(denyDriver, tools, "sys", "task", {
        check: () => "ask",
        onQuestion: async () => "deny",
      });
      expect(denied.transcript.some((m) => m.content.includes("denied by policy"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("denies gated tools without a handler", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const scriptDriver = new ScriptDriver("mock/loop", [
        '```tool:bash\n{"command": "rm -rf /tmp/x"}\n```',
        "never",
      ]);

      const result = await runToolLoop(scriptDriver, tools, "sys", "task", { check: () => "ask" });

      expect(result.transcript.some((m) => m.content.includes("non-interactive"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fires hook gates around tool calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow-loop-"));
    try {
      const tools = new LocalTools(dir);
      const driver = new ScriptDriver("mock/loop", [
        '```tool:read\n{"path": "nope.txt"}\n```',
        "fell back",
      ]);
      const seen: string[] = [];

      const result = await runToolLoop(driver, tools, "sys", "task", {
        hooks: {
          before: async (name) => {
            seen.push(`before:${name}`);
            return { decision: "proceed" };
          },
          after: async (name) => {
            seen.push(`after:${name}`);
          },
        },
      });

      expect(result.answer).toBe("fell back");
      expect(seen).toEqual(["before:read", "after:read"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
