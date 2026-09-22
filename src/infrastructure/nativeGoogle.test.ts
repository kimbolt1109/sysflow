import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleDriver } from "@/infrastructure/nativeGoogle.js";
import { AuthError } from "@/lib/errors.js";

describe("GoogleDriver", () => {
  it("sends generateContent and returns text plus usage", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "namaste" }] } }],
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
          }),
          { status: 200 },
        ),
    );
    const driver = new GoogleDriver({ apiKey: "k", model: "google/gemini-pro", fetchFn });

    const result = await driver.sendMessage([{ role: "user", content: "hi" }]);

    expect(result.text).toBe("namaste");
    expect(result.usage).toEqual({ input: 4, output: 6 });
    const call = fetchFn.mock.calls[0] as [string, RequestInit] | undefined;
    expect(call?.[0]).toContain("gemini-pro:generateContent");
  });

  it("throws AuthError on 403", async () => {
    const fetchFn = vi.fn(async () => new Response("bad key", { status: 403 }));
    const driver = new GoogleDriver({ apiKey: "k", model: "google/gemini-pro", fetchFn });

    await expect(driver.sendMessage([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("sends screenshots as inlineData parts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-shot-"));
    try {
      const path = join(dir, "shot.png");
      writeFileSync(path, Buffer.from("fakepng"));
      const fetchFn = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: "seen" }] } }] }),
            { status: 200 },
          ),
      );
      const driver = new GoogleDriver({ apiKey: "k", model: "google/gemini-pro", fetchFn });

      await driver.sendMessage([{ role: "user", content: "look", images: [path] }]);

      const call = fetchFn.mock.calls[0] as [string, RequestInit] | undefined;
      const body = String((call as [string, RequestInit])[1].body);
      expect(body).toContain("inlineData");
      expect(body).toContain(Buffer.from("fakepng").toString("base64"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("streams SSE parts to onToken", async () => {
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"b"}]}}]}\n\n';
    const fetchFn = vi.fn(async () => new Response(sse, { status: 200 }));
    const driver = new GoogleDriver({ apiKey: "k", model: "google/gemini-pro", fetchFn });
    const tokens: string[] = [];

    const result = await driver.streamMessage([{ role: "user", content: "hi" }], (t) =>
      tokens.push(t),
    );

    expect(result.text).toBe("ab");
    expect(tokens).toEqual(["a", "b"]);
  });
});
