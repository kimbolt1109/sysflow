/** Pure transcript helpers for the TUI scrollback viewport.
 * No I/O, no config, no framework imports — safe to unit test.
 */

export interface Viewport {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
  follow: boolean;
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function isInvisibleCodePoint(code: number): boolean {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202f) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe0fff)
  );
}

function stripInvisible(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!isInvisibleCodePoint(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}

export function sanitizeTranscriptText(text: string): string {
  return stripInvisible(text.replace(ANSI_PATTERN, ""))
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");
}

export function estimateWrappedLines(text: string, width: number): number {
  const safe = Math.max(20, Math.floor(width));
  let total = 0;
  for (const line of text.split("\n")) {
    total += Math.max(1, Math.ceil((line.length || 1) / safe));
  }
  return total;
}

export function viewportSlice(total: number, height: number, scrollOffset: number): Viewport {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeHeight = Math.max(1, Math.floor(height));
  const maxOffset = Math.max(0, safeTotal - safeHeight);
  const offset = Math.max(0, Math.min(Math.floor(scrollOffset), maxOffset));
  const end = safeTotal - offset;
  const start = Math.max(0, end - safeHeight);
  return {
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: offset,
    follow: offset === 0,
  };
}

export function scrollStep(offset: number, delta: number, total: number, height: number): number {
  const maxOffset = Math.max(0, Math.floor(total) - Math.max(1, Math.floor(height)));
  return Math.max(0, Math.min(maxOffset, Math.floor(offset) + Math.floor(delta)));
}

/** Row counts per transcript entry for a width-aware viewport.
 * user/assistant entries carry a blank lead-in row (their marginTop). */
export function transcriptRowCounts(
  lines: Array<{ role: string; text: string }>,
  width: number,
): number[] {
  const safe = Math.max(20, Math.floor(width));
  return lines.map((line) => {
    const body = estimateWrappedLines(line.text, safe);
    return line.role === "user" || line.role === "assistant" ? body + 1 : body;
  });
}

export interface RowViewport {
  /** first visible entry index (inclusive) */
  start: number;
  /** one-past-last visible entry index */
  end: number;
  hiddenAboveRows: number;
  hiddenBelowRows: number;
  follow: boolean;
}

/** Entry-granular slice of a row-measured transcript.
 * offsetRows hides whole entries from the bottom; 0 follows live output. */
export function sliceByRows(counts: number[], height: number, offsetRows: number): RowViewport {
  const safeHeight = Math.max(1, Math.floor(height));
  const total = counts.reduce((sum, c) => sum + Math.max(0, c), 0);
  const maxOffset = Math.max(0, total - safeHeight);
  const offset = Math.max(0, Math.min(Math.floor(offsetRows), maxOffset));
  let end = counts.length;
  let skip = offset;
  while (end > 0 && skip >= (counts[end - 1] ?? 0)) {
    skip -= counts[end - 1] ?? 0;
    end -= 1;
  }
  let start = end;
  let used = 0;
  while (start > 0 && used + (counts[start - 1] ?? 0) <= safeHeight) {
    used += counts[start - 1] ?? 0;
    start -= 1;
  }
  if (start === end && end > 0) start = end - 1;
  const hiddenAboveRows = counts.slice(0, start).reduce((sum, c) => sum + Math.max(0, c), 0);
  return {
    start,
    end,
    hiddenAboveRows,
    hiddenBelowRows: offset,
    follow: offset === 0,
  };
}

/** Indices of entries whose text contains the needle (case-insensitive). */
export function findMatches(lines: Array<{ text: string }>, needle: string): number[] {
  const query = needle.trim().toLowerCase();
  if (query === "") return [];
  const out: number[] = [];
  lines.forEach((line, index) => {
    if (line.text.toLowerCase().includes(query)) out.push(index);
  });
  return out;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function queuePreview(queue: string[], limit = 3): { shown: string[]; remaining: number } {
  const safe = Math.max(1, Math.floor(limit));
  const shown = queue.slice(0, safe);
  return { shown, remaining: Math.max(0, queue.length - shown.length) };
}

export function capTranscript<T>(lines: T[], cap: number): { kept: T[]; dropped: number } {
  const safe = Math.max(1, Math.floor(cap));
  if (lines.length <= safe) return { kept: lines, dropped: 0 };
  return { kept: lines.slice(lines.length - safe), dropped: lines.length - safe };
}
