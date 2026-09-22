import { describe, expect, it, vi } from "vitest";
import { renderToString } from "ink";
import React from "react";
import { ModePicker } from "@/api/tui/ModePicker.js";
import { Picker } from "@/api/tui/Picker.js";
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

describe("tui Picker", () => {
  it("renders groups, marks, and the m-done footer", () => {
    const out = renderToString(
      <Picker
        models={[model("a/1", "a", ["free"]), model("b/1", "b")]}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(out).toContain("Select models");
    expect(out).toContain("a/1");
    expect(out).toContain("b/1");
    expect(out).toContain("Free");
    expect(out).toContain("m done");
  });

  it("shows a recent group on top", () => {
    const out = renderToString(
      <Picker
        models={[model("a/1", "a"), model("b/1", "b")]}
        recent={["b/1"]}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(out).toContain("recent");
    expect(out.indexOf("recent")).toBeLessThan(out.indexOf("b/1"));
  });
});

describe("tui ModePicker", () => {
  it("renders every mode and calls back on select", () => {
    const onDone = vi.fn();
    const out = renderToString(
      <ModePicker defaultMode="council" onDone={onDone} onCancel={() => {}} />,
    );

    expect(out).toContain("Select mode");
    for (const mode of ["solo", "council", "relay", "workers", "auto"]) {
      expect(out).toContain(mode);
    }
    expect(onDone).not.toHaveBeenCalled();
  });
});
