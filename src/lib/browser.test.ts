import { describe, expect, it } from "vitest";
import { openBrowser, openCommandFor } from "@/lib/browser.js";

describe("lib browser", () => {
  it("maps platforms to open commands", () => {
    expect(openCommandFor("win32")?.command).toBe("cmd");
    expect(openCommandFor("darwin")?.command).toBe("open");
    expect(openCommandFor("linux")?.command).toBe("xdg-open");
    expect(openCommandFor("sunos")).toBeUndefined();
  });

  it("opens http urls through the runner", async () => {
    const seen: string[] = [];
    const out = await openBrowser(
      "http://localhost:3000/app",
      async (command, args) => {
        seen.push(`${command} ${args.join(" ")}`);
        return { ok: true, output: "" };
      },
      "linux",
    );

    expect(out).toContain("opened http://localhost:3000/app");
    expect(out).toContain("screenshot");
    expect(seen).toEqual(["xdg-open http://localhost:3000/app"]);
  });

  it("rejects bad urls, platforms, and runner failures", async () => {
    expect(await openBrowser("not a url")).toContain("http(s) URL");
    expect(await openBrowser("ftp://x/y")).toContain("http(s) only");
    expect(
      await openBrowser("https://example.com", async () => ({ ok: true, output: "" }), "sunos"),
    ).toContain("unsupported");
    expect(
      await openBrowser(
        "https://example.com",
        async () => ({ ok: false, output: "nope" }),
        "darwin",
      ),
    ).toContain("browse failed");
  });
});
