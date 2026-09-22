import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRestore, takeCheckpoint, type Checkpoint } from "@/domain/checkpoints.js";
import { projectHash } from "@/domain/sessions.js";
import type { ToolsPort } from "@/domain/toolDefs.js";

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".flow", "research"]);

export function checkpointDir(dataDir: string, projectDir: string, sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sessionId)) {
    throw new Error(`invalid session id "${sessionId}" (letters, digits, -, _)`);
  }
  return join(dataDir, "checkpoints", projectHash(projectDir), sessionId);
}

export async function snapshotWorkspace(
  tools: ToolsPort,
  label: string,
): Promise<{ label: string; files: Record<string, string | null>; truncated: boolean }> {
  const listed = await tools.glob("**/*");
  const files: Record<string, string | null> = {};
  let bytes = 0;
  let truncated = !listed.ok;
  if (listed.ok) {
    const paths = listed.output.split("\n").filter((p) => p !== "");
    truncated = paths.length > MAX_FILES;
    for (const path of paths.slice(0, MAX_FILES)) {
      const top = path.split("/")[0] ?? "";
      if (SKIP.has(top) || SKIP.has(path.split("/").pop() ?? "")) continue;
      const read = await tools.read(path);
      if (!read.ok) continue;
      bytes += read.output.length;
      if (bytes > MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      files[path] = read.output;
    }
  }
  return { label, files, truncated };
}

export async function snapshotCheckpoint(
  id: string,
  tools: ToolsPort,
  label: string,
): Promise<Checkpoint> {
  const snap = await snapshotWorkspace(tools, label);
  const entries = Object.entries(snap.files).map(([path, content]) => ({ path, content }));
  return takeCheckpoint(
    id,
    snap.truncated ? `${snap.label} (partial snapshot)` : snap.label,
    entries,
  );
}

export function saveCheckpoint(dir: string, checkpoint: Checkpoint): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${checkpoint.id}.json`), JSON.stringify(checkpoint), "utf8");
}

export function listCheckpoints(dir: string): Checkpoint[] {
  if (!existsSync(dir)) return [];
  const out: Checkpoint[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, entry), "utf8")) as Checkpoint);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

export interface RestoreOutcome {
  touched: string[];
  failed: string[];
}

export async function restoreCheckpoint(
  tools: ToolsPort,
  checkpoint: Checkpoint,
): Promise<RestoreOutcome> {
  const plan = planRestore(checkpoint);
  const touched: string[] = [];
  const failed: string[] = [];
  for (const item of plan.write) {
    const result = await tools.write(item.path, item.content);
    if (result.ok) touched.push(item.path);
    else failed.push(`${item.path} (${result.output.slice(0, 120)})`);
  }
  for (const path of plan.remove) {
    const result = await tools.remove(path);
    if (result.ok) touched.push(`${path} (removed)`);
    else failed.push(`${path} (remove: ${result.output.slice(0, 120)})`);
  }
  return { touched, failed };
}
