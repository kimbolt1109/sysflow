/** Best-effort URL-to-text fetching for agent web access. Never throws. */

export const FETCH_TIMEOUT_MS = 15000;
export const FETCH_MAX_CHARS = 12000;

/** Strip a page down to readable text. Best-effort, no dependencies. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|quot|amp|lt|gt|#39);/g, (_, entity: string) =>
      entity === "nbsp"
        ? " "
        : entity === "quot"
          ? '"'
          : entity === "amp"
            ? "&"
            : entity === "lt"
              ? "<"
              : entity === "gt"
                ? ">"
                : "'",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch a URL as capped plain text. Failures become messages, never throws. */
export async function fetchPageText(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    return `webfetch needs an http(s) URL, got "${url.slice(0, 120)}"`;
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return `webfetch supports http(s) only, got "${protocol}"`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) return `webfetch ${res.status} for ${url}`;
    const type = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = /html/i.test(type) || /^\s*</.test(raw) ? htmlToText(raw) : raw;
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean === "") return `webfetch returned no text for ${url}`;
    return clean.length > FETCH_MAX_CHARS
      ? `${clean.slice(0, FETCH_MAX_CHARS)}\n…[truncated]`
      : clean;
  } catch (err) {
    return `webfetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}
