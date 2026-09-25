import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ShimTarget {
  file: string;
  /** argv placed before the caller's args (the script path for node targets) */
  prefix: string[];
}

/** Reads the real target out of an npm cmd-shim. Both shapes npm writes:
 *   "%dp0%\node_modules\pkg\bin\tool.exe"   %*
 *   ... & "%_prog%"  "%dp0%\node_modules\pkg\cli.js" %*
 * Node targets run under `nodePath` (the shim would pick node from PATH). */
export function parseCmdShim(
  content: string,
  shimDir: string,
  nodePath: string = process.execPath,
): ShimTarget | undefined {
  const lines = content.split(/\r?\n/);
  let launch: string | undefined;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.includes("%*") === true) {
      launch = lines[i];
      break;
    }
  }
  if (launch === undefined) return undefined;
  const targets = [...launch.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => m[1] ?? "");
  const target = targets[targets.length - 1];
  if (target === undefined || target === "") return undefined;
  const full = join(shimDir, ...target.split("\\"));
  if (/\.exe$/i.test(target)) return { file: full, prefix: [] };
  if (launch.includes("%_prog%")) return { file: nodePath, prefix: [full] };
  return undefined;
}

/** For a resolved `.cmd`/`.ps1` npm shim, the binary it wraps, when it can be launched
 * directly. Going through PowerShell or cmd.exe re-parses argv and strips quotes and
 * newlines out of prompts; a direct launch passes them intact. */
export function npmShimTarget(shimPath: string): ShimTarget | undefined {
  if (!/\.(cmd|ps1)$/i.test(shimPath)) return undefined;
  const cmd = shimPath.replace(/\.(cmd|ps1)$/i, ".cmd");
  try {
    if (!existsSync(cmd)) return undefined;
    const target = parseCmdShim(readFileSync(cmd, "utf8"), dirname(cmd));
    if (target === undefined) return undefined;
    const entry = target.prefix[0] ?? target.file;
    return existsSync(entry) ? target : undefined;
  } catch {
    return undefined;
  }
}
