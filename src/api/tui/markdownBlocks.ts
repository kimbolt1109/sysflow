export interface Span {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "bullet"; indent: number; marker: string; spans: Span[] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "rule" }
  | { kind: "text"; spans: Span[] }
  | { kind: "blank" };

/** `**bold**` and `code` only: underscores and single stars show up in paths and
 * globs too often to treat as emphasis. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) spans.push({ text: text.slice(last, at) });
    // Models love **`name`**: bold text can itself hold inline code.
    if (match[2] !== undefined)
      spans.push(...parseInline(match[2]).map((s) => ({ ...s, bold: true })));
    else spans.push({ text: match[3] ?? "", code: true });
    last = at + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length > 0 ? spans : [{ text: "" }];
}

/** Line-oriented markdown for terminal display. Tolerates half-streamed input:
 * an unclosed code fence renders as code up to the end. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let code: { lang: string; lines: string[] } | undefined;
  for (const raw of text.split("\n")) {
    const fence = /^\s*```(\S*)\s*$/.exec(raw);
    if (code !== undefined) {
      if (fence !== null) {
        blocks.push({ kind: "code", ...code });
        code = undefined;
      } else {
        code.lines.push(raw);
      }
      continue;
    }
    if (fence !== null) {
      code = { lang: fence[1] ?? "", lines: [] };
      continue;
    }
    if (raw.trim() === "") {
      if (blocks[blocks.length - 1]?.kind !== "blank") blocks.push({ kind: "blank" });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        spans: parseInline(heading[2] ?? ""),
      });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      blocks.push({ kind: "rule" });
      continue;
    }
    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (bullet !== null) {
      const marker = /^\d/.test(bullet[2] ?? "") ? (bullet[2] ?? "") : "•";
      blocks.push({
        kind: "bullet",
        indent: Math.floor((bullet[1]?.length ?? 0) / 2),
        marker,
        spans: parseInline(bullet[3] ?? ""),
      });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(raw);
    if (quote !== null) {
      blocks.push({ kind: "quote", spans: parseInline(quote[1] ?? "") });
      continue;
    }
    blocks.push({ kind: "text", spans: parseInline(raw) });
  }
  if (code !== undefined) blocks.push({ kind: "code", ...code });
  while (blocks[blocks.length - 1]?.kind === "blank") blocks.pop();
  return blocks;
}
