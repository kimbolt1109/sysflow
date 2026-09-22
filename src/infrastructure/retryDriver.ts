import type { Driver, SendResult } from "@/domain/drivers.js";
import type { ChatMessage, QuotaInfo } from "@/domain/models.js";
import { backoffDelay } from "@/domain/quota.js";
import { QuotaError } from "@/lib/errors.js";

export interface RetryNotice {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (notice: RetryNotice) => void;
}

/** Delay before the next attempt, or undefined when the error is final.
 * Retries 429s (honoring retry-after), network failures, and 5xx responses.
 * Auth and client errors never retry. */
export function retryDelayFor(
  err: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number | undefined {
  if (err instanceof QuotaError) {
    const after = err.retryAfterMs;
    if (after !== undefined && Number.isFinite(after)) {
      return Math.max(0, Math.min(Math.round(after), maxDelayMs));
    }
    return backoffDelay(attempt, baseDelayMs, maxDelayMs);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/network error/i.test(message)) return backoffDelay(attempt, baseDelayMs, maxDelayMs);
  const status = /request failed \((\d{3})\)/.exec(message);
  if (status !== null && Number(status[1]) >= 500) {
    return backoffDelay(attempt, baseDelayMs, maxDelayMs);
  }
  return undefined;
}

/** Retries a driver around transient API failures.
 * Only retries before any token arrives: replays after a partial stream
 * would regenerate (and duplicate) output, so mid-stream breaks surface. */
export class RetryDriver implements Driver {
  readonly id: string;
  readonly kind = "native" as const;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onRetry?: (notice: RetryNotice) => void;

  constructor(
    private readonly inner: Driver,
    opts: RetryOptions = {},
  ) {
    this.id = inner.id;
    this.kind = "native";
    this.maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 3));
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 30000;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
    this.onRetry = opts.onRetry;
  }

  countTokens(text: string): number {
    return this.inner.countTokens(text);
  }

  getQuota(): Promise<QuotaInfo> {
    return this.inner.getQuota();
  }

  healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return this.inner.healthCheck();
  }

  sendMessage(messages: ChatMessage[]): Promise<SendResult> {
    return this.run((driver) => driver.sendMessage(messages));
  }

  streamMessage(messages: ChatMessage[], onToken: (token: string) => void): Promise<SendResult> {
    return this.run((driver) =>
      driver.streamMessage(messages, (token) => {
        this.started = true;
        onToken(token);
      }),
    );
  }

  private started = false;

  private async run(fn: (driver: Driver) => Promise<SendResult>): Promise<SendResult> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.started = false;
      try {
        return await fn(this.inner);
      } catch (err) {
        last = err;
        const delay = this.started
          ? undefined
          : retryDelayFor(err, attempt, this.baseDelayMs, this.maxDelayMs);
        if (delay === undefined || attempt >= this.maxAttempts) throw err;
        this.onRetry?.({
          attempt,
          maxAttempts: this.maxAttempts,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.sleep(delay);
      }
    }
    throw last;
  }
}
