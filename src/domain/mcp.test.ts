import { describe, expect, it } from "vitest";
import { formatMcpInventory, mcpToolName, parseMcpConfig, parseMcpToolName } from "@/domain/mcp.js";

describe("mcp", () => {
  it("namespaces tools as mcp__server__tool", () => {
    expect(mcpToolName("fs", "read")).toBe("mcp__fs__read");
    expect(parseMcpToolName("mcp__fs__read")).toEqual({ server: "fs", tool: "read" });
    expect(parseMcpToolName("read")).toBeUndefined();
  });

  it("parses server configs, skipping invalid entries", () => {
    const defs = parseMcpConfig({
      servers: {
        fs: { transport: "stdio", command: "mcp-fs", args: ["--root", "."] },
        web: { transport: "http", url: "http://x/mcp" },
        bad: { transport: "stdio" },
        worse: { transport: "carrier-pigeon" },
      },
    });

    expect(defs.map((d) => d.name).sort()).toEqual(["fs", "web"]);
    expect(defs.find((d) => d.name === "fs")?.args).toEqual(["--root", "."]);
  });

  it("formats inventory for agent discovery", () => {
    expect(formatMcpInventory([])).toContain("no MCP tools");
    const out = formatMcpInventory([
      { server: "fs", tool: "read", namespaced: "mcp__fs__read", description: "read a file" },
    ]);
    expect(out).toContain("mcp__fs__read: read a file");
  });
});
