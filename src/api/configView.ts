import type { FlowApp } from "@/app.js";

export function describeConfig(app: FlowApp, only?: string): string {
  const auth = (present: boolean): string => (present ? "set" : "missing");
  const rows: Record<string, string> = {
    model: app.config.defaultModel,
    logLevel: app.config.logLevel,
    dataDir: app.config.dataDir,
    projectDir: app.config.projectDir,
    workspace: app.tools.rootDir,
    budgets: `daily=${app.config.dailyBudget} max=${app.config.maxCost}`,
    compactThreshold: String(app.config.compactThreshold),
    auth: `anthropic=${auth(app.config.auth.anthropic !== undefined)} openai=${auth(app.config.auth.openai !== undefined)} google=${auth(app.config.auth.google !== undefined)} openrouter=${auth(app.config.auth.openrouter !== undefined)}`,
    extensions: `skills=${app.skills.length} subagents=${app.subagents.length} commands=${app.customCommands.length} mcp=${app.mcp.servers.join(",") || "(none)"}`,
  };
  if (only !== undefined) {
    const value = rows[only];
    return value === undefined ? `unknown key "${only}"` : `${only}=${value}`;
  }
  return Object.entries(rows)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}
