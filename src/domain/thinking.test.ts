import { describe, expect, it } from "vitest";
import {
  isThinkingLevel,
  pushRecent,
  RECENT_CAP,
  thinkingDirective,
  THINKING_DESCRIPTIONS,
  THINKING_LEVELS,
} from "@/domain/thinking.js";

describe("thinking", () => {
  it("describes every level", () => {
    expect(THINKING_LEVELS).toEqual(["low", "medium", "high", "xhigh"]);
    for (const level of THINKING_LEVELS) {
      expect(THINKING_DESCRIPTIONS[level]).toContain(level);
      expect(thinkingDirective(level)).toContain(level);
    }
  });

  it("validates level names", () => {
    expect(isThinkingLevel("xhigh")).toBe(true);
    expect(isThinkingLevel("ultra")).toBe(false);
  });

  it("keeps recent picks deduped and capped", () => {
    expect(pushRecent(["b", "c"], ["a"])).toEqual(["a", "b", "c"]);
    expect(pushRecent(["a", "b"], ["b", "c"])).toEqual(["b", "c", "a"]);
    const many = Array.from({ length: RECENT_CAP + 5 }, (_, i) => `m${i}`);
    expect(pushRecent([], many)).toHaveLength(RECENT_CAP);
  });
});
