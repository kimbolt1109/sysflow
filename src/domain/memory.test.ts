import { describe, expect, it } from "vitest";
import {
  buildMemoryBlock,
  expandAtFiles,
  legacyMemoryCandidates,
  memoryPaths,
} from "@/domain/memory";

describe("memory", () => {
  it("resolves the FLOW.md hierarchy", () => {
    const paths = memoryPaths("/home/u", "/proj");

    expect(paths.user).toBe("/home/u/.flow/FLOW.md");
    expect(paths.project).toBe("/proj/.flow/FLOW.md");
    expect(paths.local).toBe("/proj/.flow/FLOW.local.md");
  });

  it("detects legacy memory files for one-time import", () => {
    expect(legacyMemoryCandidates("/proj")).toEqual([
      "/proj/CLAUDE.md",
      "/proj/AGENTS.md",
      "/proj/GEMINI.md",
    ]);
  });

  it("expands @file imports", () => {
    const out = expandAtFiles("see @a.txt please", (p) => (p === "a.txt" ? "CONTENT" : undefined));

    expect(out).toContain("[@a.txt]");
    expect(out).toContain("CONTENT");
    expect(expandAtFiles("see @missing.txt", () => undefined)).toContain("@missing.txt");
  });

  it("builds a memory block skipping empties", () => {
    expect(buildMemoryBlock([])).toBe("");
    expect(
      buildMemoryBlock([
        { path: "u", content: "" },
        { path: "p", content: "hello" },
      ]),
    ).toContain("hello");
  });
});
