import { describe, expect, it } from "vitest";
import { RetryDriver, retryDelayFor } from "@/infrastructure/retryDriver.js";
import { MockDriver } from "@/infrastructure/mockDriver.js";
import { AuthError, DriverError, QuotaError } from "@/lib/errors.js";
import type { SendResult } from "@/domain/drivers.js";

class FlakyDriver extends MockDriver {
  calls = 0;
  slept: number[] = [];

  constructor(private readonly script: Step[]) {
    super("mock/flaky");
  }

  override async sendMessage(): Promise<SendResult> {
    this.calls += 1;
    const step = this.script.shift() ?? { text: "done" };
    if ("error" in step) throw step.error;
    return { text: step.text, usage: { input: 1, output: 1 } };
  }

  override async streamMessage(
    messages: Parameters<MockDriver["streamMessage"]>[0],
    onToken: (token: string) => void,
  ): Promise<SendResult> {
    this.calls += 1;
    const step = this.script.shift() ?? { text: "done" };
    if ("error" in step) {
      if (step.afterTokens !== undefined) onToken(step.afterTokens);
      throw step.error;
    }
    onToken(step.text);
    return { text: step.text, usage: { input: 1, output: 1 } };
  }
}

type Step = { text: string } | { error: Error; afterTokens?: string };

function driverFor(script: Step[]): { flaky: FlakyDriver; driver: RetryDriver } {
  const flaky = new FlakyDriver(script);
  const driver = new RetryDriver(flaky, { sleep: async (ms) => void flaky.slept.push(ms) });
  return { flaky, driver };
}

describe("retryDriver", () => {
  it("passes through first-try success", async () => {
    const { flaky, driver } = driverFor([{ text: "hi" }]);
    const tokens: string[] = [];

    const result = await driver.streamMessage([], (t) => tokens.push(t));

    expect(result.text).toBe("hi");
    expect(tokens).toEqual(["hi"]);
    expect(flaky.calls).toBe(1);
    expect(driver.id).toBe("mock/flaky");
  });

  it("honors retry-after on 429s", async () => {
    const { flaky, driver } = driverFor([
      { error: new QuotaError("slow", 50) },
      { text: "recovered" },
    ]);

    const result = await driver.sendMessage([]);

    expect(result.text).toBe("recovered");
    expect(flaky.calls).toBe(2);
    expect(flaky.slept).toEqual([50]);
  });

  it("backs off on network and 5xx failures, then gives up", async () => {
    const { flaky, driver } = driverFor([
      { error: new DriverError("x network error: socket hang up") },
      { error: new DriverError("x request failed (503): busy") },
      { error: new DriverError("x request failed (503): busy") },
    ]);
    const notices: number[] = [];
    const retrying = new RetryDriver(flaky, {
      sleep: async (ms) => void flaky.slept.push(ms),
      onRetry: (n) => void notices.push(n.attempt),
    });

    await expect(retrying.sendMessage([])).rejects.toThrow("503");
    expect(flaky.calls).toBe(3);
    expect(notices).toEqual([1, 2]);
    expect(flaky.slept).toHaveLength(2);
    expect(driver.id).toBe("mock/flaky");
  });

  it("never retries auth errors", async () => {
    const { flaky, driver } = driverFor([{ error: new AuthError("bad key") }]);

    await expect(driver.sendMessage([])).rejects.toBeInstanceOf(AuthError);
    expect(flaky.calls).toBe(1);
    expect(flaky.slept).toEqual([]);
  });

  it("surfaces mid-stream breaks instead of duplicating output", async () => {
    const { flaky, driver } = driverFor([
      { error: new DriverError("x network error: reset"), afterTokens: "half" },
    ]);
    const tokens: string[] = [];

    await expect(driver.streamMessage([], (t) => tokens.push(t))).rejects.toThrow("reset");
    expect(tokens).toEqual(["half"]);
    expect(flaky.calls).toBe(1);
  });

  it("classifies retryable failures", () => {
    expect(retryDelayFor(new QuotaError("q", 2000), 1, 1000, 30000)).toBe(2000);
    expect(retryDelayFor(new QuotaError("q"), 1, 1000, 30000)).toBeGreaterThan(0);
    expect(retryDelayFor(new DriverError("n network error"), 1, 1000, 30000)).toBeGreaterThan(0);
    expect(
      retryDelayFor(new DriverError("f request failed (500)"), 1, 1000, 30000),
    ).toBeGreaterThan(0);
    expect(
      retryDelayFor(new DriverError("f request failed (400)"), 1, 1000, 30000),
    ).toBeUndefined();
    expect(retryDelayFor(new AuthError("no"), 1, 1000, 30000)).toBeUndefined();
    expect(retryDelayFor(new Error("weird"), 1, 1000, 30000)).toBeUndefined();
  });
});
