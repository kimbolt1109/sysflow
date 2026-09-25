import { describe, expect, it } from "vitest";
import {
  describeToolCall,
  isFailedToolSummary,
  stripToolFences,
  summarizeToolOutput,
} from "@/api/tui/toolLines.js";

describe("toolLines", () => {
  it("hides finished tool fences and keeps the prose", () => {
    const text = 'Let me look.\n```tool:read\n{"path": "a.ts"}\n```\n\n\n\nDone.';

    expect(stripToolFences(text)).toBe("Let me look.\n\nDone.");
  });

  it("cuts off a fence that is still streaming", () => {
    expect(stripToolFences('Checking.\n```tool:bash\n{"comm')).toBe("Checking.");
    expect(stripToolFences("```tool:read\n")).toBe("");
  });

  it("leaves ordinary code fences alone", () => {
    const text = "Use this:\n```ts\nconst a = 1;\n```";

    expect(stripToolFences(text)).toBe(text);
  });

  it("labels calls by their most telling argument", () => {
    expect(describeToolCall("read", { path: "src/config.ts" })).toBe("read src/config.ts");
    expect(describeToolCall("bash", { command: "npm   test\n-- --run" })).toBe(
      "bash npm test -- --run",
    );
    expect(describeToolCall("mcp", {})).toBe("mcp");
    expect(describeToolCall("click", { x: 10, y: 20 })).toBe('click {"x":10,"y":20}');
    expect(describeToolCall("write", { path: "x".repeat(200) }).length).toBeLessThan(90);
  });

  it("summarizes results as counts or first lines", () => {
    expect(summarizeToolOutput("read", "a\nb\nc\n")).toBe("3 lines");
    expect(summarizeToolOutput("grep", "")).toBe("no matches");
    expect(summarizeToolOutput("glob", "a.ts\nb.ts")).toBe("2 matches");
    expect(summarizeToolOutput("write", "wrote a.ts (12 chars)")).toBe("wrote a.ts (12 chars)");
    expect(summarizeToolOutput("bash", "ok\nline2\nline3")).toBe("ok (+2 lines)");
    expect(summarizeToolOutput("read", "denied by policy: read")).toBe("denied by policy: read");
  });

  it("flags failed tool results", () => {
    expect(isFailedToolSummary("denied by policy: bash")).toBe(true);
    expect(isFailedToolSummary("exit 1: boom")).toBe(true);
    expect(isFailedToolSummary("read failed: ENOENT")).toBe(true);
    expect(isFailedToolSummary("3 lines")).toBe(false);
  });
});
