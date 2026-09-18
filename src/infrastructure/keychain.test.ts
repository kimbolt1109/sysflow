import { describe, expect, it } from "vitest";
import { probeKeychain } from "@/infrastructure/keychain";

describe("keychain", () => {
  it("probes without throwing", () => {
    const probe = probeKeychain();

    expect(typeof probe.ok).toBe("boolean");
    expect(probe.detail.length).toBeGreaterThan(0);
  });
});
