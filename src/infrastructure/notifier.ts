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
        return;
      }
      run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$mgr = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]; $docType = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]; $xml = $docType::new(); $xml.LoadXml('<toast><visual><binding template=''ToastText02''><text id=''1''>${escapeXml(title)}</text><text id=''2''>${escapeXml(body)}</text></binding></visual></toast>'); $mgr::CreateToastNotifier('Flow').Show($xml)`,
      ]);
    } else if (process.platform === "darwin") {
      run("osascript", ["-e", `display notification "${body}" with title "${title}"`]);
    } else {
      run("notify-send", [title, body]);
    }
  } catch {
    // notifications are best-effort and never fail the session
  }
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
