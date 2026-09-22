import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMcpConfig, type McpPort, type McpServerDef, type McpToolInfo } from "@/domain/mcp.js";

interface JsonRpcResponse {
  id: number;
  result?: { tools?: Array<{ name?: unknown; description?: unknown }> };
  error?: { message?: unknown };
}

function httpCall(def: McpServerDef, method: string, params: unknown): Promise<JsonRpcResponse> {
  const url = def.url ?? "";
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`mcp ${def.name} http ${res.status}`);
    return (await res.json()) as JsonRpcResponse;
  });
}

function stdioCall(
  def: McpServerDef,
  calls: Array<{ method: string; params: unknown }>,
): Promise<JsonRpcResponse[]> {
  return new Promise((resolvePromise, reject) => {
    if (def.command === undefined) {
      reject(new Error(`mcp ${def.name} needs a command`));
      return;
    }
    const child = spawn(def.command, def.args ?? [], { stdio: ["pipe", "pipe", "inherit"] });
    const results: JsonRpcResponse[] = [];
    let buffer = "";
    let nextId = 1;
    const queue = [
      {
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "flow", version: "0.1.0" },
        },
      },
      ...calls,
    ].map((call) => ({ ...call, id: nextId++ }));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mcp ${def.name} timed out`));
    }, 15000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
          results.push(JSON.parse(trimmed) as JsonRpcResponse);
        } catch {
          continue;
        }
        if (results.length >= queue.length) {
          clearTimeout(timer);
          child.kill();
          resolvePromise(results);
        }
      }
    });
    const payload = queue
      .map((call) =>
        JSON.stringify({ jsonrpc: "2.0", id: call.id, method: call.method, params: call.params }),
      )
      .join("\n");
    const handshake = `${JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "notifications/initialized",
    })}\n`;
    child.stdin.write(`${payload}\n${handshake}`);
    child.stdin.end();
  });
}

export class McpPool implements McpPort {
  private inventory: McpToolInfo[] | undefined;

  constructor(
    private readonly defs: McpServerDef[],
    private readonly allowlist: Map<string, string[]> = new Map(),
  ) {}

  get servers(): string[] {
    return this.defs.map((d) => d.name);
  }

  async toolInventory(): Promise<McpToolInfo[]> {
    if (this.inventory !== undefined) return this.inventory;
    const found: McpToolInfo[] = [];
    for (const def of this.defs) {
      try {
        const tools = await this.listServerTools(def);
        for (const tool of tools) {
          found.push({
            server: def.name,
            tool: tool.name,
            namespaced: `mcp__${def.name}__${tool.name}`,
            description: tool.description,
          });
        }
      } catch {
        continue;
      }
    }
    this.inventory = found;
    return found;
  }

  private async listServerTools(
    def: McpServerDef,
  ): Promise<Array<{ name: string; description: string }>> {
    if (def.transport === "stdio") {
      const [, response] = await stdioCall(def, [{ method: "tools/list", params: {} }]);
      return toolsOf(response);
    }
    const response = await httpCall(def, "tools/list", {});
    return toolsOf(response);
  }

  isAllowed(server: string, tool: string): boolean {
    const allowed = this.allowlist.get(server) ?? this.allowlist.get("*");
    if (allowed === undefined) return true;
    return allowed.includes("*") || allowed.includes(tool);
  }

  async call(namespaced: string, args: unknown): Promise<string> {
    const match = namespaced.match(/^mcp__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/);
    if (match === null) throw new Error(`not an mcp tool: ${namespaced}`);
    const server = match[1] as string;
    const tool = match[2] as string;
    if (!this.isAllowed(server, tool)) throw new Error(`mcp tool ${namespaced} is not allowlisted`);
    const def = this.defs.find((d) => d.name === server);
    if (def === undefined) throw new Error(`unknown mcp server: ${server}`);
    const params = { name: tool, arguments: (args ?? {}) as Record<string, unknown> };
    if (def.transport === "stdio") {
      const [, response] = await stdioCall(def, [{ method: "tools/call", params }]);
      return textOf(response);
    }
    return textOf(await httpCall(def, "tools/call", params));
  }
}

function toolsOf(
  response: JsonRpcResponse | undefined,
): Array<{ name: string; description: string }> {
  const tools = response?.result?.tools;
  if (!Array.isArray(tools)) return [];
  const out: Array<{ name: string; description: string }> = [];
  for (const tool of tools) {
    if (typeof tool.name === "string") {
      out.push({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
      });
    }
  }
  return out;
}

function textOf(response: JsonRpcResponse | undefined): string {
  const result = response?.result as
    { content?: Array<{ type?: unknown; text?: unknown }> } | undefined;
  if (result?.content === undefined) {
    if (response?.error !== undefined)
      throw new Error(`mcp error: ${String(response.error.message ?? "unknown")}`);
    return "(empty result)";
  }
  return result.content.map((block) => (typeof block.text === "string" ? block.text : "")).join("");
}

function readMcpFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`invalid JSON in ${path}`);
  }
}

export function mcpUserPath(dataDir: string): string {
  return join(dataDir, "mcp.json");
}

export function loadMcpConfig(dataDir: string, projectDir: string): McpServerDef[] {
  const user = parseMcpConfig(readMcpFile(mcpUserPath(dataDir)));
  const project = parseMcpConfig(readMcpFile(join(projectDir, ".flow", "mcp.json")));
  const names = new Set(project.map((d) => d.name));
  return [...project, ...user.filter((d) => !names.has(d.name))];
}

export function saveMcpServer(dataDir: string, def: McpServerDef): void {
  const path = mcpUserPath(dataDir);
  const raw = readMcpFile(path);
  const servers =
    typeof raw === "object" && raw !== null
      ? (((raw as Record<string, unknown>).servers as Record<string, unknown> | undefined) ?? {})
      : {};
  const entry: Record<string, unknown> = { transport: def.transport };
  if (def.command !== undefined) entry.command = def.command;
  if (def.args !== undefined) entry.args = def.args;
  if (def.url !== undefined) entry.url = def.url;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ servers: { ...servers, [def.name]: entry } }, null, 2)}\n`,
    "utf8",
  );
}

export function removeMcpServer(dataDir: string, name: string): boolean {
  const path = mcpUserPath(dataDir);
  const raw = readMcpFile(path);
  if (typeof raw !== "object" || raw === null) return false;
  const servers = (raw as Record<string, unknown>).servers;
  if (typeof servers !== "object" || servers === null) return false;
  const record = servers as Record<string, unknown>;
  if (!(name in record)) return false;
  delete record[name];
  writeFileSync(path, `${JSON.stringify({ ...raw, servers: record }, null, 2)}\n`, "utf8");
  return true;
}
