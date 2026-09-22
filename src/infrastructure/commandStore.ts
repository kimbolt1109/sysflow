import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomCommand } from "@/domain/commands.js";
import { parseFrontmatter } from "@/domain/frontmatter.js";

function discoverDir(dir: string): CustomCommand[] {
  if (!existsSync(dir)) return [];
  const found: CustomCommand[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      const text = readFileSync(join(dir, entry.name), "utf8");
      found.push({
        name: entry.name.slice(0, -".md".length),
        template: parseFrontmatter(text).body,
        source: `${dir}/${entry.name}`,
      });
    } catch {
      // one bad file must never break command discovery
    }
  }
  return found;
}

export function discoverCommands(dataDir: string, projectDir: string): CustomCommand[] {
  const user = discoverDir(join(dataDir, "commands"));
  const project = discoverDir(join(projectDir, ".flow", "commands"));
  const names = new Set(project.map((c) => c.name));
  return [...project, ...user.filter((c) => !names.has(c.name))];
}
