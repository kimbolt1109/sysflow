import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dailyTotals, loadDailyUsage, recordProviderUsage } from "@/infrastructure/usageStore.js";

describe("usageStore", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-usage-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accumulates per-provider usage for the day", () => {
    expect(loadDailyUsage(dir).providers).toEqual({});

    recordProviderUsage(dir, "anthropic", 100, 50, 0.5);
    const daily = recordProviderUsage(dir, "anthropic", 100, 50, 0.5);

    expect(daily.providers.anthropic).toEqual({ requests: 2, input: 200, output: 100, cost: 1 });
    expect(dailyTotals(daily)).toEqual({ requests: 2, cost: 1 });
  });
});
