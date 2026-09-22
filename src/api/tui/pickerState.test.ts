import { describe, expect, it } from "vitest";
import { applyPickerKey, initPickerState } from "@/api/tui/pickerState.js";
import type { ModelInfo } from "@/domain/models.js";

function model(id: string, provider: string): ModelInfo {
  return {
    id,
    provider,
    label: id,
    contextWindow: 1000,
    inputPricePerM: 0,
    outputPricePerM: 0,
    tags: [],
  };
}

const MODELS = [model("a/1", "a"), model("a/2", "a"), model("b/1", "b")];

describe("pickerState", () => {
  it("starts with a remembered selection", () => {
    expect(initPickerState(["a/1"]).selected).toEqual(["a/1"]);
    expect(initPickerState().selected).toEqual([]);
  });

  it("orders recent models first", () => {
    const state = initPickerState([], ["b/1"]);
    const step = applyPickerKey(MODELS, state, { input: "", enter: true });

    expect(step.state.selected).toEqual(["b/1"]);
  });

  it("toggles with enter and space without confirming", () => {
    let step = applyPickerKey(MODELS, initPickerState(), { input: "", enter: true });

    expect(step.done).toBeUndefined();
    expect(step.state.selected).toEqual(["a/1"]);
    expect(step.state.cursor).toBe(1);

    step = applyPickerKey(MODELS, step.state, { input: " " });

    expect(step.done).toBeUndefined();
    expect(step.state.selected).toEqual(["a/1", "a/2"]);
  });

  it("confirms with m only after a selection", () => {
    const selected = applyPickerKey(MODELS, initPickerState(), { input: "", enter: true });

    const done = applyPickerKey(MODELS, selected.state, { input: "m" });

    expect(done.done).toEqual(["a/1"]);

    const empty = applyPickerKey(MODELS, initPickerState(), { input: "m" });

    expect(empty.done).toBeUndefined();
    expect(empty.state.query).toBe("m");
  });

  it("moves, filters, clears, and cancels", () => {
    const start = initPickerState();
    const moved = applyPickerKey(MODELS, start, { input: "", upArrow: true });

    expect(moved.state.cursor).toBe(2);

    const typed = applyPickerKey(MODELS, start, { input: "b/" });

    expect(typed.state.query).toBe("b/");

    const cleared = applyPickerKey(MODELS, typed.state, { input: "", escape: true });

    expect(cleared.state.query).toBe("");
    expect(cleared.cancelled).toBeUndefined();

    const cancelled = applyPickerKey(MODELS, start, { input: "", escape: true });

    expect(cancelled.cancelled).toBe(true);
  });

  it("toggles a provider group with a", () => {
    const step = applyPickerKey(MODELS, initPickerState(), { input: "a" });

    expect(step.state.selected).toEqual(["a/1", "a/2"]);
  });
});
