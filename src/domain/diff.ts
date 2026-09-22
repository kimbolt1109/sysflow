export type DiffOp = " " | "+" | "-" | "~";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

const MAX_DIFF_LINES = 1500;
const MAX_RENDER_OPS = 120;

function splitLines(text: string): string[] {
  return text.split("\n");
}

function lcsOps(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head = a.slice(0, start).map((text) => ({ op: " " as DiffOp, text }));
  const tail = a.slice(endA).map((text) => ({ op: " " as DiffOp, text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length === 0 && midB.length === 0) return [...head, ...tail];
  const n = midA.length;
  const m = midB.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        midA[i] === midB[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
    }
  }
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      mid.push({ op: " ", text: midA[i] as string });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      mid.push({ op: "-", text: midA[i] as string });
      i += 1;
    } else {
      mid.push({ op: "+", text: midB[j] as string });
      j += 1;
    }
  }
  while (i < n) {
    mid.push({ op: "-", text: midA[i] as string });
    i += 1;
  }
  while (j < m) {
    mid.push({ op: "+", text: midB[j] as string });
    j += 1;
  }
  return [...head, ...mid, ...tail];
}

export function diffFile(path: string, oldText: string | null, newText: string | null): FileDiff {
  if (oldText === newText) return { path, added: 0, removed: 0, lines: [] };
  if (oldText === null || newText === null) {
    const text = (oldText ?? newText ?? "").replace(/\0/g, "");
    const lines = splitLines(text).slice(0, MAX_RENDER_OPS);
    const op: DiffOp = oldText === null ? "+" : "-";
    const rendered: DiffLine[] = lines.map((t) => ({ op, text: t }));
    if (splitLines(text).length > lines.length) {
      rendered.push({ op: "~", text: `… ${splitLines(text).length - lines.length} more lines` });
    }
    return {
      path,
      added: op === "+" ? splitLines(text).length : 0,
      removed: op === "-" ? splitLines(text).length : 0,
      lines: rendered,
    };
  }
  if (oldText.includes("\0") || newText.includes("\0")) {
    return { path, added: 0, removed: 0, lines: [{ op: "~", text: "binary file changed" }] };
  }
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return {
      path,
      added: 0,
      removed: 0,
      lines: [{ op: "~", text: `large file (${a.length}→${b.length} lines), see /review` }],
    };
  }
  const lines = lcsOps(a, b);
  const added = lines.filter((l) => l.op === "+").length;
  const removed = lines.filter((l) => l.op === "-").length;
  const rendered = lines.slice(0, MAX_RENDER_OPS);
  if (lines.length > rendered.length) {
    rendered.push({ op: "~", text: `… ${lines.length - rendered.length} more lines` });
  }
  return { path, added, removed, lines: rendered };
}

export function diffCheckpoints(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): FileDiff[] {
  const out: FileDiff[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)]).values()) {
    const diff = diffFile(path, before[path] ?? null, after[path] ?? null);
    if (diff.lines.length > 0) out.push(diff);
  }
  return out.sort((x, y) => (x.path < y.path ? -1 : 1));
}
