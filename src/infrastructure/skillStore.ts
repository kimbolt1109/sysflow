import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillMd, type SkillDef } from "@/domain/skills";

function discoverDir(dir: string): SkillDef[] {
  if (!existsSync(dir)) return [];
  const found: SkillDef[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(dir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      found.push(parseSkillMd(readFileSync(file, "utf8"), `${dir}/${entry.name}`));
    } catch {
      continue;
    }
  }
  return found;
}

export function discoverSkills(dataDir: string, projectDir: string): SkillDef[] {
  const user = discoverDir(join(dataDir, "skills"));
  const project = discoverDir(join(projectDir, ".flow", "skills"));
  const names = new Set(project.map((s) => s.name));
  return [...project, ...user.filter((s) => !names.has(s.name))];
}

export function loadSkillBody(
  dataDir: string,
  projectDir: string,
  name: string,
): string | undefined {
  for (const dir of [join(projectDir, ".flow", "skills"), join(dataDir, "skills")]) {
    const file = join(dir, name, "SKILL.md");
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return undefined;
}
