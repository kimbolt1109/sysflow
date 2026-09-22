import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userSettingsPath, writeUserDefaultModel } from "@/infrastructure/userSettings.js";

describe("userSettings", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-userset-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists the default model", () => {
    writeUserDefaultModel(dir, "openai/gpt-5");

    const parsed = JSON.parse(readFileSync(userSettingsPath(dir), "utf8")) as {
      defaultModel: string;
    };
    expect(parsed.defaultModel).toBe("openai/gpt-5");
  });
});
