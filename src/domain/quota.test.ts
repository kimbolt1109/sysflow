import { describe, expect, it } from "vitest";
import { backoffDelay, budgetLevel, costFor, withFailover } from "@/domain/quota.js";
import { QuotaError } from "@/lib/errors.js";

describe("quota", () => {
  it("prices token usage from the registry", () => {
    const cost = costFor(
      {
        id: "m",
        provider: "p",
        label: "M",
        contextWindow: 1,
        inputPricePerM: 2,
        outputPricePerM: 8,
        tags: [],
      },
      { input: 1_000_000, output: 500_000 },
    );

    expect(cost).toBeCloseTo(6);
    expect(costFor(undefined, { input: 1, output: 1 })).toBe(0);
  });

  it("escalates warn, amber, and confirm levels", () => {
    const t = { warn: 0.7, amber: 0.85, confirm: 0.95 };

    expect(budgetLevel(1, 0, t)).toBe("ok");
    expect(budgetLevel(5, 10, t)).toBe("ok");
    expect(budgetLevel(7, 10, t)).toBe("warn");
    expect(budgetLevel(9, 10, t)).toBe("amber");
    expect(budgetLevel(10, 10, t)).toBe("confirm");
  });

  it("fails over to the next driver on 429", async () => {
    const delays: number[] = [];
    const seen: string[] = [];

    const result = await withFailover(
      ["a", "b"],
      async (driver) => {
        seen.push(driver);
        if (driver === "a") throw new QuotaError("limited", 50);
        return "from-b";
      },
      { sleep: async (ms) => void delays.push(ms), onRetry: (_a, d) => delays.push(d) },
    );

    expect(result).toBe("from-b");
    expect(seen).toEqual(["a", "b"]);
    expect(delays).toEqual([50, 50]);
  });

  it("backs off exponentially with jitter bounds", () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const delay = backoffDelay(attempt, 1000, 30000);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(30000);
    }
    expect(backoffDelay(1, 1000, 30000)).toBeLessThanOrEqual(backoffDelay(4, 1000, 30000) * 2 + 1);
  });

  it("rethrows non-quota errors immediately", async () => {
    await expect(
      withFailover(["a"], async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
