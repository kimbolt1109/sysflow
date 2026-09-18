import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProviderUsage {
  requests: number;
  input: number;
  output: number;
  cost: number;
}

export interface DailyUsage {
  date: string;
  providers: Record<string, ProviderUsage>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function usagePath(dataDir: string): string {
  return join(dataDir, "usage.json");
}

export function loadDailyUsage(dataDir: string): DailyUsage {
  const path = usagePath(dataDir);
  const date = today();
  if (!existsSync(path)) return { date, providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DailyUsage;
    if (parsed.date !== date) return { date, providers: {} };
    return parsed;
  } catch {
    return { date, providers: {} };
  }
}

export function recordProviderUsage(
  dataDir: string,
  provider: string,
  input: number,
  output: number,
  cost: number,
): DailyUsage {
  const daily = loadDailyUsage(dataDir);
  const prev = daily.providers[provider] ?? { requests: 0, input: 0, output: 0, cost: 0 };
  daily.providers[provider] = {
    requests: prev.requests + 1,
    input: prev.input + input,
    output: prev.output + output,
    cost: prev.cost + cost,
  };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(usagePath(dataDir), `${JSON.stringify(daily)}\n`, "utf8");
  return daily;
}

export function dailyTotals(daily: DailyUsage): { requests: number; cost: number } {
  let requests = 0;
  let cost = 0;
  for (const p of Object.values(daily.providers)) {
    requests += p.requests;
    cost += p.cost;
  }
  return { requests, cost };
}
