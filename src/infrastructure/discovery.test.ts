import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheIsFresh,
  discoverAgyModels,
  discoverAll,
  discoverGrokModels,
  discoverOllamaModels,
  discoverOpencodeModels,
  discoverOpenRouterModels,
  loadDiscoveryCache,
  mapAgyModel,
  saveDiscoveryCache,
} from "@/infrastructure/discovery.js";

describe("cli probers", () => {
  it("parses opencode provider/model lines", () => {
    const models = discoverOpencodeModels(
      () => "opencode/muse-spark\nopenrouter/a:free\n\nnoise\n",
    );

    expect(models.map((m) => m.id)).toEqual(["opencode/muse-spark", "openrouter/a:free"]);
    expect(models[1]?.free).toBe(true);
    expect(models.every((m) => m.source === "opencode")).toBe(true);
  });

  it("maps agy ids to provider namespaces with cliModel kept", () => {
    expect(mapAgyModel("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)")).toMatchObject({
      id: "google/gemini-3.8-flash-high",
      provider: "google",
      cliModel: "gemini-3.8-flash-high",
      source: "agy",
    });
    expect(mapAgyModel("claude-sonnet-4-6", "x").id).toBe("anthropic/claude-sonnet-4-6");
    expect(mapAgyModel("gpt-oss-120b-medium", "x")).toMatchObject({
      id: "openai/gpt-oss-120b-medium",
      cliModel: "gpt-oss-120b-medium",
    });
    expect(mapAgyModel("weird-1", "Weird").id).toBe("agy/weird-1");
  });

  it("parses agy tab-separated output skipping the fetching line", () => {
    const models = discoverAgyModels(
      () => "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n",
    );

    expect(models).toHaveLength(1);
    expect(models[0]?.label).toBe("Gemini 3.8 Flash (High)");
  });

  it("parses grok's available-models section", () => {
    const out =
      "You are not authenticated.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  grok-4.5\n";
    const models = discoverGrokModels(() => out);

    expect(models.map((m) => m.id)).toEqual(["grok/grok-4.6", "grok/grok-4.5"]);
    expect(models[0]?.cliModel).toBe("grok-4.6");
  });
});

describe("api probers", () => {
  it("lists ollama tags", async () => {
    const fetchFn = vi.fn(async (_input: unknown, _init?: unknown) =>
      Response.json({ models: [{ name: "llama3:latest" }, { name: "" }] }),
    );

    const models = await discoverOllamaModels(fetchFn, "http://localhost:11434/v1");

    expect(models.map((m) => m.id)).toEqual(["ollama/llama3:latest"]);
    expect(models[0]?.free).toBe(true);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("http://localhost:11434/api/tags");
  });

  it("converts openrouter per-token pricing to per-1M", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "anthropic/x",
            context_length: 200000,
            pricing: { prompt: "0.000003", completion: "0.000015" },
          },
          { id: "", context_length: 0, pricing: {} },
        ],
      }),
    );

    const models = await discoverOpenRouterModels(fetchFn);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "openrouter/anthropic/x",
      contextWindow: 200000,
      inputPricePerM: 3,
      outputPricePerM: 15,
    });
  });

  it("collects successes across sources", async () => {
    const models = await discoverAll({
      run: (command) => {
        if (command === "agy") return "gemini-1\tG1\n";
        throw new Error("missing");
      },
      fetchFn: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
      ollamaBaseUrl: "http://localhost:11434/v1",
    });

    expect(models.map((m) => m.id)).toEqual(["google/gemini-1"]);
  });
});

describe("discovery cache", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-discover-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips and checks freshness", () => {
    expect(loadDiscoveryCache(dir)).toBeUndefined();

    saveDiscoveryCache(dir, [{ id: "a/b", provider: "a", source: "opencode" }]);
    const cache = loadDiscoveryCache(dir);

    expect(cache?.models).toHaveLength(1);
    expect(cacheIsFresh(cache?.at ?? "", Date.now())).toBe(true);
    expect(cacheIsFresh(new Date(Date.now() - 3600000).toISOString(), Date.now())).toBe(false);
    expect(cacheIsFresh("garbage", Date.now())).toBe(false);
  });
});
