export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerDef {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
  const match = name.match(/^mcp__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/);
  if (match === null) return undefined;
  return { server: match[1] as string, tool: match[2] as string };
}

export interface McpToolInfo {
  server: string;
  tool: string;
  namespaced: string;
  description: string;
}

export interface McpPort {
  readonly servers: string[];
  toolInventory(): Promise<McpToolInfo[]>;
  call(namespaced: string, args: unknown): Promise<string>;
  isAllowed(server: string, tool: string): boolean;
}

/** Render tool inventory for agent discovery (call one as mcp__server__tool). */
export function formatMcpInventory(tools: McpToolInfo[], cap = 50): string {
  if (tools.length === 0) return "no MCP tools available (no servers configured or none exposed)";
  const shown = tools.slice(0, Math.max(1, Math.floor(cap)));
  const lines = shown.map((t) => {
    const desc = t.description.trim().replace(/\s+/g, " ");
    const clipped = desc.length > 150 ? `${desc.slice(0, 150)}…` : desc;
    return `- ${t.namespaced}: ${clipped}`;
  });
  const extra = tools.length > shown.length ? `\n… and ${tools.length - shown.length} more` : "";
  return `Available MCP tools (call one as mcp__server__tool):\n${lines.join("\n")}${extra}`;
}

export function parseMcpConfig(value: unknown): McpServerDef[] {
  if (typeof value !== "object" || value === null) return [];
  const servers = (value as Record<string, unknown>).servers;
  if (typeof servers !== "object" || servers === null) return [];
  const defs: McpServerDef[] = [];
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const transport = r.transport;
    if (transport !== "stdio" && transport !== "http" && transport !== "sse") continue;
    const def: McpServerDef = { name, transport };
    if (typeof r.command === "string") def.command = r.command;
    if (Array.isArray(r.args)) {
      const args = r.args.filter((a): a is string => typeof a === "string");
      def.args = args;
    }
    if (typeof r.url === "string") def.url = r.url;
    if (transport === "stdio" && def.command === undefined) continue;
    if (transport !== "stdio" && def.url === undefined) continue;
    defs.push(def);
  }
  return defs;
}
