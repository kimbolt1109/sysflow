import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelInfo, RoutingRule } from "@/domain/models";

export interface FlowAuth {
  anthropic?: string;
  openai?: string;
  google?: string;
  openrouter?: string;
}

export interface Config {
  logLevel: string;
  dataDir: string;
  projectDir: string;
  defaultModel: string;
  models: ModelInfo[];
  routing: RoutingRule[];
  dailyBudget: number;
  maxCost: number;
  compactThreshold: number;
  ollamaBaseUrl: string;
  auth: FlowAuth;
}

const BUILTIN_MODELS: ModelInfo[] = [
  {
    id: "anthropic/claude-sonnet",
    provider: "anthropic",
    label: "Claude Sonnet",
    contextWindow: 200000,
    inputPricePerM: 3,
    outputPricePerM: 15,
    tags: ["recommended"],
  },
  {
    id: "openai/gpt-5",
    provider: "openai",
    label: "GPT 5",
    contextWindow: 400000,
    inputPricePerM: 2.5,
    outputPricePerM: 10,
    tags: ["recommended", "big-context"],
  },
  {
    id: "google/gemini-pro",
    provider: "google",
    label: "Gemini Pro",
    contextWindow: 1000000,
    inputPricePerM: 1.25,
    outputPricePerM: 5,
    tags: ["recommended", "big-context", "cheap"],
  },
  {
    id: "openrouter/auto",
    provider: "openrouter",
    label: "OpenRouter Auto",
    contextWindow: 200000,
    inputPricePerM: 2,
    outputPricePerM: 8,
    tags: ["cheap"],
  },
  {
    id: "ollama/llama3",
    provider: "ollama",
    label: "Llama 3 (local)",
    contextWindow: 32000,
    inputPricePerM: 0,
    outputPricePerM: 0,
    tags: ["local", "cheap"],
  },
];

const BUILTIN_ROUTING: RoutingRule[] = [
  {
    match: "anthropic/*",
    driver: "cli",
    command: "claude",
    args: ["--dangerously-skip-permissions"],
  },
  { match: "openai/gpt-*", driver: "cli", command: "codex" },
  { match: "google/gemini-*", driver: "cli", command: "agy", args: ["--yolo"] },
  { match: "*", driver: "cli", command: "opencode" },
];

interface FlowJson {
  models?: ModelInfo[];
  routing?: RoutingRule[];
}

function readJsonFile(path: string): unknown | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function asFlowJson(value: unknown): FlowJson {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const out: FlowJson = {};
  if (Array.isArray(record.models)) out.models = record.models as ModelInfo[];
  if (Array.isArray(record.routing)) out.routing = record.routing as RoutingRule[];
  return out;
}

function positiveNumber(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return n;
}

export function defaultDataDir(): string {
  return join(homedir(), ".flow");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: { cwd?: string; flowJsonPath?: string } = {},
): Config {
  const cwd = opts.cwd ?? process.cwd();
  const dataDir = env.APP_DATA_DIR && env.APP_DATA_DIR !== "" ? env.APP_DATA_DIR : defaultDataDir();

  const candidates = [opts.flowJsonPath, env.APP_FLOW_JSON, join(cwd, "flow.json")].filter(
    (p): p is string => typeof p === "string" && p !== "",
  );

  let models = BUILTIN_MODELS;
  let routing = BUILTIN_ROUTING;
  for (const candidate of candidates) {
    const parsed = asFlowJson(readJsonFile(candidate));
    if (parsed.models !== undefined || parsed.routing !== undefined) {
      if (parsed.models !== undefined && parsed.models.length > 0) models = parsed.models;
      if (parsed.routing !== undefined && parsed.routing.length > 0) routing = parsed.routing;
      break;
    }
  }

  const userSettings = asFlowJson(readJsonFile(join(dataDir, "settings.json")));
  const projectSettings = asFlowJson(readJsonFile(join(cwd, ".flow", "settings.json")));

  const compactThreshold = positiveNumber(env.APP_COMPACT_THRESHOLD, "APP_COMPACT_THRESHOLD", 0.85);
  if (compactThreshold < 0.5 || compactThreshold > 0.95) {
    throw new Error(
      `APP_COMPACT_THRESHOLD must be between 0.5 and 0.95, got "${compactThreshold}"`,
    );
  }

  const settingsModel =
    (projectSettings as { defaultModel?: unknown }).defaultModel ??
    (userSettings as { defaultModel?: unknown }).defaultModel;
  const defaultModel =
    env.APP_MODEL && env.APP_MODEL !== ""
      ? env.APP_MODEL
      : typeof settingsModel === "string" && settingsModel !== ""
        ? settingsModel
        : (models[0]?.id ?? "anthropic/claude-sonnet");

  const nonempty = (v: string | undefined): string | undefined =>
    v !== undefined && v !== "" ? v : undefined;

  return {
    logLevel: env.APP_LOG_LEVEL ?? "info",
    dataDir,
    projectDir: cwd,
    defaultModel,
    models,
    routing,
    dailyBudget: positiveNumber(env.APP_DAILY_BUDGET, "APP_DAILY_BUDGET", 0),
    maxCost: positiveNumber(env.APP_MAX_COST, "APP_MAX_COST", 0),
    compactThreshold,
    ollamaBaseUrl:
      env.APP_OLLAMA_BASE_URL && env.APP_OLLAMA_BASE_URL !== ""
        ? env.APP_OLLAMA_BASE_URL
        : "http://localhost:11434/v1",
    auth: {
      anthropic: nonempty(env.APP_ANTHROPIC_API_KEY),
      openai: nonempty(env.APP_OPENAI_API_KEY),
      google: nonempty(env.APP_GOOGLE_API_KEY ?? env.APP_GEMINI_API_KEY),
      openrouter: nonempty(env.APP_OPENROUTER_API_KEY),
    },
  };
}
