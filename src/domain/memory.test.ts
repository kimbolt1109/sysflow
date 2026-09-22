import { describe, expect, it } from "vitest";
import {
  buildMemoryBlock,
  expandAtFiles,
  legacyMemoryCandidates,
  memoryPaths,
} from "@/domain/memory.js";

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

  it("expands windows paths and spaced names", () => {
    const win = expandAtFiles("see @C:\\proj\\note.md", (p) =>
      p === "C:\\proj\\note.md" ? "WIN" : undefined,
    );
    expect(win).toContain("WIN");

    const spaced = expandAtFiles("see @my notes.md please", (p) =>
      p === "my notes.md" ? "SPACED" : undefined,
    );
    expect(spaced).toContain("SPACED");
  });

  it("keeps separators consistent for mixed inputs", () => {
    const paths = memoryPaths("C:\\Users\\u", "/proj");

    expect(paths.user).toBe("C:\\Users\\u\\.flow\\FLOW.md");
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
