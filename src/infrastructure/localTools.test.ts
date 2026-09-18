import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalTools, matchGlobParts } from "@/infrastructure/localTools";

describe("matchGlobParts", () => {
  it("matches *, **, and ?", () => {
    expect(matchGlobParts("src/*.ts", "src/a.ts")).toBe(true);
    expect(matchGlobParts("src/*.ts", "src/a/b.ts")).toBe(false);
    expect(matchGlobParts("src/**/*.ts", "src/a/b.ts")).toBe(true);
    expect(matchGlobParts("a?c", "abc")).toBe(true);
  });
});

describe("LocalTools", () => {
  let dir = "";
  let tools: LocalTools;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flow-tools-"));
    tools = new LocalTools(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes, reads, and edits files", async () => {
    expect((await tools.write("docs/note.txt", "hello")).ok).toBe(true);
    expect((await tools.read("docs/note.txt")).output).toBe("hello");
    expect((await tools.edit("docs/note.txt", "hello", "bye")).ok).toBe(true);
    expect((await tools.read("docs/note.txt")).output).toBe("bye");
  });

  it("rejects ambiguous edits without replaceAll", async () => {
    await tools.write("a.txt", "x x x");
    const result = await tools.edit("a.txt", "x", "y");

    expect(result.ok).toBe(false);
    expect(result.output).toContain("multiple matches");
  });

  it("refuses paths escaping the workspace", () => {
    expect(() => tools.resolveInRoot("../outside.txt")).toThrow("escapes workspace");
  });

  it("globs and greps workspace files", async () => {
    await tools.write("src/a.ts", "const answer = 42;\n");
    await tools.write("src/b.md", "nothing here\n");

    const globbed = await tools.glob("src/**/*.ts");
    expect(globbed.ok).toBe(true);
    expect(globbed.output).toContain("src/a.ts");

    const grepped = await tools.grep("answer");
    expect(grepped.ok).toBe(true);
    expect(grepped.output).toContain("src/a.ts:1:");
  });

  it("runs shell commands", async () => {
    await writeFile(join(dir, "x.txt"), "data");
    const result = await tools.bash("node -e \"process.stdout.write('ok')\"");

    expect(result.ok).toBe(true);
    expect(result.output).toBe("ok");
  });
});
