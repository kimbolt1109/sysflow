import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills, loadSkillBody, skillDirs } from "@/infrastructure/skillStore.js";

function writeSkill(root: string, dir: string, name: string, body = "body"): void {
  const skillDir = join(root, dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`,
  );
}

describe("skillStore", () => {
  let home = "";
  let data = "";
  let project = "";
  let dirs: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "flow-skill-home-"));
    data = mkdtempSync(join(tmpdir(), "flow-skill-data-"));
    project = mkdtempSync(join(tmpdir(), "flow-skill-proj-"));
    dirs = [home, data, project];
  });

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("lists flow dirs before foreign claude/gemini/grok dirs", () => {
    const ordered = skillDirs(data, project, home);

    expect(ordered[0]).toContain(".flow");
    expect(ordered.join("\n")).toContain(".claude");
    expect(ordered.join("\n")).toContain(".gemini");
    expect(ordered.join("\n")).toContain(".grok");
  });

  it("discovers flow, claude, gemini, and grok skills with first-name wins", () => {
    writeSkill(project, ".flow/skills", "mine");
    writeSkill(home, ".claude/skills", "claude-one");
    writeSkill(project, ".gemini/skills", "gemini-one");
    writeSkill(home, ".grok/skills", "grokked");
    writeSkill(home, ".claude/skills", "mine");

    const names = discoverSkills(data, project, home).map((s) => s.name);

    expect(names).toContain("mine");
    expect(names).toContain("claude-one");
    expect(names).toContain("gemini-one");
    expect(names).toContain("grokked");
    expect(names.filter((n) => n === "mine")).toHaveLength(1);
  });

  it("loads bodies from foreign dirs in tier order", () => {
    writeSkill(home, ".gemini/skills", "shared", "gemini body");
    writeSkill(home, ".claude/skills", "shared", "claude body");

    expect(loadSkillBody(data, project, "shared", home)).toContain("claude body");
    expect(loadSkillBody(data, project, "missing", home)).toBeUndefined();
  });
});
