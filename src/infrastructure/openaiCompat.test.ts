import { describe, expect, it, vi } from "vitest";
import { createOllamaDriver, createOpenaiDriver } from "@/infrastructure/openaiCompat";
import { AuthError } from "@/lib/errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("openaiCompat", () => {
  it("sends chat completions and returns text plus usage", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "hi there" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
    const driver = createOpenaiDriver("openai/gpt-5", "k", fetchFn);

    const result = await driver.sendMessage([{ role: "user", content: "hi" }]);

    expect(result.text).toBe("hi there");
    expect(result.usage).toEqual({ input: 3, output: 4 });
    const call = fetchFn.mock.calls[0] as [string, RequestInit] | undefined;
    expect(call).toBeDefined();
    const init = (call as [string, RequestInit])[1] as { body?: unknown };
    expect(String(init.body)).toContain("gpt-5");
  });

  it("throws AuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    const driver = createOpenaiDriver("openai/gpt-5", "k", fetchFn);

    await expect(driver.sendMessage([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("streams deltas until [DONE]", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
      "data: [DONE]\n\n";
    const fetchFn = vi.fn(async () => new Response(sse, { status: 200 }));
    const driver = createOpenaiDriver("openai/gpt-5", "k", fetchFn);
    const tokens: string[] = [];

    const result = await driver.streamMessage([{ role: "user", content: "hi" }], (t) =>
      tokens.push(t),
    );

    expect(result.text).toBe("ab");
    expect(tokens).toEqual(["a", "b"]);
  });

  it("treats ollama as keyless local", async () => {
    const driver = createOllamaDriver("ollama/llama3", "http://localhost:11434/v1", vi.fn());

    expect((await driver.healthCheck()).ok).toBe(true);
    expect((await driver.getQuota()).provider).toBe("ollama");
  });
});
