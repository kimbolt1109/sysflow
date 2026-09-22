/** Open URLs in the real system browser for flow-testing apps and sites.
 * Never throws — failures become messages. Runner is injectable for tests.
 */

export interface OpenResult {
  ok: boolean;
  output: string;
}

export type OpenRunner = (command: string, args: string[]) => Promise<OpenResult>;

export function openCommandFor(
  platform: string,
): { command: string; args: (url: string) => string[] } | undefined {
  if (platform === "win32") {
    return { command: "cmd", args: (url) => ["/c", "start", "", url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: (url) => [url] };
  }
  if (platform === "linux") {
    return { command: "xdg-open", args: (url) => [url] };
  }
  return undefined;
}

/** Open a URL in the system browser so agents can test the real flow. */
export async function openBrowser(
  url: string,
  runner?: OpenRunner,
  platform: string = process.platform,
): Promise<string> {
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    return `browse needs an http(s) URL, got "${url.slice(0, 120)}"`;
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return `browse supports http(s) only, got "${protocol}"`;
  }
  const opener = openCommandFor(platform);
  if (opener === undefined) {
    return `browse unsupported on ${platform} (Windows, macOS, and Linux only)`;
  }
  const run: OpenRunner =
    runner ??
    (async (command, args) => {
      const { execFile } = await import("node:child_process");
      return new Promise<OpenResult>((resolvePromise) => {
        execFile(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
          const output = `${stdout}${stderr}`.trim();
          if (error !== null) {
            resolvePromise({ ok: false, output: output === "" ? String(error) : output });
          } else {
            resolvePromise({ ok: true, output });
          }
        });
      });
    });
  try {
    const result = await run(opener.command, opener.args(url));
    if (!result.ok) return `browse failed for ${url}: ${result.output.slice(0, 500)}`;
    return `opened ${url} — screenshot to see it, then click/type to walk the flow`;
  } catch (err) {
    return `browse failed for ${url}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
