import type { ChatMessage, QuotaInfo, TokenUsage } from "@/domain/models.js";
import type { Driver, SendResult } from "@/domain/drivers.js";
import { loadImageParts } from "@/infrastructure/imageFiles.js";
import { AuthError, DriverError, QuotaError } from "@/lib/errors.js";
import { CHAT_SEND_TIMEOUT_MS, CHAT_STREAM_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch.js";

export interface GoogleOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function messageParts(m: ChatMessage): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [
    { text: m.role === "tool" ? `[tool] ${m.content}` : m.content },
  ];
  for (const img of loadImageParts(m.images)) {
    parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
  }
  return parts;
}

export class GoogleDriver implements Driver {
  readonly kind = "native" as const;
  readonly id: string;
  private readonly apiKey: string;
  private readonly apiModel: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private requests = 0;
  private tokens = 0;

  constructor(opts: GoogleOptions) {
    if (opts.apiKey === "") throw new AuthError("missing Google API key (APP_GOOGLE_API_KEY)");
    this.apiKey = opts.apiKey;
    this.id = opts.model;
    const slash = opts.model.indexOf("/");
    this.apiModel = slash >= 0 ? opts.model.slice(slash + 1) : opts.model;
    this.baseUrl = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  countTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async getQuota(): Promise<QuotaInfo> {
    return {
      provider: "google",
      requestsToday: this.requests,
      tokensToday: this.tokens,
      costToday: 0,
      estimated: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "key present (verified on first send)" };
  }

  private toContents(
    messages: ChatMessage[],
  ): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: messageParts(m),
      }));
  }

  private systemOf(messages: ChatMessage[]): {
    systemInstruction?: { parts: Array<{ text: string }> };
  } {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    return system === "" ? {} : { systemInstruction: { parts: [{ text: system }] } };
  }

  private async throwForStatus(res: Response, provider: string): Promise<never> {
    const body = (await res.text()).slice(0, 500);
    if (res.status === 400 && /api key/i.test(body)) {
      throw new AuthError(`${provider} auth failed (${res.status}): ${body}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`${provider} auth failed (${res.status}): ${body}`);
    }
    if (res.status === 429) {
      throw new QuotaError(`${provider} rate limited: ${body}`);
    }
    throw new DriverError(`${provider} request failed (${res.status}): ${body}`);
  }

  async sendMessage(messages: ChatMessage[]): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.fetchFn,
        `${this.baseUrl}/models/${this.apiModel}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...this.systemOf(messages), contents: this.toContents(messages) }),
        },
        CHAT_SEND_TIMEOUT_MS,
      );
    } catch (err) {
      throw new DriverError(
        `google network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) await this.throwForStatus(res, "google");
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
      usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
    if (text === "") throw new DriverError("google returned an empty reply");
    const usage: TokenUsage = {
      input: num(data.usageMetadata?.promptTokenCount),
      output: num(data.usageMetadata?.candidatesTokenCount),
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
        `${this.baseUrl}/models/${this.apiModel}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...this.systemOf(messages), contents: this.toContents(messages) }),
        },
        CHAT_STREAM_TIMEOUT_MS,
      );
    } catch (err) {
      throw new DriverError(
        `google network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok || res.body === null) {
      if (!res.ok) await this.throwForStatus(res, "google");
      throw new DriverError("google stream had no body");
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
          let event: unknown;
          try {
            event = JSON.parse(trimmed.slice(5).trim());
          } catch {
            continue;
          }
          const cands = (
            event as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }
          ).candidates;
          for (const part of cands?.[0]?.content?.parts ?? []) {
            if (typeof part.text === "string" && part.text !== "") {
              text += part.text;
              onToken(part.text);
            }
          }
        }
      }
    } catch (err) {
      throw new DriverError(
        `google network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (text === "") throw new DriverError("google returned an empty reply");
    const usage: TokenUsage = { input: 0, output: this.countTokens(text) };
    this.requests += 1;
    this.tokens += usage.output;
    return { text, usage };
  }
}
