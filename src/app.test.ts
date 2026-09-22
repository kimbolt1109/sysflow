import { describe, expect, it } from "vitest";
import { recallLessons, type FlowApp } from "@/app.js";

function sessionsWith(records: unknown[][]): FlowApp["sessions"] {
  const ids = records.map((_, i) => `s${i}`);
  return {
    list: () => ids,
    load: (id: string) => records[Number(id.slice(1))] ?? [],
  } as unknown as FlowApp["sessions"];
}

describe("recallLessons", () => {
  it("returns empty when there is nothing to teach", () => {
    expect(recallLessons(sessionsWith([[]]))).toBe("");
    expect(recallLessons(sessionsWith([[{ type: "user", text: "hi" }]]))).toBe("");
  });

  it("surfaces failed verifications from past council runs", () => {
    const block = recallLessons(
      sessionsWith([
        [
          {
            type: "council-end",
            paused: false,
            verify: [
              {
                agent: "a",
                lens: "security",
                score: 30,
                passed: false,
                notes: "quote shell",
                checks: [],
              },
            ],
            retros: {},
          },
        ],
      ]),
    );

    expect(block).toContain("Past council lessons");
    expect(block).toContain("quote shell");
  });

  it("never throws on hostile stores", () => {
    const broken = {
      list: () => {
        throw new Error("disk gone");
      },
      load: () => [],
    } as unknown as FlowApp["sessions"];

    expect(recallLessons(broken)).toBe("");
  });
});
