import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { legacyMemoryCandidates, memoryPaths } from "@/domain/memory";

export function readTextFile(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function loadMemoryFiles(
  home: string,
  projectDir: string,
): Array<{ path: string; content: string }> {
  const paths = memoryPaths(home, projectDir);
  return [paths.user, paths.project, paths.local].map((path) => ({
    path,
    content: readTextFile(path),
  }));
}

export function findLegacyImport(
  projectDir: string,
): { path: string; content: string } | undefined {
  for (const path of legacyMemoryCandidates(projectDir)) {
    const content = readTextFile(path);
    if (content.trim() !== "") return { path, content };
  }
  return undefined;
}

export function importOfferedMarker(projectDir: string): string {
  const sep = projectDir.includes("\\") ? "\\" : "/";
  return `${projectDir}${sep}.flow${sep}.import-offered`;
}

export function writeProjectMemory(projectDir: string, content: string): string {
  const sep = projectDir.includes("\\") ? "\\" : "/";
  const dir = `${projectDir}${sep}.flow`;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}${sep}FLOW.md`;
  writeFileSync(path, content, "utf8");
  return path;
}

export function resolveEditor(env: NodeJS.ProcessEnv): string {
  return env.EDITOR ?? env.VISUAL ?? (process.platform === "win32" ? "notepad" : "vi");
}

export function openInEditor(path: string, editor: string): void {
  spawnSync(editor, [path], { stdio: "inherit" });
}
