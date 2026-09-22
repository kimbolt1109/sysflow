import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isHookEvent,
  parseHookDecision,
  type HookDecision,
  type HookDef,
  type HookEvent,
  type HooksPort,
} from "@/domain/hooks.js";

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function loadFile(path: string): HookDef[] {
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`invalid JSON in ${path}`);
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const hooks = (parsed as Record<string, unknown>).hooks;
  if (typeof hooks !== "object" || hooks === null) return [];
  const defs: HookDef[] = [];
  for (const [event, raw] of Object.entries(hooks as Record<string, unknown>)) {
    if (!isHookEvent(event)) continue;
    for (const text of stringList(raw)) {
      defs.push({ event, command: text, timeoutMs: 10000 });
    }
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const r = raw as Record<string, unknown>;
      if (typeof r.command === "string") {
        defs.push({
          event,
          command: r.command,
          timeoutMs: typeof r.timeout === "number" ? r.timeout : 10000,
        });
      }
    }
  }
  return defs;
}

export function loadHooks(dataDir: string, projectDir: string): HookDef[] {
  return [
    ...loadFile(join(dataDir, "settings.json")),
    ...loadFile(join(projectDir, ".flow", "settings.json")),
  ];
}

function runCommand(
  command: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise) => {
    const child = exec(
      command,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (
          error !== null &&
          "killed" in error &&
          (error as { killed?: boolean }).killed === true
        ) {
          resolvePromise({ stdout, stderr: `${stderr}\nhook timed out`, code: 2 });
          return;
        }
        const code =
          error !== null && "code" in error ? Number((error as { code?: unknown }).code ?? 1) : 0;
        resolvePromise({ stdout, stderr, code: Number.isInteger(code) ? code : 1 });
      },
    );
    if (child.stdin !== null) {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      child.stdin.end();
    }
  });
}

export class HookRunner implements HooksPort {
  constructor(private readonly hooks: HookDef[] = []) {}

  get size(): number {
    return this.hooks.length;
  }

  async fire(event: HookEvent, payload: Record<string, unknown>): Promise<HookDecision> {
    for (const hook of this.hooks.filter((h) => h.event === event)) {
      const result = await runCommand(
        hook.command,
        { hook_event_name: event, ...payload },
        hook.timeoutMs,
      );
      const decision = parseHookDecision(result.stdout, result.code, result.stderr);
      if (decision.decision === "block") return decision;
    }
    return { decision: "proceed" };
  }
}
