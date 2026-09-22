import { posix, win32 } from "node:path";

export interface MemoryLayers {
  user: string;
  project: string;
  local: string;
}

function pathFor(home: string, projectDir: string): typeof posix {
  return projectDir.includes("\\") || home.includes("\\") ? win32 : posix;
}

export function memoryPaths(home: string, projectDir: string): MemoryLayers {
  const path = pathFor(home, projectDir);
  return {
    user: path.join(home, ".flow", "FLOW.md"),
    project: path.join(projectDir, ".flow", "FLOW.md"),
    local: path.join(projectDir, ".flow", "FLOW.local.md"),
  };
}

export function legacyMemoryCandidates(projectDir: string): string[] {
  const path = pathFor(projectDir, projectDir);
  return ["CLAUDE.md", "AGENTS.md", "GEMINI.md"].map((name) => path.join(projectDir, name));
}

const AT_FILE = /(^|\s)@([A-Za-z0-9_./\\: -]+\.[A-Za-z0-9]+)/g;

export function expandAtFiles(
  text: string,
  readFile: (path: string) => string | undefined,
): string {
  return text.replace(AT_FILE, (whole, prefix: string, path: string) => {
    const content = readFile(path);
    if (content === undefined) return whole;
    return `${prefix}[@${path}]\n${content.slice(0, 8000)}`;
  });
}

export function buildMemoryBlock(files: Array<{ path: string; content: string }>): string {
  const present = files.filter((f) => f.content.trim() !== "");
  if (present.length === 0) return "";
  return present.map((f) => `# Memory: ${f.path}\n${f.content.slice(0, 8000)}`).join("\n\n");
}
