import { exec, type ExecException } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { ToolResult } from "@/domain/toolDefs";

const MAX_READ_BYTES = 256 * 1024;
const MAX_GREP_HITS = 100;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

function segmentMatches(segment: string, value: string): boolean {
  let rx = "^";
  for (const ch of segment) {
    if (ch === "*") rx += ".*";
    else if (ch === "?") rx += ".";
    else if ("\\^$+?.()|{}[]".includes(ch)) rx += `\\${ch}`;
    else rx += ch;
  }
  rx += "$";
  return new RegExp(rx).test(value);
}

export function matchGlobParts(pattern: string, path: string): boolean {
  const parts = pattern.split("/").filter((p) => p !== "");
  const segs = path.split("/").filter((s) => s !== "");
  const walk = (pi: number, si: number): boolean => {
    if (pi === parts.length) return si === segs.length;
    if (parts[pi] === "**") {
      for (let k = si; k <= segs.length; k += 1) {
        if (walk(pi + 1, k)) return true;
      }
      return false;
    }
    if (si >= segs.length) return false;
    if (!segmentMatches(parts[pi] ?? "", segs[si] ?? "")) return false;
    return walk(pi + 1, si + 1);
  };
  return walk(0, 0);
}

export class LocalTools {
  constructor(readonly rootDir: string) {}

  resolveInRoot(target: string): string {
    const resolved = resolve(this.rootDir, target);
    const root = resolve(this.rootDir);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new Error(`path escapes workspace: ${target}`);
    }
    return resolved;
  }

  async read(path: string): Promise<ToolResult> {
    try {
      const full = this.resolveInRoot(path);
      const info = await stat(full);
      if (info.size > MAX_READ_BYTES) {
        const text = await readFile(full, "utf8");
        return {
          ok: true,
          output: `${text.slice(0, MAX_READ_BYTES)}\n…[truncated ${info.size} bytes]`,
        };
      }
      return { ok: true, output: await readFile(full, "utf8") };
    } catch (err) {
      return fail(`read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async write(path: string, content: string): Promise<ToolResult> {
    try {
      const full = this.resolveInRoot(path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content, "utf8");
      return { ok: true, output: `wrote ${path} (${content.length} chars)` };
    } catch (err) {
      return fail(`write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<ToolResult> {
    try {
      const full = this.resolveInRoot(path);
      const text = await readFile(full, "utf8");
      const count = text.split(oldString).length - 1;
      if (count === 0) return fail("oldString not found in content");
      if (count > 1 && !replaceAll) {
        return fail("found multiple matches for oldString (use replaceAll)");
      }
      const next = replaceAll
        ? text.split(oldString).join(newString)
        : text.replace(oldString, newString);
      await writeFile(full, next, "utf8");
      return { ok: true, output: `edited ${path} (${count} match${count === 1 ? "" : "es"})` };
    } catch (err) {
      return fail(`edit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  bash(command: string, timeoutMs = 30000): Promise<ToolResult> {
    return new Promise((resolvePromise) => {
      exec(
        command,
        { cwd: this.rootDir, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
        (error: ExecException | null, stdout: string, stderr: string) => {
          const output = `${stdout}${stderr}`;
          if (error !== null) {
            resolvePromise({
              ok: false,
              output: `exit ${error.code ?? "?"}: ${output}`.slice(0, 8000),
            });
          } else {
            resolvePromise({ ok: true, output: output.slice(0, 8000) });
          }
        },
      );
    });
  }

  async glob(pattern: string): Promise<ToolResult> {
    try {
      const hits: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") && entry.name !== ".env.example") {
            if (entry.isDirectory() && (entry.name === ".git" || entry.name === ".flow")) continue;
          }
          const full = join(dir, entry.name);
          const rel = relative(this.rootDir, full).split(sep).join("/");
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            await walk(full);
          } else if (matchGlobParts(pattern, rel)) {
            hits.push(rel);
            if (hits.length >= 500) return;
          }
        }
      };
      await walk(this.rootDir);
      return { ok: true, output: hits.sort().join("\n") };
    } catch (err) {
      return fail(`glob failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async grep(pattern: string, include = "**/*"): Promise<ToolResult> {
    let rx: RegExp;
    try {
      rx = new RegExp(pattern);
    } catch {
      return fail(`invalid regex "${pattern}"`);
    }
    const hits: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (hits.length >= MAX_GREP_HITS) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        const rel = relative(this.rootDir, full).split(sep).join("/");
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name === ".git" || entry.name === ".flow")
            continue;
          await walk(full);
          if (hits.length >= MAX_GREP_HITS) return;
        } else {
          if (!matchGlobParts(include, rel)) continue;
          let text: string;
          try {
            const info = await stat(full);
            if (info.size > MAX_READ_BYTES) continue;
            text = await readFile(full, "utf8");
          } catch {
            continue;
          }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i] ?? "";
            if (rx.test(line)) {
              hits.push(`${rel}:${i + 1}: ${line.slice(0, 500)}`);
              if (hits.length >= MAX_GREP_HITS) return;
            }
          }
        }
      }
    };
    try {
      await walk(this.rootDir);
      return { ok: true, output: hits.join("\n") };
    } catch (err) {
      return fail(`grep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
