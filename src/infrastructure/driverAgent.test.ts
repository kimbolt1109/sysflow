import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DriverAgent,
  parseScores,
  parseVerifyVerdict,
  readOnlyCheck,
} from "@/infrastructure/driverAgent.js";
import { fetchPageText, htmlToText } from "@/lib/webfetch.js";
import type { McpPort } from "@/domain/mcp.js";
import { MockDriver } from "@/infrastructure/mockDriver.js";
import { LocalTools } from "@/infrastructure/localTools.js";

class ScriptDriver extends MockDriver {
  private readonly script: string[];

  constructor(script: string[]) {
    super("mock/script");
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
    messages: Parameters<MockDriver["streamMessage"]>[0],
    onToken: (token: string) => void,
  ): Promise<{ text: string; usage: { input: number; output: number } }> {
    const result = await this.sendMessage();
    onToken(result.text);
    return result;
  }
}

function scriptFetch(): typeof fetch {
  return (async () =>
    new Response("<html><head><title>t</title></head><body><h1>Hello web</h1></body></html>", {
      headers: { "content-type": "text/html" },
    })) as typeof fetch;
}

async function withTools<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "flow-agent-"));
  try {
    await writeFile(join(dir, "notes.txt"), "the plan mentions notes.txt", "utf8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("driverAgent", () => {
  it("parses JSON score maps", () => {
    expect(parseScores('{"a": {"score": 8, "note": "good"}}')).toEqual({
      a: { score: 8, note: "good" },
    });
  });

  it("returns empty for non-JSON replies", () => {
    expect(parseScores("looks fine to me")).toEqual({});
  });

  it("parses benchmark-style verify verdicts", () => {
    expect(
      parseVerifyVerdict('{"score": 82, "passed": true, "notes": "good", "checks": ["t1", 2]}'),
    ).toEqual({ score: 82, passed: true, notes: "good", checks: ["t1"] });
  });

  it("marks non-JSON verify replies unscored instead of inventing 50%", () => {
    expect(parseVerifyVerdict("looks fine")).toMatchObject({
      unscored: true,
      passed: true,
      checks: [],
      notes: expect.stringContaining("looks fine"),
    });
    expect(parseVerifyVerdict('{"notes": "no number here"}').unscored).toBe(true);
  });

  it("runs planning, critique, and grading read-only; execution may write", async () => {
    const seen: Array<boolean | undefined> = [];
    class RecordingDriver extends MockDriver {
      constructor(private readonly script: string[]) {
        super("mock/recording");
      }
      override async sendMessage(
        _messages?: unknown,
        opts?: { readOnly?: boolean },
      ): Promise<{ text: string; usage: { input: number; output: number } }> {
        seen.push(opts?.readOnly);
        return { text: this.script.shift() ?? "done", usage: { input: 1, output: 1 } };
      }
      override async streamMessage(
        _messages: Parameters<MockDriver["streamMessage"]>[0],
        onToken: (token: string) => void,
        opts?: { readOnly?: boolean },
      ): Promise<{ text: string; usage: { input: number; output: number } }> {
        seen.push(opts?.readOnly);
        const text = this.script.shift() ?? "done";
        onToken(text);
        return { text, usage: { input: 1, output: 1 } };
      }
    }
    await withTools(async (dir) => {
      const agent = new DriverAgent(
        "a",
        new RecordingDriver(["plan", "{}", "merged", "did it", "APPROVE", '{"score": 90}']),
        new LocalTools(dir),
        () => "allow",
      );
      await agent.draft("t");
      await agent.critique("t", [{ agent: "b", plan: "p" }]);
      await agent.synthesize("t", [], []);
      const readOnlyPhases = seen.splice(0);
      await agent.execute("plan");
      const executePhase = seen.splice(0);
      await agent.review("plan", { summary: "s", filesChanged: [] });
      await agent.verify("plan", { summary: "s", filesChanged: [] }, "correctness");

      expect(readOnlyPhases).toEqual([true, true, true]);
      expect(executePhase).toEqual([undefined]);
      expect(seen).toEqual([true, true]);
    });
  });

  it("accepts dressed-up approvals from CLI models", async () => {
    await withTools(async (dir) => {
      const agent = new DriverAgent(
        "a",
        new ScriptDriver(["**APPROVE** — tests pass"]),
        new LocalTools(dir),
        () => "allow",
      );

      expect((await agent.review("p", { summary: "s", filesChanged: [] })).approved).toBe(true);
    });
  });

  it("strips pages to readable text", () => {
    expect(htmlToText("<script>evil()</script><h1>Hi</h1><p>a&nbsp;b &amp; c</p>")).toBe(
      "Hi a b & c",
    );
  });

  it("fetches pages as capped text without network", async () => {
    const text = await fetchPageText("https://example.com/docs", scriptFetch());
    expect(text).toContain("Hello web");
    expect(await fetchPageText("gopher://x", scriptFetch())).toContain("http(s) only");
    expect(await fetchPageText("not a url", scriptFetch())).toContain("http(s) URL");
  });

  it("lets planners explore read-only files before drafting", async () => {
    await withTools(async (dir) => {
      const agent = new DriverAgent("a", new ScriptDriver([]), new LocalTools(dir), () => "deny", {
        fetchFn: scriptFetch(),
      });
      // Denied reads still resolve: the loop reports denial and the plan follows.
      const plan = await agent.draft("write a plan");
      expect(typeof plan).toBe("string");
    });
  });

  it("drafts explore then plan with tools allowed", async () => {
    await withTools(async (dir) => {
      const agent = new DriverAgent(
        "a",
        new ScriptDriver([
          'checking\n```tool:read\n{"path": "notes.txt"}\n```',
          "PLAN: use notes.txt",
        ]),
        new LocalTools(dir),
        () => "allow",
        { fetchFn: scriptFetch() },
      );
      const plan = await agent.draft("write a plan");
      expect(plan).toBe("PLAN: use notes.txt");
    });
  });

  it("grades verdicts after inspecting files", async () => {
    await withTools(async (dir) => {
      const agent = new DriverAgent(
        "a",
        new ScriptDriver([
          'checking\n```tool:read\n{"path": "notes.txt"}\n```',
          '{"score": 80, "passed": true, "notes": "matches", "checks": ["read notes.txt"]}',
        ]),
        new LocalTools(dir),
        () => "allow",
        { fetchFn: scriptFetch() },
      );
      const verdict = await agent.verify(
        "plan",
        { summary: "did it", filesChanged: [] },
        "correctness",
      );
      expect(verdict).toMatchObject({ score: 80, passed: true, notes: "matches" });
    });
  });

  it("rejects after inspection when gaps are found", async () => {
    await withTools(async (dir) => {
      const agent = new DriverAgent(
        "a",
        new ScriptDriver([
          'checking\n```tool:grep\n{"pattern": "test"}\n```',
          "REJECT: no tests cover this",
        ]),
        new LocalTools(dir),
        () => "allow",
        { fetchFn: scriptFetch() },
      );
      const review = await agent.review("plan", { summary: "did it", filesChanged: [] });
      expect(review.approved).toBe(false);
      expect(review.notes).toContain("no tests");
    });
  });

  it("gates grading loops to observe-only tools", () => {
    expect(readOnlyCheck("read", {})).toBe("allow");
    expect(readOnlyCheck("glob", {})).toBe("allow");
    expect(readOnlyCheck("grep", {})).toBe("allow");
    expect(readOnlyCheck("mcp", {})).toBe("allow");
    expect(readOnlyCheck("browse", {})).toBe("allow");
    expect(readOnlyCheck("screenshot", {})).toBe("allow");
    expect(readOnlyCheck("write", {})).toBe("deny");
    expect(readOnlyCheck("bash", {})).toBe("deny");
    expect(readOnlyCheck("click", {})).toBe("deny");
    expect(readOnlyCheck("type", {})).toBe("deny");
  });

  it("lets planners browse the running app before drafting", async () => {
    await withTools(async (dir) => {
      const opened: string[] = [];
      const agent = new DriverAgent(
        "a",
        new ScriptDriver([
          'opening\n```tool:browse\n{"url": "http://localhost:3000"}\n```',
          "PLAN: fix the flow",
        ]),
        new LocalTools(dir),
        () => "allow",
        {
          fetchFn: scriptFetch(),
          openPage: async (url) => {
            opened.push(url);
            return `opened ${url}`;
          },
        },
      );
      const plan = await agent.draft("test the app");
      expect(plan).toBe("PLAN: fix the flow");
      expect(opened).toEqual(["http://localhost:3000"]);
    });
  });

  it("gives spawned subagents MCP and web access", async () => {
    await withTools(async (dir) => {
      const mcpCalls: string[] = [];
      const mcp = {
        servers: ["srv"],
        toolInventory: async () => [],
        call: async (name: string) => {
          mcpCalls.push(name);
          return "mcp-result";
        },
      } as unknown as McpPort;
      const agent = new DriverAgent(
        "lead",
        new ScriptDriver([
          'delegating\n```tool:task\n{"subagent_type": "helper", "prompt": "go"}\n```',
          'using mcp\n```tool:mcp__srv__tool\n{"a": 1}\n```',
          'using web\n```tool:webfetch\n{"url": "https://example.com/x"}\n```',
          "sub done",
          "main done",
        ]),
        new LocalTools(dir),
        () => "allow",
        {
          mcp,
          fetchFn: scriptFetch(),
          subagents: [
            {
              name: "helper",
              description: "help",
              tools: [],
              prompt: "",
              source: "test",
            },
          ],
        },
      );
      const outcome = await agent.execute("do it all");
      expect(outcome.summary).toBe("main done");
      expect(mcpCalls).toEqual(["mcp__srv__tool"]);
    });
  });
});
