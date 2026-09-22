import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnthropicDriver } from "@/infrastructure/nativeAnthropic.js";
import { AuthError, QuotaError } from "@/lib/errors.js";
import type { ChatMessage } from "@/domain/models.js";

const MESSAGES: ChatMessage[] = [{ role: "user", content: "hi" }];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("AnthropicDriver", () => {
  it("sends messages and returns text plus usage", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    );
    const driver = new AnthropicDriver({ apiKey: "k", model: "anthropic/claude-sonnet", fetchFn });

    const result = await driver.sendMessage(MESSAGES);

    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({ input: 5, output: 7 });
    expect(fetchFn).toHaveBeenCalledOnce();
    const call = fetchFn.mock.calls[0] as [string, RequestInit] | undefined;
    expect(call).toBeDefined();
    const init = (call as [string, RequestInit])[1] as { body?: unknown };
    expect(String(init.body)).toContain("claude-sonnet");
  });

  it("throws AuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("bad key", { status: 401 }));
    const driver = new AnthropicDriver({ apiKey: "k", model: "anthropic/x", fetchFn });

    await expect(driver.sendMessage(MESSAGES)).rejects.toBeInstanceOf(AuthError);
  });

  it("sends screenshots as base64 image blocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-shot-"));
    try {
      const path = join(dir, "shot.png");
      writeFileSync(path, Buffer.from("fakepng"));
      const fetchFn = vi.fn(async () =>
        jsonResponse({ content: [{ type: "text", text: "seen" }] }),
      );
      const driver = new AnthropicDriver({ apiKey: "k", model: "anthropic/x", fetchFn });

      await driver.sendMessage([
        { role: "tool", name: "screenshot", content: "saved", images: [path] },
      ]);

      const call = fetchFn.mock.calls[0] as [string, RequestInit] | undefined;
      const body = String((call as [string, RequestInit])[1].body);
      expect(body).toContain('"type":"image"');
      expect(body).toContain(Buffer.from("fakepng").toString("base64"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws QuotaError with retry delay on 429", async () => {
    const fetchFn = vi.fn(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
    );
    const driver = new AnthropicDriver({ apiKey: "k", model: "anthropic/x", fetchFn });

    const err = await driver.sendMessage(MESSAGES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaError);
    expect((err as QuotaError).retryAfterMs).toBe(2000);
  });

  it("streams SSE deltas to onToken", async () => {
    const sse =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"he"}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"llo"}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const fetchFn = vi.fn(async () => new Response(sse, { status: 200 }));
    const driver = new AnthropicDriver({ apiKey: "k", model: "anthropic/x", fetchFn });
    const tokens: string[] = [];

    const result = await driver.streamMessage(MESSAGES, (t) => tokens.push(t));

    expect(result.text).toBe("hello");
    expect(tokens).toEqual(["he", "llo"]);
  });

  it("estimates tokens and reports quota", async () => {
    const driver = new AnthropicDriver({ apiKey: "k", model: "anthropic/x", fetchFn: vi.fn() });

    expect(driver.countTokens("abcd")).toBe(1);
    expect(driver.countTokens("")).toBe(1);
    const quota = await driver.getQuota();
    expect(quota.provider).toBe("anthropic");
    expect(quota.estimated).toBe(true);
  });
});
