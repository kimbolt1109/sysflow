import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Config } from "@/config";
import type { CustomCommand } from "@/domain/commands";
import type { DoctorCheck } from "@/domain/doctor";
import type { Driver } from "@/domain/drivers";
import type { HooksPort } from "@/domain/hooks";
import type { McpPort } from "@/domain/mcp";
import type { QuotaInfo } from "@/domain/models";
import { buildMemoryBlock } from "@/domain/memory";
import type { Checkpoint } from "@/domain/checkpoints";
import { takeCheckpoint as takeCheckpointData } from "@/domain/checkpoints";
import type { PermissionRule } from "@/domain/permissions";
import { budgetLevel, costFor, type BudgetLevel } from "@/domain/quota";
import { findModel } from "@/domain/modelRegistry";
import { matchRouting } from "@/domain/routing";
import type { SkillDef } from "@/domain/skills";
import type { SubagentDef } from "@/domain/subagents";
import type { ToolsPort } from "@/domain/toolDefs";
import { runToolLoop, TOOL_SYSTEM, type ToolCheck } from "@/infrastructure/agentLoop";
import {
  checkpointDir,
  listCheckpoints,
  restoreCheckpoint,
  saveCheckpoint,
  snapshotWorkspace,
} from "@/infrastructure/checkpointStore";
import { CliDriver, cliVersion, findOnPath } from "@/infrastructure/cliDrivers";
import { discoverCommands } from "@/infrastructure/commandStore";
import { DriverAgent } from "@/infrastructure/driverAgent";
import { HookRunner, loadHooks } from "@/infrastructure/hookRunner";
import { probeKeychain } from "@/infrastructure/keychain";
import { LocalTools } from "@/infrastructure/localTools";
import { loadMcpConfig, McpPool } from "@/infrastructure/mcpClients";
import { notify } from "@/infrastructure/notifier";
import {
  findLegacyImport,
  importOfferedMarker,
  loadMemoryFiles,
  writeProjectMemory,
} from "@/infrastructure/memoryStore";
import { MockDriver } from "@/infrastructure/mockDriver";
import { AnthropicDriver } from "@/infrastructure/nativeAnthropic";
import { GoogleDriver } from "@/infrastructure/nativeGoogle";
import {
  createOllamaDriver,
  createOpenaiDriver,
  createOpenrouterDriver,
} from "@/infrastructure/openaiCompat";
import { SessionStore } from "@/infrastructure/sessionStore";
import { discoverSkills, loadSkillBody } from "@/infrastructure/skillStore";
import { discoverSubagents } from "@/infrastructure/subagentStore";
import { loadPermissionRules, saveRule } from "@/infrastructure/permissionStore";
import {
  dailyTotals,
  loadDailyUsage,
  recordProviderUsage,
  type DailyUsage,
} from "@/infrastructure/usageStore";
import { createLogger, type Logger } from "@/lib/logger";

export interface MemoryFile {
  path: string;
  content: string;
}

export interface FlowApp {
  config: Config;
  logger: Logger;
  driver: Driver;
  tools: ToolsPort;
  sessions: SessionStore;
  hooks: HooksPort;
  skills: SkillDef[];
  subagents: SubagentDef[];
  customCommands: CustomCommand[];
  memory: string;
  memoryFiles: MemoryFile[];
  legacyImport?: string;
  rules: PermissionRule[];
  mcp: McpPort;
  skillBody(name: string): string | undefined;
  initMemory(): { path: string; imported?: string };
  importOffered(): boolean;
  markImportOffered(): void;
  savePermissionRule(rule: PermissionRule): void;
  editPath(path: string, editor: string): void;
  runSubagent(name: string, prompt: string, emit?: (text: string) => void): Promise<string>;
  recordUsage(provider: string, modelId: string, input: number, output: number): UsageRecord;
  dailyUsage(): DailyUsage;
  quotaFor(modelId: string): Promise<QuotaInfo>;
  notifyUser(title: string, body: string): void;
  takeCheckpoint(sessionId: string, label: string): Promise<Checkpoint>;
  listCheckpoints(sessionId: string): Checkpoint[];
  restoreCheckpoint(sessionId: string, id: string): Promise<string[]>;
  diagnose(): Promise<DoctorCheck[]>;
}

export interface UsageRecord {
  cost: number;
  dailyCost: number;
  level: BudgetLevel;
}

function nativeDriverFor(config: Config, fetchFn?: typeof fetch): Driver | undefined {
  const provider = config.defaultModel.split("/")[0] ?? "";
  if (provider === "anthropic" && config.auth.anthropic !== undefined) {
    return new AnthropicDriver({
      apiKey: config.auth.anthropic,
      model: config.defaultModel,
      fetchFn,
    });
  }
  if (provider === "openai" && config.auth.openai !== undefined) {
    return createOpenaiDriver(config.defaultModel, config.auth.openai, fetchFn);
  }
  if (provider === "google" && config.auth.google !== undefined) {
    return new GoogleDriver({ apiKey: config.auth.google, model: config.defaultModel, fetchFn });
  }
  if (provider === "openrouter" && config.auth.openrouter !== undefined) {
    return createOpenrouterDriver(config.defaultModel, config.auth.openrouter, fetchFn);
  }
  if (provider === "ollama") {
    return createOllamaDriver(config.defaultModel, config.ollamaBaseUrl, fetchFn);
  }
  return undefined;
}

export function cliDriverFor(config: Config, modelId?: string): Driver | undefined {
  const id = modelId ?? config.defaultModel;
  const rule = matchRouting(config.routing, id);
  if (
    rule.driver === "cli" &&
    rule.command !== undefined &&
    findOnPath(rule.command) !== undefined
  ) {
    return new CliDriver(id, { command: rule.command, extraArgs: rule.args });
  }
  return undefined;
}

export function createDriverFor(config: Config, modelId: string, fetchFn?: typeof fetch): Driver {
  const scoped: Config = { ...config, defaultModel: modelId };
  const native = nativeDriverFor(scoped, fetchFn);
  if (native !== undefined) return native;
  const rule = matchRouting(config.routing, modelId);
  if (
    rule.driver === "cli" &&
    rule.command !== undefined &&
    findOnPath(rule.command) !== undefined
  ) {
    return new CliDriver(modelId, { command: rule.command, extraArgs: rule.args });
  }
  return new MockDriver(`${modelId} (mock: no key and no CLI found)`);
}

export function contextPrefixFor(memory: string, skills: SkillDef[]): string {
  const parts: string[] = [];
  if (memory.trim() !== "") parts.push(`Project memory:\n${memory}`);
  if (skills.length > 0) {
    parts.push(
      `Available skills (name: description; full body loads on demand via /skills show):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function createDriverAgents(
  app: FlowApp,
  modelIds: string[],
  check: ToolCheck,
): DriverAgent[] {
  const prefix = contextPrefixFor(app.memory, app.skills);
  const hooks = {
    before: (name: string, input: Record<string, unknown>) =>
      app.hooks.fire("PreToolUse", { tool_name: name, tool_input: input }),
    after: (name: string, input: Record<string, unknown>, output: string) =>
      app.hooks
        .fire("PostToolUse", { tool_name: name, tool_input: input, output: output.slice(0, 2000) })
        .then(() => undefined),
  };
  return modelIds.map(
    (id) =>
      new DriverAgent(id, createDriverFor(app.config, id), app.tools, check, {
        contextPrefix: prefix,
        subagents: app.subagents,
        mcp: app.mcp,
        hooks,
      }),
  );
}

export function createApp(
  config: Config,
  overrides: { driver?: Driver; fetchFn?: typeof fetch } = {},
): FlowApp {
  const logger = createLogger(config.logLevel);
  const driver =
    overrides.driver ??
    nativeDriverFor(config, overrides.fetchFn) ??
    cliDriverFor(config) ??
    new MockDriver(`${config.defaultModel} (mock: no key and no CLI found)`);
  const tools = new LocalTools(config.projectDir);
  const sessions = new SessionStore(config.dataDir, config.projectDir);
  const hooks = new HookRunner(loadHooks(config.dataDir, config.projectDir));
  const skills = discoverSkills(config.dataDir, config.projectDir);
  const subagents = discoverSubagents(config.dataDir, config.projectDir);
  const memoryFiles = loadMemoryFiles(homedir(), config.projectDir);
  const memory = buildMemoryBlock(memoryFiles);
  const projectMem = memoryFiles[1]?.content.trim() ?? "";
  const legacy = projectMem === "" ? findLegacyImport(config.projectDir) : undefined;
  const rules = loadPermissionRules(config.dataDir, config.projectDir);
  const mcp = new McpPool(loadMcpConfig(config.dataDir, config.projectDir));
  logger.debug("app created", { model: config.defaultModel, driver: driver.id });

  const app: FlowApp = {
    config,
    logger,
    driver,
    tools,
    sessions,
    hooks,
    skills,
    subagents,
    customCommands: discoverCommands(config.dataDir, config.projectDir),
    memory,
    memoryFiles,
    legacyImport: legacy?.path,
    rules,
    mcp,
    skillBody: (name) => loadSkillBody(config.dataDir, config.projectDir, name),
    initMemory: () => initProjectMemory(config.projectDir),
    importOffered: () => existsMarker(config.projectDir),
    markImportOffered: () => writeMarker(config.projectDir),
    savePermissionRule: (permissionRule) => {
      saveRule(config.projectDir, permissionRule);
      rules.push(permissionRule);
    },
    editPath: (path, editor) => {
      spawnSync(editor, [path], { stdio: "inherit" });
    },
    runSubagent: (name, prompt, emit) =>
      runSubagentTask({ driver, tools, subagents, mcp }, name, prompt, emit),
    dailyUsage: () => loadDailyUsage(config.dataDir),
    recordUsage: (provider, modelId, input, output) =>
      recordUsage(config, provider, modelId, input, output),
    quotaFor: async (modelId) => {
      try {
        return await createDriverFor(config, modelId).getQuota();
      } catch {
        return {
          provider: modelId.split("/")[0] ?? "unknown",
          requestsToday: 0,
          tokensToday: 0,
          costToday: 0,
          estimated: true,
        };
      }
    },
    notifyUser: (title, body) => {
      notify(title, body);
    },
    takeCheckpoint: async (sessionId, label) => {
      const snap = await snapshotWorkspace(tools, label);
      const entries = Object.entries(snap.files).map(([path, content]) => ({ path, content }));
      const checkpoint = takeCheckpointData(randomUUID(), snap.label, entries);
      const dir = checkpointDir(config.dataDir, config.projectDir, sessionId);
      saveCheckpoint(dir, checkpoint);
      return checkpoint;
    },
    listCheckpoints: (sessionId) =>
      listCheckpoints(checkpointDir(config.dataDir, config.projectDir, sessionId)),
    restoreCheckpoint: async (sessionId, id) => {
      const dir = checkpointDir(config.dataDir, config.projectDir, sessionId);
      const checkpoint = listCheckpoints(dir).find((c) => c.id === id || c.id.startsWith(id));
      if (checkpoint === undefined) throw new Error(`unknown checkpoint "${id}"`);
      return restoreCheckpoint(tools, checkpoint);
    },
    diagnose: () => diagnose(config, sessions, mcp),
  };
  return app;
}

async function runSubagentTask(
  deps: { driver: Driver; tools: ToolsPort; subagents: SubagentDef[]; mcp: McpPort },
  name: string,
  prompt: string,
  emit: (text: string) => void = () => {},
): Promise<string> {
  const def = deps.subagents.find((s) => s.name === name);
  if (def === undefined) {
    throw new Error(`unknown subagent "${name}" (see /agents)`);
  }
  const allowed = def.tools.map((t) => t.toLowerCase());
  const result = await runToolLoop(
    deps.driver,
    deps.tools,
    `${def.prompt === "" ? "You are a subagent. Complete the task." : def.prompt}\n\n${TOOL_SYSTEM}`,
    prompt,
    {
      maxTurns: 8,
      check: (tool) => (allowed.length > 0 && !allowed.includes(tool) ? "deny" : "allow"),
      emit,
      onMcpTool: (toolName, args) => deps.mcp.call(toolName, args),
    },
  );
  return result.answer;
}

export function discoverCustomCommands(
  config: Config,
): { name: string; template: string; source: string }[] {
  return discoverCommands(config.dataDir, config.projectDir);
}

const FLOW_TEMPLATE = `# FLOW.md — project memory for Flow

## What this project is
<!-- one honest paragraph -->

## How to work here
<!-- commands, conventions, gotchas -->
`;

function initProjectMemory(projectDir: string): { path: string; imported?: string } {
  const legacy = findLegacyImport(projectDir);
  const body =
    legacy === undefined
      ? FLOW_TEMPLATE
      : `${FLOW_TEMPLATE}\n<!-- imported from ${legacy.path} -->\n${legacy.content.slice(0, 4000)}\n`;
  const path = writeProjectMemory(projectDir, body);
  return { path, imported: legacy?.path };
}

function existsMarker(projectDir: string): boolean {
  return existsSync(importOfferedMarker(projectDir));
}

function writeMarker(projectDir: string): void {
  mkdirSync(join(projectDir, ".flow"), { recursive: true });
  writeFileSync(importOfferedMarker(projectDir), "offered\n", "utf8");
}

function recordUsage(
  config: Config,
  provider: string,
  modelId: string,
  input: number,
  output: number,
): { cost: number; dailyCost: number; level: BudgetLevel } {
  const cost = costFor(findModel(config.models, modelId), { input, output });
  const daily = recordProviderUsage(config.dataDir, provider, input, output, cost);
  const dailyCost = dailyTotals(daily).cost;
  const level = budgetLevel(dailyCost, config.dailyBudget, config.quotaThresholds);
  if (level !== "ok") {
    process.stderr.write(`[quota] daily spend $${dailyCost.toFixed(2)} hit ${level} level\n`);
  }
  return { cost, dailyCost, level };
}

async function probeNetwork(): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      signal: ctrl.signal,
    });
    await res.arrayBuffer().then((b) => b.byteLength);
    return { ok: true, detail: "https reachable" };
  } catch {
    return { ok: false, detail: "no https route to providers" };
  } finally {
    clearTimeout(timer);
  }
}

async function diagnose(
  config: Config,
  sessions: SessionStore,
  mcp: McpPort,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push({ name: "node", ok: true, detail: process.version });
  try {
    mkdirSync(sessions.dir(), { recursive: true });
    writeFileSync(join(sessions.dir(), ".probe"), "ok", "utf8");
    checks.push({ name: "storage", ok: true, detail: sessions.dir() });
  } catch {
    checks.push({ name: "storage", ok: false, detail: `unwritable: ${sessions.dir()}` });
  }
  const auth: Array<[string, boolean]> = [
    ["anthropic", config.auth.anthropic !== undefined],
    ["openai", config.auth.openai !== undefined],
    ["google", config.auth.google !== undefined],
    ["openrouter", config.auth.openrouter !== undefined],
  ];
  for (const [provider, present] of auth) {
    checks.push({
      name: `${provider}-auth`,
      ok: present,
      warn: !present,
      detail: present ? "key present" : "missing (mock/CLI drivers)",
    });
  }
  const seen = new Set<string>();
  for (const rule of config.routing) {
    if (rule.driver !== "cli" || rule.command === undefined || seen.has(rule.command)) continue;
    seen.add(rule.command);
    const version = cliVersion(rule.command);
    checks.push({
      name: `cli:${rule.command}`,
      ok: version !== undefined,
      warn: version === undefined,
      detail: version ?? "not on PATH",
    });
  }
  const network = await probeNetwork();
  checks.push({ name: "network", ok: network.ok, warn: !network.ok, detail: network.detail });
  checks.push({ name: "mcp", ok: true, detail: `${mcp.servers.length} servers` });
  const keychain = probeKeychain();
  checks.push({ name: "keychain", ok: keychain.ok, warn: !keychain.ok, detail: keychain.detail });
  checks.push({
    name: "ollama",
    ok: true,
    warn: true,
    detail: "local endpoint (degrades gracefully offline)",
  });
  return checks;
}
