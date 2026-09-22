import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import {
  loadLastSelection,
  MODE_DESCRIPTIONS,
  parseToggle,
  saveLastSelection,
} from "@/api/selector.js";
import { loadConfig } from "@/config.js";

describe("selector", () => {
  it("parses numeric toggles", () => {
    expect(parseToggle("1,3", 4)).toEqual([0, 2]);
    expect(parseToggle("2, 2", 4)).toEqual([1]);
    expect(() => parseToggle("9", 4)).toThrow("1–4");
    expect(() => parseToggle("x", 4)).toThrow("1–4");
  });

  it("describes every orchestration mode", () => {
    expect(Object.keys(MODE_DESCRIPTIONS).sort()).toEqual(
      ["auto", "council", "relay", "solo", "workers"].sort(),
    );
  });

  it("round-trips the last selection", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-sel-"));
    try {
      const data = join(dir, "data");
      const proj = join(dir, "proj");
      const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });
      const app = createApp(config);

      expect(loadLastSelection(app)).toBeUndefined();
      saveLastSelection(app, {
        models: [config.models[0]?.id ?? "x"],
        mode: "solo",
        thinking: "medium",
      });

      expect(loadLastSelection(app)?.mode).toBe("solo");
      expect(loadLastSelection(app)?.thinking).toBe("medium");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps discovered models when known ids are provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-sel-"));
    try {
      const data = join(dir, "data");
      const proj = join(dir, "proj");
      const config = loadConfig({ APP_DATA_DIR: data, APP_LOG_LEVEL: "error" }, { cwd: proj });
      const app = createApp(config);
      const registryId = config.models[0]?.id ?? "x";

      saveLastSelection(app, {
        models: ["custom/discovered", registryId],
        mode: "council",
        thinking: "xhigh",
      });

      expect(loadLastSelection(app)?.models).toEqual([registryId]);
      expect(loadLastSelection(app)?.recent).toEqual([registryId]);
      expect(loadLastSelection(app, new Set(["custom/discovered", registryId]))?.models).toEqual([
        "custom/discovered",
        registryId,
      ]);
      expect(loadLastSelection(app, new Set(["custom/discovered", registryId]))?.thinking).toBe(
        "xhigh",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("selector temp hygiene", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-selx-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it("uses an isolated dir", () => {
    expect(dir).toContain("flow-selx-");
  });
});
