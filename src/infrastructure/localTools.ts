import { exec, execFile, type ExecException, type ExecFileException } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ToolResult, ToolsPort } from "@/domain/toolDefs.js";

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

export class LocalTools implements ToolsPort {
  rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  chdir(path: string): void {
    const resolved = resolve(this.rootDir, path);
    let info;
    try {
      info = statSync(resolved);
    } catch {
      throw new Error(`no such directory: ${path}`);
    }
    if (!info.isDirectory()) throw new Error(`not a directory: ${path}`);
    this.rootDir = resolved;
  }

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

  async remove(path: string): Promise<ToolResult> {
    try {
      const full = this.resolveInRoot(path);
      await rm(full, { force: true, recursive: true });
      return { ok: true, output: `removed ${path}` };
    } catch (err) {
      return fail(`remove failed: ${err instanceof Error ? err.message : String(err)}`);
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
            if (error.killed === true) {
              resolvePromise({
                ok: false,
                output: `bash timed out after ${(timeoutMs / 1000).toFixed(0)}s: ${output}`.slice(
                  0,
                  8000,
                ),
              });
            } else {
              resolvePromise({
                ok: false,
                output: `exit ${error.code ?? "?"}: ${output}`.slice(0, 8000),
              });
            }
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

  async screenshot(): Promise<ToolResult> {
    if (process.platform !== "win32") return fail("computer tools need Windows");
    try {
      const dir = this.resolveInRoot(join(".flow", "screenshots"));
      await mkdir(dir, { recursive: true });
      const name = `shot-${Date.now()}.png`;
      const full = join(dir, name);
      const rel = relative(this.rootDir, full).split(sep).join("/");
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
        "$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)",
        "$g = [System.Drawing.Graphics]::FromImage($bmp)",
        "$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
        `$bmp.Save('${full.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        "$g.Dispose(); $bmp.Dispose()",
        '"captured {0}x{1}" -f $bounds.Width, $bounds.Height',
      ].join("; ");
      const run = await runPs(script);
      if (!run.ok) return fail(`screenshot failed: ${run.output}`);
      const size = run.output.trim().split("\n").pop() ?? "";
      return {
        ok: true,
        output: `screenshot saved to ${rel} (${size})`,
        images: [full],
      };
    } catch (err) {
      return fail(`screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async click(x: number, y: number, button = "left"): Promise<ToolResult> {
    const at = parseClick(x, y, button);
    if (typeof at === "string") return fail(at);
    if (process.platform !== "win32") return fail("computer tools need Windows");
    const flags: Record<string, [number, number]> = {
      left: [0x02, 0x04],
      right: [0x08, 0x10],
      middle: [0x20, 0x40],
    };
    const [down, up] = flags[at.button] as [number, number];
    const script = [
      'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);\' -Name Win32Mouse -Namespace Win32Flow',
      `[Win32Flow.Win32Mouse]::SetCursorPos(${at.x}, ${at.y})`,
      `[Win32Flow.Win32Mouse]::mouse_event(${down}, 0, 0, 0, 0)`,
      `[Win32Flow.Win32Mouse]::mouse_event(${up}, 0, 0, 0, 0)`,
      `"clicked ${at.x},${at.y} ${at.button}"`,
    ].join("; ");
    const run = await runPs(script);
    if (!run.ok) return fail(`click failed: ${run.output}`);
    return {
      ok: true,
      output: run.output.trim() === "" ? `clicked ${at.x},${at.y}` : run.output.trim(),
    };
  }

  async type(text: string): Promise<ToolResult> {
    if (process.platform !== "win32") return fail("computer tools need Windows");
    if (text === "" || text.length > 4000) return fail("type needs 1–4000 chars of text");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      `[System.Windows.Forms.SendKeys]::SendWait('${escapeSendKeys(text)}')`,
      `"typed ${text.length} chars"`,
    ].join("; ");
    const run = await runPs(script);
    if (!run.ok) return fail(`type failed: ${run.output}`);
    return {
      ok: true,
      output: run.output.trim() === "" ? `typed ${text.length} chars` : run.output.trim(),
    };
  }

  async key(name: string): Promise<ToolResult> {
    const code = keyCode(name);
    if (code === undefined) {
      return fail(`unknown key "${name}" (Enter, Tab, Esc, Space, arrows, F1–F12, …)`);
    }
    if (process.platform !== "win32") return fail("computer tools need Windows");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      `[System.Windows.Forms.SendKeys]::SendWait('${code}')`,
      `"pressed ${name}"`,
    ].join("; ");
    const run = await runPs(script);
    if (!run.ok) return fail(`key failed: ${run.output}`);
    return { ok: true, output: run.output.trim() === "" ? `pressed ${name}` : run.output.trim() };
  }
}

export function parseClick(
  x: number,
  y: number,
  button: string,
): { x: number; y: number; button: string } | string {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 100000 || y > 100000) {
    return "click needs integer {x, y} pixels >= 0";
  }
  const normalized = button.toLowerCase();
  if (normalized !== "left" && normalized !== "right" && normalized !== "middle") {
    return "click button must be left|right|middle";
  }
  return { x, y, button: normalized };
}

const KEY_CODES: Record<string, string> = {
  enter: "{ENTER}",
  tab: "{TAB}",
  esc: "{ESC}",
  escape: "{ESC}",
  space: " ",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  f1: "{F1}",
  f2: "{F2}",
  f3: "{F3}",
  f4: "{F4}",
  f5: "{F5}",
  f6: "{F6}",
  f7: "{F7}",
  f8: "{F8}",
  f9: "{F9}",
  f10: "{F10}",
  f11: "{F11}",
  f12: "{F12}",
};

export function keyCode(name: string): string | undefined {
  return KEY_CODES[name.toLowerCase()];
}

function escapeSendKeys(text: string): string {
  return text.replace(/'/g, "''").replace(/([+^%~(){}[\]])/g, "{$1}");
}

function runPs(script: string, timeoutMs = 30000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        const output = `${stdout}${stderr}`;
        if (error !== null) {
          if (error.killed === true) {
            resolvePromise({
              ok: false,
              output: `command timed out after ${(timeoutMs / 1000).toFixed(0)}s: ${output}`.slice(
                0,
                8000,
              ),
            });
          } else {
            resolvePromise({
              ok: false,
              output: `exit ${error.code ?? "?"}: ${output}`.slice(0, 8000),
            });
          }
        } else {
          resolvePromise({ ok: true, output: output.slice(0, 8000) });
        }
      },
    );
  });
}
