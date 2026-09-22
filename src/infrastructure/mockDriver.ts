import type { ChatMessage, QuotaInfo } from "@/domain/models.js";
import type { Driver, SendResult } from "@/domain/drivers.js";

export class MockDriver implements Driver {
  readonly kind = "native" as const;

  constructor(readonly id = "mock/echo") {}

  countTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async getQuota(): Promise<QuotaInfo> {
    return {
      provider: "mock",
      requestsToday: 0,
      tokensToday: 0,
      costToday: 0,
      estimated: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "mock driver (no network)" };
  }

  async sendMessage(messages: ChatMessage[]): Promise<SendResult> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const text = `mock:${last?.content ?? ""}`;
    return {
      text,
      usage: { input: this.countTokens(last?.content ?? ""), output: this.countTokens(text) },
    };
  }

  async streamMessage(
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<SendResult> {
    const result = await this.sendMessage(messages);
    for (const word of result.text.split(/(?<=\s)/)) {
      if (word !== "") onToken(word);
    }
    return result;
  }
}
