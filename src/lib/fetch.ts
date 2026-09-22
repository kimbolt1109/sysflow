/** fetch with an overall timeout. Aborts (never hangs) — callers map the
 * AbortError into their own retryable network errors. */

export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const CHAT_SEND_TIMEOUT_MS = 120000;
export const CHAT_STREAM_TIMEOUT_MS = 600000;
export const MCP_HTTP_TIMEOUT_MS = 30000;
