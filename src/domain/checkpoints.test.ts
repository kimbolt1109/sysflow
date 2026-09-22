import { describe, expect, it } from "vitest";
import { describeCheckpoint, planRestore, takeCheckpoint } from "@/domain/checkpoints.js";

describe("checkpoints", () => {
  it("takes and plans restores", () => {
    const checkpoint = takeCheckpoint("id-1", "before council", [
      { path: "a.ts", content: "v1" },
      { path: "gone.ts", content: null },
    ]);

    expect(checkpoint.files["a.ts"]).toBe("v1");
    const plan = planRestore(checkpoint);
    expect(plan.write).toEqual([{ path: "a.ts", content: "v1" }]);
    expect(plan.remove).toEqual(["gone.ts"]);
  });

  it("describes checkpoints in one line", () => {
    expect(describeCheckpoint(takeCheckpoint("abcdefgh", "x", []))).toContain("abcdefgh");
  });
});
