import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { npmShimTarget } from "@/infrastructure/npmShim.js";
import { DriverError } from "@/lib/errors.js";

/* Finding and launching CLI binaries: PATH lookup, npm shims, versions, process trees. */
export function isDirectPath(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

const pathCache = new Map<string, string | undefined>();

export function findOnPath(command: string): string | undefined {
  if (pathCache.has(command)) return pathCache.get(command);
  const found = findOnPathUncached(command);
  pathCache.set(command, found);
  return found;
}

function findOnPathUncached(command: string): string | undefined {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const found = spawnSync(probe, [command], { encoding: "utf8", timeout: 5000 });
    if (found.status !== 0) return undefined;
    const lines = found.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (process.platform === "win32") {
      const exe = lines.find((l) => /\.exe$/i.test(l));
      if (exe !== undefined) return exe;
      for (const line of lines) {
        const ps1 = siblingPs1(line);
        if (ps1 !== undefined) return ps1;
      }
      return (
        lines.find((l) => /\.ps1$/i.test(l)) ??
        lines.find((l) => /\.(cmd|bat|com)$/i.test(l)) ??
        lines[0]
      );
    }
    return lines[0];
  } catch {
    return undefined;
  }
}

export function passthrough(command: string, args: string[] = []): number {
  const launch = resolveLaunch(command, args);
  const result = spawnSync(launch.file, launch.argv, { stdio: "inherit", shell: false });
  if (result.error !== undefined) {
    throw new DriverError(`${command} failed to start: ${result.error.message}`);
  }
  return result.status ?? 1;
}

export function cliVersion(command: string, timeoutMs = 10000): string | undefined {
  try {
    const launch = resolveLaunch(command, ["--version"]);
    const found = spawnSync(launch.file, launch.argv, { encoding: "utf8", timeout: timeoutMs });
    if (found.status !== 0) return undefined;
    const line = `${found.stdout}${found.stderr}`.split(/\r?\n/).find((l) => l.trim() !== "");
    return line?.trim();
  } catch {
    return undefined;
  }
}

export function quoteCmdArg(arg: string): string {
  return `'${arg.replace(/'/g, "''")}'`;
}

export function resolveLaunch(command: string, args: string[]): { file: string; argv: string[] } {
  const resolved = isDirectPath(command) ? command : (findOnPath(command) ?? command);
  const lower = resolved.toLowerCase();
  if (lower.endsWith(".ps1") || lower.endsWith(".cmd")) {
    // PowerShell and cmd.exe re-parse argv and strip quotes/newlines from prompts.
    const target = npmShimTarget(resolved);
    if (target !== undefined) return { file: target.file, argv: [...target.prefix, ...args] };
  }
  if (lower.endsWith(".ps1")) {
    return {
      file: "powershell.exe",
      argv: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolved,
        ...args,
      ],
    };
  }
  if (lower.endsWith(".cmd") || lower.endsWith(".bat") || lower.endsWith(".com")) {
    const script = `& ${quoteCmdArg(resolved)}${args.length > 0 ? ` ${args.map(quoteCmdArg).join(" ")}` : ""}`;
    return {
      file: "powershell.exe",
      argv: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    };
  }
  return { file: resolved, argv: args };
}

function siblingPs1(path: string): string | undefined {
  const base = path.replace(/\.[^\\/]*$/, "");
  const candidate = `${base}.ps1`;
  if (base !== path && existsSync(candidate)) return candidate;
  return undefined;
}

/** Kills the CLI and everything it spawned: agents start their own shells and servers,
 * and on Windows killing only the parent leaves those running. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => child.kill());
    return;
  }
  child.kill("SIGTERM");
}
