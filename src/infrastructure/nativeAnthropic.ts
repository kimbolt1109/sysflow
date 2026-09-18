import type { ChatMessage, QuotaInfo, TokenUsage } from "@/domain/models";
import type { Driver, SendResult } from "@/domain/drivers";
import { AuthError, DriverError, QuotaError } from "@/lib/errors";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  fetchFn?: typeof fetch;
}

interface AnthropicUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
}

function toApiModel(id: string): string {
  const slash = id.indexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("");
}

export class AnthropicDriver implements Driver {
  readonly kind = "native" as const;
  readonly id: string;
  private readonly apiKey: string;
  private readonly apiModel: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly fetchFn: typeof fetch;
  private requests = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private lastHeaders: Record<string, string> = {};

  constructor(opts: AnthropicOptions) {
    if (opts.apiKey === "")
      throw new AuthError("missing Anthropic API key (APP_ANTHROPIC_API_KEY)");
    this.apiKey = opts.apiKey;
    this.id = opts.model;
    this.apiModel = toApiModel(opts.model);
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.maxTokens = opts.maxTokens ?? 4096;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  countTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async getQuota(): Promise<QuotaInfo> {
    const limit = Number(this.lastHeaders["anthropic-ratelimit-requests-limit"] ?? "");
    return {
      provider: "anthropic",
      requestsToday: this.requests,
      tokensToday: this.inputTokens + this.outputTokens,
      costToday: 0,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      estimated: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    if (this.apiKey === "") return { ok: false, detail: "missing API key" };
    return { ok: true, detail: "key present (verified on first send)" };
  }

  private toPayload(messages: ChatMessage[], stream: boolean): Record<string, unknown> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.role === "tool" ? `[tool ${m.name ?? ""}] ${m.content}` : m.content,
      }));
    const payload: Record<string, unknown> = {
      model: this.apiModel,
      max_tokens: this.maxTokens,
      messages: rest,
      stream,
    };
    if (system !== "") payload.system = system;
    return payload;
  }

  private remember(res: Response, usage?: AnthropicUsage): void {
    this.requests += 1;
    this.inputTokens += num(usage?.input_tokens);
    this.outputTokens += num(usage?.output_tokens);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.lastHeaders = headers;
  }

  private async throwForStatus(res: Response): Promise<never> {
    const body = (await res.text()).slice(0, 500);
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`anthropic auth failed (${res.status}): ${body}`);
    }
    if (res.status === 429) {
      const raw = res.headers.get("retry-after");
      const secs = raw === null ? NaN : Number(raw);
      throw new QuotaError(
        `anthropic rate limited: ${body}`,
        Number.isFinite(secs) ? secs * 1000 : undefined,
      );
    }
    throw new DriverError(`anthropic request failed (${res.status}): ${body}`);
  }

  async sendMessage(messages: ChatMessage[]): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(this.toPayload(messages, false)),
      });
    } catch (err) {
      throw new DriverError(
        `anthropic network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) await this.throwForStatus(res);
    const data = (await res.json()) as { content?: unknown; usage?: AnthropicUsage };
    this.remember(res, data.usage);
    const usage: TokenUsage = {
      input: num(data.usage?.input_tokens),
      output: num(data.usage?.output_tokens),
    };
    return { text: textOf(data.content), usage };
  }

  async streamMessage(
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(this.toPayload(messages, true)),
      });
    } catch (err) {
      throw new DriverError(
        `anthropic network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok || res.body === null) {
      if (!res.ok) await this.throwForStatus(res);
      throw new DriverError("anthropic stream had no body");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let input = 0;
    let output = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (typeof event !== "object" || event === null) continue;
        const e = event as Record<string, unknown>;
        if (e.type === "content_block_delta") {
          const delta = e.delta as Record<string, unknown> | undefined;
          if (typeof delta?.text === "string") {
            text += delta.text;
            onToken(delta.text);
          }
        } else if (e.type === "message_start") {
          const message = e.message as { usage?: AnthropicUsage } | undefined;
          input += num(message?.usage?.input_tokens);
        } else if (e.type === "message_delta") {
          const usage = e.usage as AnthropicUsage | undefined;
          output += num(usage?.output_tokens);
        }
      }
    }
    this.requests += 1;
    this.inputTokens += input;
    this.outputTokens += output;
    return { text, usage: { input, output } };
  }
}
