import { spawnSync } from "node:child_process";

export interface NotifyOptions {
  sound?: boolean;
  run?: (file: string, argv: string[]) => { ok: boolean };
}

function defaultRun(file: string, argv: string[]): { ok: boolean } {
  try {
    const result = spawnSync(file, argv, { stdio: "ignore", timeout: 5000 });
    return { ok: result.status === 0 };
  } catch {
    return { ok: false };
  }
}

export function notify(title: string, body: string, opts: NotifyOptions = {}): void {
  process.stderr.write(`\x07[notify] ${title}: ${body}\n`);
  const run = opts.run ?? defaultRun;
  try {
    if (process.platform === "win32") {
      const available = run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Module -ListAvailable BurntToast | Select-Object -First 1",
      ]);
      if (available.ok) {
        run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `New-BurntToastNotification -Text '${title.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}'`,
        ]);
      }
    } else if (process.platform === "darwin") {
      run("osascript", ["-e", `display notification "${body}" with title "${title}"`]);
    } else {
      run("notify-send", [title, body]);
    }
  } catch {
    // notifications are best-effort and never fail the session
  }
}
