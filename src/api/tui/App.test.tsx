import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import React from "react";
import type { FlowApp } from "@/app.js";
import { App, visibleRows } from "@/api/tui/App.js";
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

const app = {
  config: { defaultModel: "a/1" },
  skills: [],
  subagents: [],
  customCommands: [],
} as unknown as FlowApp;

describe("tui App", () => {
  it("lists visible rows provider-first with a limit", () => {
    const models = [model("b/2", "b"), model("a/1", "a")];

    expect(visibleRows(models, 1)).toEqual(["b b/2"]);
    expect(visibleRows(models, 10)).toEqual(["b b/2", "a a/1"]);
    expect(visibleRows(models, 0)).toEqual([]);
  });

  it("opens on the model picker", () => {
    const out = renderToString(
      <App
        app={app}
        models={[model("a/1", "a")]}
        notify={false}
        yolo={false}
        permission={{ current: "default" }}
        createAgents={() => []}
        createDriver={() => {
          throw new Error("unused");
        }}
      />,
    );

    expect(out).toContain("Select models");
    expect(out).toContain("a/1");
    expect(out).toContain("m done");
  });
});
