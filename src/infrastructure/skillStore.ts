import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSkillMd, type SkillDef } from "@/domain/skills.js";

export function skillDirs(
  dataDir: string,
  projectDir: string,
  homeDir: string = homedir(),
): string[] {
  return [
    join(projectDir, ".flow", "skills"),
    join(projectDir, ".claude", "skills"),
    join(projectDir, ".gemini", "skills"),
    join(projectDir, ".grok", "skills"),
    join(dataDir, "skills"),
    join(homeDir, ".claude", "skills"),
    join(homeDir, ".gemini", "skills"),
    join(homeDir, ".grok", "skills"),
  ];
}

function discoverDir(dir: string, seen: Set<string>): SkillDef[] {
  if (!existsSync(dir)) return [];
  const found: SkillDef[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue;
    const file = join(dir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      found.push(parseSkillMd(readFileSync(file, "utf8"), `${dir}/${entry.name}`));
      seen.add(entry.name);
    } catch {
      continue;
    }
  }
  return found;
}

export function discoverSkills(
  dataDir: string,
  projectDir: string,
  homeDir: string = homedir(),
): SkillDef[] {
  const seen = new Set<string>();
  return skillDirs(dataDir, projectDir, homeDir).flatMap((dir) => discoverDir(dir, seen));
}

export function loadSkillBody(
  dataDir: string,
  projectDir: string,
  name: string,
  homeDir: string = homedir(),
): string | undefined {
  for (const dir of skillDirs(dataDir, projectDir, homeDir)) {
    const file = join(dir, name, "SKILL.md");
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return undefined;
}
