import { describe, expect, it } from "vitest";
import { findModel, listModels, modelsByProvider, requireModel } from "@/domain/modelRegistry";
import type { ModelInfo } from "@/domain/models";

const MODELS: ModelInfo[] = [
  {
    id: "anthropic/claude-test",
    provider: "anthropic",
    label: "Claude Test",
    contextWindow: 200000,
    inputPricePerM: 3,
    outputPricePerM: 15,
    tags: [],
  },
  {
    id: "openai/gpt-test",
    provider: "openai",
    label: "GPT Test",
    contextWindow: 128000,
    inputPricePerM: 2,
    outputPricePerM: 8,
    tags: [],
  },
];

describe("modelRegistry", () => {
  it("lists models without mutating the input", () => {
    const listed = listModels(MODELS);

    expect(listed).toEqual(MODELS);
    expect(listed).not.toBe(MODELS);
  });

  it("finds a model by id", () => {
    expect(findModel(MODELS, "openai/gpt-test")?.label).toBe("GPT Test");
    expect(findModel(MODELS, "missing/nope")).toBeUndefined();
  });

  it("groups models by provider", () => {
    const groups = modelsByProvider(MODELS);

    expect([...groups.keys()].sort()).toEqual(["anthropic", "openai"]);
    expect(groups.get("anthropic")).toHaveLength(1);
  });

  it("requires an existing model", () => {
    expect(requireModel(MODELS, "anthropic/claude-test").provider).toBe("anthropic");
    expect(() => requireModel(MODELS, "missing/nope")).toThrow('unknown model "missing/nope"');
  });
});
