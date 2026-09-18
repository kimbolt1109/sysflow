import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Config } from "@/config";
import type { CustomCommand } from "@/domain/commands";
import type { Driver } from "@/domain/drivers";
import type { HooksPort } from "@/domain/hooks";
import type { McpPort } from "@/domain/mcp";
import { buildMemoryBlock } from "@/domain/memory";
import type { PermissionRule } from "@/domain/permissions";
import { matchRouting } from "@/domain/routing";
import type { SkillDef } from "@/domain/skills";
import type { SubagentDef } from "@/domain/subagents";
import type { ToolsPort } from "@/domain/toolDefs";
import { runToolLoop, TOOL_SYSTEM, type ToolCheck } from "@/infrastructure/agentLoop";
import { CliDriver, findOnPath } from "@/infrastructure/cliDrivers";
import { discoverCommands } from "@/infrastructure/commandStore";
import { DriverAgent } from "@/infrastructure/driverAgent";
import { HookRunner, loadHooks } from "@/infrastructure/hookRunner";
import { LocalTools } from "@/infrastructure/localTools";
import { loadMcpConfig, McpPool } from "@/infrastructure/mcpClients";
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
