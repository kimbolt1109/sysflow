export interface MemoryLayers {
  user: string;
  project: string;
  local: string;
}

export function memoryPaths(home: string, projectDir: string): MemoryLayers {
  const sep = projectDir.includes("\\") ? "\\" : "/";
  return {
    user: `${home}${sep}.flow${sep}FLOW.md`,
    project: `${projectDir}${sep}.flow${sep}FLOW.md`,
    local: `${projectDir}${sep}.flow${sep}FLOW.local.md`,
  };
}

export function legacyMemoryCandidates(projectDir: string): string[] {
  const sep = projectDir.includes("\\") ? "\\" : "/";
  return ["CLAUDE.md", "AGENTS.md", "GEMINI.md"].map((name) => `${projectDir}${sep}${name}`);
}

const AT_FILE = /(^|\s)@([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)/g;

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
