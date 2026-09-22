import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLaunch } from "@/infrastructure/cliDrivers.js";
import type { DiscoveredModel } from "@/domain/discovery.js";

export type RunFn = (command: string, args: string[]) => string;

export const DISCOVERY_TTL_MS = 30 * 60 * 1000;

export function runCli(command: string, args: string[]): string {
  const launch = resolveLaunch(command, args);
  const found = spawnSync(launch.file, launch.argv, { encoding: "utf8", timeout: 15000 });
  if (found.status !== 0) {
    throw new Error(
      `${command} exited ${found.status}: ${String(found.stderr ?? "").slice(0, 200)}`,
    );
  }
  return found.stdout ?? "";
}

export function discoverOpencodeModels(run: RunFn): DiscoveredModel[] {
  const out = run("opencode", ["models"]);
  const models: DiscoveredModel[] = [];
  for (const line of out.split(/\r?\n/)) {
    const id = line.trim();
    if (id === "" || !id.includes("/")) continue;
    const provider = id.split("/")[0] as string;
    models.push({
      id,
      provider,
      source: "opencode",
      free: /free|fin-free/i.test(id),
    });
  }
  return models;
}

export function mapAgyModel(raw: string, label: string): DiscoveredModel {
  const id = raw.trim();
  const clean = label.trim() === "" ? id : label.trim();
  if (id.startsWith("gemini-")) {
    return { id: `google/${id}`, provider: "google", label: clean, source: "agy", cliModel: id };
  }
  if (id.startsWith("claude-")) {
    return {
      id: `anthropic/${id}`,
      provider: "anthropic",
      label: clean,
      source: "agy",
      cliModel: id,
    };
  }
  if (id.startsWith("gpt-")) {
    return { id: `openai/${id}`, provider: "openai", label: clean, source: "agy", cliModel: id };
  }
  return { id: `agy/${id}`, provider: "agy", label: clean, source: "agy", cliModel: id };
}

export function discoverAgyModels(run: RunFn): DiscoveredModel[] {
  const out = run("agy", ["models"]);
  const models: DiscoveredModel[] = [];
  for (const line of out.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const raw = (parts[0] as string).trim();
    if (raw === "") continue;
    models.push(mapAgyModel(raw, parts[1] as string));
  }
  return models;
}

export function discoverGrokModels(run: RunFn): DiscoveredModel[] {
  const out = run("grok", ["models"]);
  const models: DiscoveredModel[] = [];
  let inList = false;
  for (const line of out.split(/\r?\n/)) {
    if (!inList) {
      if (/available models/i.test(line)) inList = true;
      continue;
    }
    const name = line
      .replace(/^\s*\*\s*/, "")
      .replace(/\s*\(default\)\s*$/, "")
      .trim();
    if (name === "") continue;
    models.push({ id: `grok/${name}`, provider: "grok", source: "grok", cliModel: name });
  }
  return models;
}

async function fetchJson(fetchFn: typeof fetch, url: string, apiKey?: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  try {
    const headers: Record<string, string> = {};
    if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetchFn(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverOllamaModels(
  fetchFn: typeof fetch,
  baseUrl: string,
): Promise<DiscoveredModel[]> {
  const root = baseUrl.replace(/\/v1\/?$/, "");
  const data = (await fetchJson(fetchFn, `${root}/api/tags`)) as {
    models?: Array<{ name?: unknown }>;
  };
  const models: DiscoveredModel[] = [];
  for (const entry of data.models ?? []) {
    if (typeof entry.name !== "string" || entry.name === "") continue;
    models.push({
      id: `ollama/${entry.name}`,
      provider: "ollama",
      source: "ollama",
      cliModel: entry.name,
      free: true,
    });
  }
  return models;
}

export async function discoverOpenRouterModels(
  fetchFn: typeof fetch,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  const data = (await fetchJson(fetchFn, "https://openrouter.ai/api/v1/models", apiKey)) as {
    data?: Array<{
      id?: unknown;
      context_length?: unknown;
      pricing?: { prompt?: unknown; completion?: unknown };
    }>;
  };
  const models: DiscoveredModel[] = [];
  for (const entry of data.data ?? []) {
    if (typeof entry.id !== "string" || entry.id === "") continue;
    const ctx = typeof entry.context_length === "number" ? entry.context_length : undefined;
    const per = (v: unknown): number | undefined => {
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) && n > 0 ? n * 1_000_000 : undefined;
    };
    models.push({
      id: `openrouter/${entry.id}`,
      provider: "openrouter",
      source: "openrouter",
      contextWindow: ctx !== undefined && ctx > 0 ? ctx : undefined,
      inputPricePerM: per(entry.pricing?.prompt),
      outputPricePerM: per(entry.pricing?.completion),
      free: entry.id.endsWith(":free"),
    });
  }
  return models;
}

export interface DiscoveryCache {
  at: string;
  models: DiscoveredModel[];
}

export function discoveryCachePath(dataDir: string): string {
  return join(dataDir, "discovered.json");
}

export function loadDiscoveryCache(dataDir: string): DiscoveryCache | undefined {
  const path = discoveryCachePath(dataDir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DiscoveryCache;
    if (typeof parsed.at !== "string" || !Array.isArray(parsed.models)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveDiscoveryCache(dataDir: string, models: DiscoveredModel[]): void {
  mkdirSync(dataDir, { recursive: true });
  const cache: DiscoveryCache = { at: new Date().toISOString(), models };
  writeFileSync(discoveryCachePath(dataDir), `${JSON.stringify(cache)}\n`, "utf8");
}

export function cacheIsFresh(at: string, nowMs: number, ttlMs = DISCOVERY_TTL_MS): boolean {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return false;
  return nowMs - then < ttlMs;
}

export interface DiscoveryDeps {
  run: RunFn;
  fetchFn: typeof fetch;
  ollamaBaseUrl: string;
  openRouterKey?: string;
}

export async function discoverAll(deps: DiscoveryDeps): Promise<DiscoveredModel[]> {
  const settled = await Promise.allSettled([
    (async () => {
      try {
        return discoverOpencodeModels(deps.run);
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        return discoverAgyModels(deps.run);
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        return discoverGrokModels(deps.run);
      } catch {
        return [];
      }
    })(),
    discoverOllamaModels(deps.fetchFn, deps.ollamaBaseUrl).catch(() => []),
    discoverOpenRouterModels(deps.fetchFn, deps.openRouterKey).catch(() => []),
  ]);
  const out: DiscoveredModel[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") out.push(...result.value);
  }
  const seen = new Set<string>();
  return out.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}
