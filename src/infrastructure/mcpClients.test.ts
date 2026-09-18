import { describe, expect, it } from "vitest";
import { McpPool } from "@/infrastructure/mcpClients";

const FIXTURE = "tests/fixtures/mcpEcho.js";

describe("mcpClients", () => {
  it("lists namespaced tools from a stdio server", async () => {
    const pool = new McpPool([
      { name: "echo", transport: "stdio", command: process.execPath, args: [FIXTURE] },
    ]);

    const inventory = await pool.toolInventory();

    expect(inventory).toEqual([
      {
        server: "echo",
        tool: "echo",
        namespaced: "mcp__echo__echo",
        description: "Echoes back input",
      },
    ]);
  });

  it("calls tools and enforces allowlists", async () => {
    const pool = new McpPool(
      [{ name: "echo", transport: "stdio", command: process.execPath, args: [FIXTURE] }],
      new Map([["echo", ["echo"]]]),
    );

    await expect(pool.call("mcp__echo__echo", { x: 1 })).resolves.toContain("echo:");

    const denied = new McpPool(
      [{ name: "echo", transport: "stdio", command: process.execPath, args: [FIXTURE] }],
      new Map([["echo", ["other"]]]),
    );
    await expect(denied.call("mcp__echo__echo", {})).rejects.toThrow("not allowlisted");
    await expect(pool.call("nope", {})).rejects.toThrow("not an mcp tool");
  });
});
