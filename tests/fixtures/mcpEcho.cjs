// Minimal stdio MCP fixture for tests: initialize, tools/list, tools/call(echo).
// Reads newline-delimited JSON-RPC, writes one response line per request.
"use strict";

const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (request.method === "notifications/initialized") return;
  let result = { protocolVersion: "2024-11-05", serverInfo: { name: "echo", version: "0.0.1" } };
  if (request.method === "tools/list") {
    result = { tools: [{ name: "echo", description: "Echoes back input" }] };
  } else if (request.method === "tools/call") {
    const args = request.params && request.params.arguments ? request.params.arguments : {};
    result = { content: [{ type: "text", text: `echo:${JSON.stringify(args)}` }] };
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
