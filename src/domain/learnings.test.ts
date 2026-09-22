import { describe, expect, it } from "vitest";
import { extractLessons, lessonsContext } from "@/domain/learnings.js";

const failed = {
  type: "council-end",
  lead: "a",
  paused: false,
  verify: [
    {
      agent: "a",
      lens: "security",
      score: 40,
      passed: false,
      notes: "shell injection",
      checks: [],
    },
    { agent: "b", lens: "correctness", score: 90, passed: true, notes: "fine", checks: [] },
  ],
  retros: { a: "test shell quoting first", b: "  " },
};

describe("learnings", () => {
  it("extracts failed verifications and retros, skipping passes and blanks", () => {
    const lessons = extractLessons([[failed]]);

    expect(lessons).toHaveLength(2);
    expect(lessons[0]).toEqual({ kind: "verify", text: "[a/security 40%] shell injection" });
    expect(lessons[1]).toEqual({ kind: "retro", text: "[a] test shell quoting first" });
  });

  it("captures pause reasons so rejections teach too", () => {
    const lessons = extractLessons([
      [{ type: "council-end", paused: true, pauseReason: "2 reviewers rejected", verify: [] }],
    ]);

    expect(lessons).toEqual([{ kind: "paused", text: "2 reviewers rejected" }]);
  });

  it("ignores non-council records and keeps the most recent cap", () => {
    const lessons = extractLessons([[{ type: "user", text: "hi" }], [failed, failed]], 3);

    expect(lessons).toHaveLength(3);
  });

  it("renders a context block or empty string", () => {
    expect(lessonsContext([])).toBe("");
    const block = lessonsContext([{ kind: "retro", text: "[a] quote first" }]);
    expect(block).toContain("Past council lessons");
    expect(block).toContain("quote first");
    const trimmed = lessonsContext(
      [
        { kind: "retro", text: "old" },
        { kind: "retro", text: "new" },
      ],
      100,
    );
    expect(trimmed).toContain("new");
  });
});
