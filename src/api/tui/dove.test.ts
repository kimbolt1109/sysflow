import { describe, expect, it } from "vitest";
import { DOVE_ART, DOVE_BLUE, DOVE_NAME, DOVE_TAGLINE, doveGreeting } from "@/api/tui/dove.js";

describe("dove", () => {
  it("has a compact single-width mark", () => {
    expect(DOVE_ART.length).toBeGreaterThan(2);
    for (const line of DOVE_ART) {
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(20);
      expect([...line].every((ch) => (ch.codePointAt(0) ?? 0) < 128)).toBe(true);
    }
  });

  it("carries the brand tone and persona", () => {
    expect(DOVE_BLUE).toBe("#9fbff2");
    expect(DOVE_NAME).toBe("Dove");
    expect(DOVE_TAGLINE.length).toBeGreaterThan(0);
    expect(doveGreeting()).toContain("Dove is ready");
  });
});
