import { describe, expect, it } from "vitest";
import {
  filterModels,
  flattenGroups,
  groupModels,
  moveCursor,
  PICKER_PLAIN,
  PICKER_THEME,
  renderPicker,
  toggleGroup,
  toggleSelected,
} from "@/api/modelPicker";
import type { ModelInfo } from "@/domain/models";

function model(id: string, provider: string, tags: string[] = []): ModelInfo {
  return {
    id,
    provider,
    label: id,
    contextWindow: 1000,
    inputPricePerM: 0,
    outputPricePerM: 0,
    tags,
  };
}

describe("modelPicker", () => {
  it("groups and flattens preserving order", () => {
    const groups = groupModels([model("b/2", "b"), model("a/1", "a"), model("b/3", "b")]);

    expect([...groups.keys()]).toEqual(["b", "a"]);
    expect(flattenGroups(groups).map((i) => i.model.id)).toEqual(["b/2", "b/3", "a/1"]);
  });

  it("filters by id, label, or provider", () => {
    const models = [model("google/gemini-pro", "google"), model("openai/gpt-5", "openai")];

    expect(filterModels(models, "")).toHaveLength(2);
    expect(filterModels(models, "GEMINI").map((m) => m.id)).toEqual(["google/gemini-pro"]);
    expect(filterModels(models, "openai").map((m) => m.id)).toEqual(["openai/gpt-5"]);
    expect(filterModels(models, "nope")).toHaveLength(0);
  });

  it("moves the cursor with wraparound", () => {
    expect(moveCursor(0, -1, 3)).toBe(2);
    expect(moveCursor(2, 1, 3)).toBe(0);
    expect(moveCursor(0, 1, 0)).toBe(0);
  });

  it("toggles single ids and whole provider groups", () => {
    const selected = new Set<string>();
    toggleSelected(selected, "a/1");
    toggleSelected(selected, "a/1");

    expect(selected.size).toBe(0);

    const items = flattenGroups(
      groupModels([model("a/1", "a"), model("a/2", "a"), model("b/1", "b")]),
    );
    toggleGroup(selected, items, "a");
    expect([...selected].sort()).toEqual(["a/1", "a/2"]);
    toggleGroup(selected, items, "a");
    expect(selected.size).toBe(0);
  });

  it("renders highlight, marks, free badges, and footers", () => {
    const items = flattenGroups(groupModels([model("a/1", "a", ["free"]), model("b/1", "b")]));
    const selected = new Set(["b/1"]);
    const rendered = renderPicker(PICKER_THEME, items, 1, selected, "", 20);

    expect(rendered.text).toContain("Select model");
    expect(rendered.text).toContain("Free");
    expect(rendered.text).toContain("●");
    expect(rendered.text).toContain("○");
    expect(rendered.text).toContain("1 selected");
    expect(rendered.lines).toBeGreaterThan(5);
  });

  it("renders plain output without escape codes", () => {
    const items = flattenGroups(groupModels([model("a/1", "a")]));
    const rendered = renderPicker(PICKER_PLAIN, items, 0, new Set(), "a", 20);

    expect(rendered.text).not.toContain("\x1b");
    expect(rendered.text).toContain("> ");
  });
});
