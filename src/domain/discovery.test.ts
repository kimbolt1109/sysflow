import { describe, expect, it } from "vitest";
import { mergeModels } from "@/domain/discovery.js";
import type { ModelInfo } from "@/domain/models.js";

const REGISTRY: ModelInfo[] = [
  {
    id: "google/gemini-pro",
    provider: "google",
    label: "Gemini Pro",
    contextWindow: 1000000,
    inputPricePerM: 1.25,
    outputPricePerM: 5,
    tags: ["cheap"],
  },
];

describe("discovery merge", () => {
  it("adds unknown models with source tags", () => {
    const merged = mergeModels(REGISTRY, [
      { id: "opencode/muse-spark", provider: "opencode", source: "opencode", free: true },
    ]);

    expect(merged).toHaveLength(2);
    const added = merged.find((m) => m.id === "opencode/muse-spark");
    expect(added?.tags).toEqual(["opencode", "free"]);
    expect(added?.source).toBe("opencode");
  });

  it("fills gaps on known models without clobbering registry data", () => {
    const merged = mergeModels(REGISTRY, [
      {
        id: "google/gemini-pro",
        provider: "google",
        label: "Gemini Pro (agy)",
        source: "agy",
        cliModel: "gemini-pro",
      },
    ]);

    expect(merged).toHaveLength(1);
    const kept = merged[0] as ModelInfo;
    expect(kept.label).toBe("Gemini Pro (agy)");
    expect(kept.inputPricePerM).toBe(1.25);
    expect(kept.cliModel).toBe("gemini-pro");
    expect(kept.tags).toContain("agy");
  });

  it("dedupes repeated discoveries", () => {
    const merged = mergeModels(REGISTRY, [
      { id: "x/y", provider: "x", source: "opencode" },
      { id: "x/y", provider: "x", source: "opencode" },
    ]);

    expect(merged.filter((m) => m.id === "x/y")).toHaveLength(1);
  });
});
