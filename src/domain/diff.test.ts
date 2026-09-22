import { describe, expect, it } from "vitest";
import { diffCheckpoints, diffFile } from "@/domain/diff.js";

describe("diff", () => {
  it("marks added and removed lines", () => {
    const diff = diffFile("a.ts", "one\ntwo\n", "one\nthree\n");

    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.lines.map((l) => `${l.op}${l.text}`)).toEqual([" one", "-two", "+three", " "]);
  });

  it("renders new and deleted files whole", () => {
    expect(diffFile("n.ts", null, "x\n").lines.map((l) => l.op)).toEqual(["+", "+"]);
    expect(diffFile("d.ts", "x\n", null).lines[0]).toMatchObject({ op: "-" });
    expect(diffFile("s.ts", "same\n", "same\n").lines).toEqual([]);
  });

  it("caps output and flags binary or large files", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `l${i}`).join("\n");
    expect(diffFile("b.ts", big, `${big}\nmore`).lines[0]?.op).toBe("~");
    expect(diffFile("bin", "a\0b", "a\0c").lines[0]?.text).toContain("binary");
  });

  it("diffs two snapshots sorted by path", () => {
    const diffs = diffCheckpoints(
      { "b.ts": "1\n", "a.ts": "same\n" },
      { "b.ts": "2\n", "a.ts": "same\n" },
    );

    expect(diffs.map((d) => d.path)).toEqual(["b.ts"]);
    expect(diffs[0]?.added).toBe(1);
  });
});
