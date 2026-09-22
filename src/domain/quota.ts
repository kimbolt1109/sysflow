import type { ModelInfo, TokenUsage } from "@/domain/models.js";
import { QuotaError } from "@/lib/errors.js";

export interface BudgetThresholds {
  warn: number;
  amber: number;
  confirm: number;
}

export const DEFAULT_THRESHOLDS: BudgetThresholds = { warn: 0.7, amber: 0.85, confirm: 0.95 };

export function costFor(model: ModelInfo | undefined, usage: TokenUsage): number {
  if (model === undefined) return 0;
  return (usage.input * model.inputPricePerM + usage.output * model.outputPricePerM) / 1_000_000;
}

export type BudgetLevel = "ok" | "warn" | "amber" | "confirm";

export function budgetLevel(
  spent: number,
  budget: number,
  thresholds: BudgetThresholds,
): BudgetLevel {
  if (budget <= 0) return "ok";
  const ratio = spent / budget;
  if (ratio >= thresholds.confirm) return "confirm";
  if (ratio >= thresholds.amber) return "amber";
  if (ratio >= thresholds.warn) return "warn";
  return "ok";
}

export interface FailoverOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, err: QuotaError) => void;
}

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const grown = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = grown * (0.5 + Math.random() * 0.5);
  return Math.min(maxDelayMs, Math.round(jitter));
}

export async function withFailover<T>(
  drivers: string[],
  run: (driver: string, attempt: number) => Promise<T>,
  opts: FailoverOptions = {},
): Promise<T> {
  if (drivers.length === 0) throw new Error("failover needs at least one driver");
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep =
    opts.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const driver = drivers[(attempt - 1) % drivers.length] as string;
    try {
      return await run(driver, attempt);
    } catch (err) {
      last = err;
      if (!(err instanceof QuotaError)) throw err;
      const retryAfter = err.retryAfterMs;
      const delay =
        retryAfter !== undefined && Number.isFinite(retryAfter)
          ? Math.min(retryAfter, opts.maxDelayMs ?? 30000)
          : backoffDelay(attempt, opts.baseDelayMs ?? 1000, opts.maxDelayMs ?? 30000);
      opts.onRetry?.(attempt, delay, err);
      if (attempt < maxAttempts) await sleep(delay);
    }
  }
  throw last;
}
