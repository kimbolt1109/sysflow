import type { ChatMessage, QuotaInfo, TokenUsage } from "@/domain/models.js";
import type { Driver, SendResult } from "@/domain/drivers.js";
import { loadImageParts } from "@/infrastructure/imageFiles.js";
import { AuthError, DriverError, QuotaError } from "@/lib/errors.js";
import { CHAT_SEND_TIMEOUT_MS, CHAT_STREAM_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch.js";

export interface CompatOptions {
  apiKey?: string;
  model: string;
  baseUrl: string;
  provider: string;
  keyEnv: string;
  fetchFn?: typeof fetch;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("");
}

function messageContent(m: ChatMessage): unknown {
  const images = loadImageParts(m.images);
  if (images.length === 0) return m.content;
  return [
    { type: "text", text: m.content },
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    })),
  ];
}

export class OpenAiCompatDriver implements Driver {
  readonly kind = "native" as const;
  readonly id: string;
  private readonly provider: string;
  private readonly keyEnv: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private requests = 0;
  private tokens = 0;

  constructor(opts: CompatOptions) {
    this.id = opts.model;
    this.provider = opts.provider;
    this.keyEnv = opts.keyEnv;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  countTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async getQuota(): Promise<QuotaInfo> {
    return {
      provider: this.provider,
      requestsToday: this.requests,
      tokensToday: this.tokens,
      costToday: 0,
      estimated: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    if (this.provider === "ollama")
      return { ok: true, detail: "local endpoint (degrades gracefully offline)" };
    if (this.apiKey === undefined) return { ok: false, detail: `missing ${this.keyEnv}` };
    return { ok: true, detail: "key present (verified on first send)" };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey !== undefined) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private async throwForStatus(res: Response): Promise<never> {
    const body = (await res.text()).slice(0, 500);
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`${this.provider} auth failed (${res.status}): ${body}`);
    }
    if (res.status === 429) {
      const raw = res.headers.get("retry-after");
      const secs = raw === null ? NaN : Number(raw);
      throw new QuotaError(
        `${this.provider} rate limited: ${body}`,
        Number.isFinite(secs) ? secs * 1000 : undefined,
      );
    }
    throw new DriverError(`${this.provider} request failed (${res.status}): ${body}`);
  }

  async sendMessage(messages: ChatMessage[]): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.fetchFn,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            model: this.id.includes("/") ? this.id.split("/").slice(1).join("/") : this.id,
            messages: messages.map((m) => ({
              role: m.role === "tool" ? "user" : m.role,
              content: messageContent(m),
            })),
            stream: false,
          }),
        },
        CHAT_SEND_TIMEOUT_MS,
      );
    } catch (err) {
      throw new DriverError(
        `${this.provider} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) await this.throwForStatus(res);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const text = textOf(data.choices?.[0]?.message?.content ?? "");
    if (text === "") throw new DriverError(`${this.provider} returned an empty reply`);
    const usage: TokenUsage = {
      input: num(data.usage?.prompt_tokens),
      output: num(data.usage?.completion_tokens),
    };
    this.requests += 1;
    this.tokens += usage.input + usage.output;
    return { text, usage };
  }

  async streamMessage(
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.fetchFn,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            model: this.id.includes("/") ? this.id.split("/").slice(1).join("/") : this.id,
            messages: messages.map((m) => ({
              role: m.role === "tool" ? "user" : m.role,
              content: messageContent(m),
            })),
            stream: true,
          }),
        },
        CHAT_STREAM_TIMEOUT_MS,
      );
    } catch (err) {
      throw new DriverError(
        `${this.provider} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok || res.body === null) {
      if (!res.ok) await this.throwForStatus(res);
      throw new DriverError(`${this.provider} stream had no body`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    try {
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
          const delta = (event as { choices?: Array<{ delta?: { content?: unknown } }> })
            .choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta !== "") {
            text += delta;
            onToken(delta);
          }
        }
      }
    } catch (err) {
      throw new DriverError(
        `${this.provider} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (text === "") throw new DriverError(`${this.provider} returned an empty reply`);
    const usage: TokenUsage = { input: 0, output: this.countTokens(text) };
    this.requests += 1;
    this.tokens += usage.input + usage.output;
    return { text, usage };
  }
}

export function createOpenaiDriver(
  model: string,
  apiKey: string | undefined,
  fetchFn?: typeof fetch,
): OpenAiCompatDriver {
  return new OpenAiCompatDriver({
    model,
    apiKey,
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    keyEnv: "APP_OPENAI_API_KEY",
    fetchFn,
  });
}

export function createOpenrouterDriver(
  model: string,
  apiKey: string | undefined,
  fetchFn?: typeof fetch,
): OpenAiCompatDriver {
  return new OpenAiCompatDriver({
    model,
    apiKey,
    baseUrl: "https://openrouter.ai/api/v1",
    provider: "openrouter",
    keyEnv: "APP_OPENROUTER_API_KEY",
    fetchFn,
  });
}

export function createOllamaDriver(
  model: string,
  baseUrl = "http://localhost:11434/v1",
  fetchFn?: typeof fetch,
): OpenAiCompatDriver {
  return new OpenAiCompatDriver({
    model,
    baseUrl,
    provider: "ollama",
    keyEnv: "APP_OLLAMA_BASE_URL",
    fetchFn,
  });
}
