import { describe, expect, it, vi } from "vitest";
import { escapeXml, notify } from "@/infrastructure/notifier.js";

describe("notifier", () => {
  it("never throws and shells out best-effort", () => {
    const run = vi.fn(() => ({ ok: false }));

    expect(() => notify("title", "body", { run })).not.toThrow();
    expect(run).toHaveBeenCalled();
  });

  it("falls back to a WinRT toast when BurntToast is missing", () => {
    const run = vi.fn((_file: string, _argv: string[]): { ok: boolean } => ({ ok: false }));

    notify("title", "body", { run });

    const commands = run.mock.calls.map((c) => String(c[1]));
    expect(commands.some((c) => c.includes("ToastNotificationManager"))).toBe(true);
  });

  it("escapes xml in toast bodies", () => {
    expect(escapeXml(`a<b>&"'c`)).toBe("a&lt;b&gt;&amp;&quot;&apos;c");
  });
});
