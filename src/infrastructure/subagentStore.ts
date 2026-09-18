import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSubagentMd, type SubagentDef } from "@/domain/subagents";

function discoverDir(dir: string): SubagentDef[] {
  if (!existsSync(dir)) return [];
  const found: SubagentDef[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      found.push(
        parseSubagentMd(readFileSync(join(dir, entry.name), "utf8"), `${dir}/${entry.name}`),
      );
    } catch {
      continue;
    }
  }
  return found;
}

export function discoverSubagents(dataDir: string, projectDir: string): SubagentDef[] {
  const user = discoverDir(join(dataDir, "agents"));
  const project = discoverDir(join(projectDir, ".flow", "agents"));
  const names = new Set(project.map((d) => d.name));
  return [...project, ...user.filter((d) => !names.has(d.name))];
}
