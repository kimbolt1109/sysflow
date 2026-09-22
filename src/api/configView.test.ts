import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { describeConfig } from "@/api/configView.js";
import { loadConfig } from "@/config.js";

describe("configView", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-cfgview-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("describes config without leaking secrets", () => {
    const config = loadConfig(
      { APP_DATA_DIR: join(dir, "data"), APP_LOG_LEVEL: "error", APP_ANTHROPIC_API_KEY: "secret" },
      { cwd: join(dir, "proj") },
    );
    const app = createApp(config);
    const text = describeConfig(app);

    expect(text).toContain("model:");
    expect(text).toContain("anthropic=set");
    expect(text).not.toContain("secret");
    expect(describeConfig(app, "model")).toContain(config.defaultModel);
    expect(describeConfig(app, "bogus")).toContain("unknown key");
  });
});
