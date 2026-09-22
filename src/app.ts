import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Config } from "@/config.js";
import type { CustomCommand } from "@/domain/commands.js";
import type { DoctorCheck } from "@/domain/doctor.js";
import type { Driver } from "@/domain/drivers.js";
import type { HooksPort } from "@/domain/hooks.js";
import type { McpPort } from "@/domain/mcp.js";
import { formatMcpInventory } from "@/domain/mcp.js";
import type { ModelInfo, QuotaInfo } from "@/domain/models.js";
import { mergeModels } from "@/domain/discovery.js";
import { buildMemoryBlock } from "@/domain/memory.js";
import type { Checkpoint } from "@/domain/checkpoints.js";
import { takeCheckpoint as takeCheckpointData } from "@/domain/checkpoints.js";
import type { PermissionRule } from "@/domain/permissions.js";
import { budgetLevel, costFor, type BudgetLevel } from "@/domain/quota.js";
import { findModel } from "@/domain/modelRegistry.js";
import { matchRouting } from "@/domain/routing.js";
import type { SkillDef } from "@/domain/skills.js";
import { thinkingDirective, type ThinkingLevel } from "@/domain/thinking.js";
import { extractLessons, lessonsContext } from "@/domain/learnings.js";
import { formatDecisions } from "@/domain/decide.js";
import type { SubagentDef } from "@/domain/subagents.js";
import type { ToolsPort } from "@/domain/toolDefs.js";
import { runToolLoop, TOOL_SYSTEM, type ToolCheck } from "@/infrastructure/agentLoop.js";
import {
  checkpointDir,
  listCheckpoints,
  restoreCheckpoint,
  saveCheckpoint,
  snapshotWorkspace as takeWorkspaceSnapshot,
} from "@/infrastructure/checkpointStore.js";
import { CliDriver, cliVersion, findOnPath } from "@/infrastructure/cliDrivers.js";
import { discoverCommands } from "@/infrastructure/commandStore.js";
import {
  cacheIsFresh,
  discoverAll,
  loadDiscoveryCache,
  runCli,
  saveDiscoveryCache,
} from "@/infrastructure/discovery.js";
import { DriverAgent } from "@/infrastructure/driverAgent.js";
import { RetryDriver } from "@/infrastructure/retryDriver.js";
import { fetchPageText } from "@/lib/webfetch.js";
import { openBrowser } from "@/lib/browser.js";
import { answerQuestions } from "@/infrastructure/layaClient.js";
import { HookRunner, loadHooks } from "@/infrastructure/hookRunner.js";
import { probeKeychain } from "@/infrastructure/keychain.js";
import { LocalTools } from "@/infrastructure/localTools.js";
import { loadMcpConfig, McpPool } from "@/infrastructure/mcpClients.js";
import { notify } from "@/infrastructure/notifier.js";
import {
  findLegacyImport,
  importOfferedMarker,
  loadMemoryFiles,
  openInEditor,
  writeProjectMemory,
} from "@/infrastructure/memoryStore.js";
import { MockDriver } from "@/infrastructure/mockDriver.js";
import { AnthropicDriver } from "@/infrastructure/nativeAnthropic.js";
import { GoogleDriver } from "@/infrastructure/nativeGoogle.js";
import {
  createOllamaDriver,
  createOpenaiDriver,
  createOpenrouterDriver,
} from "@/infrastructure/openaiCompat.js";
import { SessionStore } from "@/infrastructure/sessionStore.js";
import { discoverSkills, loadSkillBody } from "@/infrastructure/skillStore.js";
import { discoverSubagents } from "@/infrastructure/subagentStore.js";
import { loadPermissionRules, saveRule } from "@/infrastructure/permissionStore.js";
import {
  dailyTotals,
  loadDailyUsage,
  recordProviderUsage,
  type DailyUsage,
} from "@/infrastructure/usageStore.js";
import { createLogger, type Logger } from "@/lib/logger.js";

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
  /** registry merged with the discovery cache (refresh via refreshModels) */
  readonly models: ModelInfo[];
  refreshModels(force?: boolean): Promise<ModelInfo[]>;
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
  editTempContent(content: string, editor: string): string;
  reloadExtensions(): { skills: number; subagents: number; commands: number };
  runSubagent(name: string, prompt: string, emit?: (text: string) => void): Promise<string>;
  recordUsage(provider: string, modelId: string, input: number, output: number): UsageRecord;
  dailyUsage(): DailyUsage;
  quotaFor(modelId: string): Promise<QuotaInfo>;
  notifyUser(title: string, body: string): void;
  askUser?: (question: string, options: string[]) => Promise<string>;
  takeCheckpoint(sessionId: string, label: string): Promise<Checkpoint>;
  snapshotWorkspace(): Promise<Record<string, string | null>>;
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
    return withRetries(
      new AnthropicDriver({
        apiKey: config.auth.anthropic,
        model: config.defaultModel,
        fetchFn,
      }),
    );
  }
  if (provider === "openai" && config.auth.openai !== undefined) {
    return withRetries(createOpenaiDriver(config.defaultModel, config.auth.openai, fetchFn));
  }
  if (provider === "google" && config.auth.google !== undefined) {
    return withRetries(
      new GoogleDriver({ apiKey: config.auth.google, model: config.defaultModel, fetchFn }),
    );
  }
  if (provider === "openrouter" && config.auth.openrouter !== undefined) {
    return withRetries(
      createOpenrouterDriver(config.defaultModel, config.auth.openrouter, fetchFn),
    );
  }
  if (provider === "ollama") {
    return withRetries(createOllamaDriver(config.defaultModel, config.ollamaBaseUrl, fetchFn));
  }
  return undefined;
}

/** API drivers retry 429s, 5xx, and network blips (CLI/mock drivers excluded:
 * re-running local commands could repeat side effects). */
function withRetries(driver: Driver): Driver {
  return new RetryDriver(driver, {
    onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
      process.stderr.write(
        `[retry ${attempt}/${maxAttempts} in ${(delayMs / 1000).toFixed(1)}s: ${error.slice(0, 160)}]\n`,
      );
    },
  });
}

export function cliDriverFor(
  config: Config,
  modelId?: string,
  models: ModelInfo[] = config.models,
): Driver | undefined {
  const id = modelId ?? config.defaultModel;
  const rule = matchRouting(config.routing, id);
  if (
    rule.driver === "cli" &&
    rule.command !== undefined &&
    findOnPath(rule.command) !== undefined
  ) {
    return new CliDriver(id, {
      command: rule.command,
      extraArgs: rule.args,
      cliModel: models.find((m) => m.id === id)?.cliModel,
    });
  }
  return undefined;
}

export function createDriverFor(
  config: Config,
  modelId: string,
  fetchFn?: typeof fetch,
  models: ModelInfo[] = config.models,
): Driver {
  const scoped: Config = { ...config, defaultModel: modelId };
  const native = nativeDriverFor(scoped, fetchFn);
  if (native !== undefined) return native;
  const rule = matchRouting(config.routing, modelId);
  if (
    rule.driver === "cli" &&
    rule.command !== undefined &&
    findOnPath(rule.command) !== undefined
  ) {
    return new CliDriver(modelId, {
      command: rule.command,
      extraArgs: rule.args,
      cliModel: models.find((m) => m.id === modelId)?.cliModel,
    });
  }
  return new MockDriver(`${modelId} (mock: no key and no CLI found)`);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(undefined), ms);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function contextPrefixFor(
  memory: string,
  skills: SkillDef[],
  thinking: ThinkingLevel = "medium",
): string {
  const parts: string[] = [];
  if (memory.trim() !== "") parts.push(`Project memory:\n${memory}`);
  const invokable = skills.filter((s) => !s.disableModelInvocation);
  if (invokable.length > 0) {
    parts.push(
      `Available skills (name: description; load a body first with the skill tool, then follow it):\n${invokable.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`,
    );
  }
  parts.push(thinkingDirective(thinking));
  return parts.join("\n\n");
}

/** Past council lessons for this project, as an agent context block ("" when none).
 * Best-effort: session files are append-only logs and never block agent creation. */
export function recallLessons(sessions: FlowApp["sessions"], cap = 8): string {
  try {
    const ids = sessions.list().slice(-10);
    const records = ids.map((id) => sessions.load(id).slice(-100));
    return lessonsContext(extractLessons(records, cap));
  } catch {
    return "";
  }
}

export function createDriverAgents(
  app: FlowApp,
  modelIds: string[],
  check: ToolCheck,
  thinking: ThinkingLevel = "medium",
): DriverAgent[] {
  const prefix = contextPrefixFor(app.memory, app.skills, thinking);
  const lessons = recallLessons(app.sessions);
  const fullPrefix = lessons === "" ? prefix : `${prefix}\n\n${lessons}`;
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
      new DriverAgent(
        id,
        createDriverFor(app.config, id, undefined, app.models),
        app.tools,
        check,
        {
          contextPrefix: fullPrefix,
          subagents: app.subagents,
          skillBody: (name) => {
            const def = app.skills.find((s) => s.name === name);
            if (def?.disableModelInvocation === true) return undefined;
            return app.skillBody(name);
          },
          onQuestion: async (question, options) =>
            app.askUser !== undefined
              ? app.askUser(question, options)
              : "question unavailable (non-interactive session)",
          mcp: app.mcp,
          layaUrl: app.config.layaUrl,
          hooks,
        },
      ),
  );
}

export function createApp(
  config: Config,
  overrides: { driver?: Driver; fetchFn?: typeof fetch } = {},
): FlowApp {
  const logger = createLogger(config.logLevel);
  const cached = loadDiscoveryCache(config.dataDir);
  const initialModels = mergeModels(config.models, cached !== undefined ? cached.models : []);
  const driver =
    overrides.driver ??
    nativeDriverFor(config, overrides.fetchFn) ??
    cliDriverFor(config, undefined, initialModels) ??
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
  let models = initialModels;
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
    get models() {
      return models;
    },
    refreshModels: async (force = false) => {
      const cache = loadDiscoveryCache(config.dataDir);
      if (!force && cache !== undefined && cacheIsFresh(cache.at, Date.now())) {
        models = mergeModels(config.models, cache.models);
        return models;
      }
      const live =
        (await withTimeout(
          discoverAll({
            run: runCli,
            fetchFn: fetch,
            ollamaBaseUrl: config.ollamaBaseUrl,
            openRouterKey: config.auth.openrouter,
          }),
          15000,
        )) ?? [];
      if (live.length > 0) {
        saveDiscoveryCache(config.dataDir, live);
      }
      const fresh = loadDiscoveryCache(config.dataDir);
      models = mergeModels(config.models, fresh !== undefined ? fresh.models : []);
      return models;
    },
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
    editTempContent: (content, editor) => editTempContent(content, editor),
    reloadExtensions: () => {
      app.skills = discoverSkills(config.dataDir, config.projectDir);
      app.subagents = discoverSubagents(config.dataDir, config.projectDir);
      app.customCommands = discoverCommands(config.dataDir, config.projectDir);
      return {
        skills: app.skills.length,
        subagents: app.subagents.length,
        commands: app.customCommands.length,
      };
    },
    runSubagent: (name, prompt, emit) =>
      runSubagentTask(
        {
          driver,
          tools,
          subagents,
          mcp,
          skills,
          sessions,
          dataDir: config.dataDir,
          projectDir: config.projectDir,
          layaUrl: config.layaUrl,
        },
        name,
        prompt,
        emit,
      ),
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
      const snap = await takeWorkspaceSnapshot(tools, label);
      const entries = Object.entries(snap.files).map(([path, content]) => ({ path, content }));
      const checkpoint = takeCheckpointData(randomUUID(), snap.label, entries);
      const dir = checkpointDir(config.dataDir, config.projectDir, sessionId);
      saveCheckpoint(dir, checkpoint);
      return checkpoint;
    },
    listCheckpoints: (sessionId) =>
      listCheckpoints(checkpointDir(config.dataDir, config.projectDir, sessionId)),
    snapshotWorkspace: async () => (await takeWorkspaceSnapshot(tools, "snapshot")).files,
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
  deps: {
    driver: Driver;
    tools: ToolsPort;
    subagents: SubagentDef[];
    mcp: McpPort;
    skills: SkillDef[];
    sessions: SessionStore;
    dataDir: string;
    projectDir: string;
    layaUrl?: string;
  },
  name: string,
  prompt: string,
  emit: (text: string) => void = () => {},
): Promise<string> {
  const def = deps.subagents.find((s) => s.name === name);
  if (def === undefined) {
    throw new Error(`unknown subagent "${name}" (see /agents)`);
  }
  const allowed = def.tools.map((t) => t.toLowerCase());
  const lessons = recallLessons(deps.sessions, 3);
  const system =
    `${def.prompt === "" ? "You are a subagent. Complete the task." : def.prompt}` +
    (lessons === "" ? "" : `\n\n${lessons}`) +
    `\n\n${TOOL_SYSTEM}`;
  const result = await runToolLoop(deps.driver, deps.tools, system, prompt, {
    maxTurns: 8,
    check: (tool) => (allowed.length > 0 && !allowed.includes(tool) ? "deny" : "allow"),
    emit,
    onMcpTool: (toolName, args) => deps.mcp.call(toolName, args),
    onListMcpTools: async () => formatMcpInventory(await deps.mcp.toolInventory()),
    onSkill: (skillName) => {
      const skill = deps.skills.find((s) => s.name === skillName);
      if (skill?.disableModelInvocation === true) return undefined;
      return loadSkillBody(deps.dataDir, deps.projectDir, skillName);
    },
    onWebfetch: (url) => fetchPageText(url),
    onBrowse: (url) => openBrowser(url),
    onDecide: async (state, questions) =>
      formatDecisions((await answerQuestions(deps.layaUrl, state, questions)).answers),
  });
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

function editTempContent(content: string, editor: string): string {
  const tmp = join(tmpdir(), `flow-edit-${randomUUID()}.md`);
  writeFileSync(tmp, content, "utf8");
  try {
    openInEditor(tmp, editor);
    return readFileSync(tmp, "utf8");
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
  }
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
