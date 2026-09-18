import { mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverCommands } from "@/infrastructure/commandStore";
import {
  findLegacyImport,
  loadMemoryFiles,
  writeProjectMemory,
} from "@/infrastructure/memoryStore";
import { discoverSkills, loadSkillBody } from "@/infrastructure/skillStore";
import { discoverSubagents } from "@/infrastructure/subagentStore";

describe("extension stores", () => {
  let dir = "";
  let data = "";
  let proj = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-stores-"));
    data = join(dir, "data");
    proj = join(dir, "proj");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("discovers skills with project override", () => {
    mkdirSync(join(data, "skills", "a"), { recursive: true });
    writeFileSync(
      join(data, "skills", "a", "SKILL.md"),
      "---\nname: a\ndescription: user A\n---\n",
    );
    mkdirSync(join(proj, ".flow", "skills", "a"), { recursive: true });
    writeFileSync(
      join(proj, ".flow", "skills", "a", "SKILL.md"),
      "---\nname: a\ndescription: proj A\n---\nbody\n",
    );

    const skills = discoverSkills(data, proj);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("proj A");
    expect(loadSkillBody(data, proj, "a")).toContain("body");
    expect(loadSkillBody(data, proj, "missing")).toBeUndefined();
  });

  it("discovers subagents and custom commands", () => {
    mkdirSync(join(proj, ".flow", "agents"), { recursive: true });
    writeFileSync(
      join(proj, ".flow", "agents", "rev.md"),
      "---\nname: rev\ndescription: R\n---\nBe strict.\n",
    );
    mkdirSync(join(proj, ".flow", "commands"), { recursive: true });
    writeFileSync(join(proj, ".flow", "commands", "fix.md"), "Fix $ARGUMENTS now.\n");

    expect(discoverSubagents(data, proj).map((d) => d.name)).toEqual(["rev"]);
    const commands = discoverCommands(data, proj);
    expect(commands.map((c) => c.name)).toEqual(["fix"]);
    expect(commands[0]?.template).toContain("$ARGUMENTS");
  });

  it("loads memory files and finds legacy imports", () => {
    const path = writeProjectMemory(proj, "hello memory");
    const files = loadMemoryFiles(join(dir, "home"), proj);

    expect(path).toContain("FLOW.md");
    expect(files[1]?.content).toBe("hello memory");
    expect(files[0]?.content).toBe("");

    writeFileSync(join(proj, "CLAUDE.md"), "legacy notes");
    expect(findLegacyImport(proj)?.path).toContain("CLAUDE.md");
  });
});
