import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function userSettingsPath(dataDir: string): string {
  return join(dataDir, "settings.json");
}

export function writeUserDefaultModel(dataDir: string, model: string): void {
  const path = userSettingsPath(dataDir);
  let parsed: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`invalid JSON in ${path}`);
    }
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...parsed, defaultModel: model }, null, 2)}\n`, "utf8");
}

function readSettingsRecord(dataDir: string): Record<string, unknown> {
  const path = userSettingsPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Projects whose hooks and MCP servers run without asking. */
export function readTrustedProjects(dataDir: string): string[] {
  const raw = readSettingsRecord(dataDir).trustedProjects;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string");
}

export function trustProject(dataDir: string, projectDir: string): void {
  const trusted = readTrustedProjects(dataDir);
  if (trusted.includes(projectDir)) return;
  mkdirSync(dataDir, { recursive: true });
  const path = userSettingsPath(dataDir);
  const parsed = readSettingsRecord(dataDir);
  writeFileSync(
    path,
    `${JSON.stringify({ ...parsed, trustedProjects: [...trusted, projectDir] }, null, 2)}\n`,
    "utf8",
  );
}
