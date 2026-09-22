import { describe, expect, it } from "vitest";
import {
  buildPickerItems,
  filterModels,
  flattenGroups,
  groupModels,
  moveCursor,
  PICKER_PLAIN,
  PICKER_THEME,
  renderPicker,
  shouldConfirmWithM,
  toggleGroup,
  toggleSelected,
} from "@/api/modelPicker.js";
import type { ModelInfo } from "@/domain/models.js";

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

    expect(rendered.text).toContain("Select models");
    expect(rendered.text).toContain("Free");
    expect(rendered.text).toContain("●");
    expect(rendered.text).toContain("○");
    expect(rendered.text).toContain("1 selected");
    expect(rendered.text).toContain("Enter/Space toggle");
    expect(rendered.text).toContain("m done");
    expect(rendered.text).not.toContain("Enter confirm");
    expect(rendered.lines).toBeGreaterThan(5);
  });

  it("hides m done while filtering so m can type", () => {
    const items = flattenGroups(groupModels([model("a/1", "a")]));
    const rendered = renderPicker(PICKER_PLAIN, items, 0, new Set(["a/1"]), "mis", 20);

    expect(rendered.text).toContain("Enter/Space toggle");
    expect(rendered.text).toContain("Esc clear");
    expect(rendered.text).not.toContain("m done");
  });

  it("confirms with m only after at least one Enter/Space selection", () => {
    expect(shouldConfirmWithM("m", false, "", 1)).toBe(true);
    expect(shouldConfirmWithM("M", false, "", 2)).toBe(true);
    expect(shouldConfirmWithM("m", false, "", 0)).toBe(false);
    expect(shouldConfirmWithM("m", false, "mis", 1)).toBe(false);
    expect(shouldConfirmWithM("m", true, "", 1)).toBe(false);
    expect(shouldConfirmWithM("x", false, "", 1)).toBe(false);
    expect(shouldConfirmWithM(undefined, false, "", 1)).toBe(false);
  });

  it("renders plain output without escape codes", () => {
    const items = flattenGroups(groupModels([model("a/1", "a")]));
    const rendered = renderPicker(PICKER_PLAIN, items, 0, new Set(), "a", 20);

    expect(rendered.text).not.toContain("\x1b");
    expect(rendered.text).toContain("> ");
  });

  it("puts recent models first without duplicating provider rows", () => {
    const models = [model("a/1", "a"), model("b/1", "b")];
    const items = buildPickerItems(models, "", ["b/1", "missing", "b/1"]);

    expect(items.map((i) => i.model.id)).toEqual(["b/1", "a/1"]);
    expect(items[0]?.provider).toBe("recent");
    expect(items[1]?.provider).toBe("a");
  });

  it("hides the recent group while filtering", () => {
    const models = [model("a/1", "a"), model("b/1", "b")];

    expect(buildPickerItems(models, "b", ["a/1"]).map((i) => i.model.id)).toEqual(["b/1"]);
    expect(buildPickerItems(models, "", []).map((i) => i.model.id)).toEqual(["a/1", "b/1"]);
  });
});
