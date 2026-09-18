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
