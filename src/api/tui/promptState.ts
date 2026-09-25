/** Pure line-editing core for the TUI prompt input.
 * No I/O, no framework imports — the Ink component is a thin wrapper.
 */

export interface PromptEdit {
  value: string;
  /** caret offset in UTF-16 code units */
  cursor: number;
}

export function clampCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.max(0, Math.min(value.length, Math.floor(cursor)));
}

export function insertText(edit: PromptEdit, text: string): PromptEdit {
  if (text === "") return edit;
  const cursor = clampCursor(edit.value, edit.cursor);
  const value = `${edit.value.slice(0, cursor)}${text}${edit.value.slice(cursor)}`;
  return { value, cursor: cursor + text.length };
}

/** Text from a paste (or any multi-character chunk): terminals send CR or CRLF line
 * ends and may carry stray control bytes; keep newlines and tabs, drop the rest. */
export function pastedText(chunk: string): string {
  let out = "";
  for (const ch of chunk.replace(/\r\n?/g, "\n")) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\t" || (code >= 0x20 && code !== 0x7f)) out += ch;
  }
  return out;
}

export function eraseBackward(edit: PromptEdit): PromptEdit {
  const cursor = clampCursor(edit.value, edit.cursor);
  if (cursor === 0) return edit;
  return { value: edit.value.slice(0, cursor - 1) + edit.value.slice(cursor), cursor: cursor - 1 };
}

export function eraseForward(edit: PromptEdit): PromptEdit {
  const cursor = clampCursor(edit.value, edit.cursor);
  if (cursor >= edit.value.length) return edit;
  return { value: edit.value.slice(0, cursor) + edit.value.slice(cursor + 1), cursor };
}

export function moveChar(edit: PromptEdit, delta: number): PromptEdit {
  return { value: edit.value, cursor: clampCursor(edit.value, edit.cursor + delta) };
}

function lineStartOf(value: string, cursor: number): number {
  return value.lastIndexOf("\n", clampCursor(value, cursor) - 1) + 1;
}

function lineEndOf(value: string, cursor: number): number {
  const next = value.indexOf("\n", clampCursor(value, cursor));
  return next < 0 ? value.length : next;
}

export function moveLineStart(edit: PromptEdit): PromptEdit {
  return { value: edit.value, cursor: lineStartOf(edit.value, edit.cursor) };
}

export function moveLineEnd(edit: PromptEdit): PromptEdit {
  return { value: edit.value, cursor: lineEndOf(edit.value, edit.cursor) };
}

/** Move the caret across logical lines, keeping the column when possible. */
export function moveLineVertical(edit: PromptEdit, delta: number): PromptEdit {
  if (delta === 0) return edit;
  const value = edit.value;
  const cursor = clampCursor(value, edit.cursor);
  const lines = value.split("\n");
  let line = 0;
  let rest = cursor;
  for (let i = 0; i < lines.length; i += 1) {
    const len = lines[i]?.length ?? 0;
    if (rest <= len) {
      line = i;
      break;
    }
    rest -= len + 1;
    line = i + 1;
  }
  const col = rest;
  const target = Math.max(0, Math.min(lines.length - 1, line + delta));
  if (target === line) return { value, cursor };
  const targetLen = lines[target]?.length ?? 0;
  let offset = 0;
  for (let i = 0; i < target; i += 1) offset += (lines[i]?.length ?? 0) + 1;
  return { value, cursor: offset + Math.min(col, targetLen) };
}

/** Is the caret on the first / last logical line? (history takes over at edges) */
export function caretLinePosition(edit: PromptEdit): "first" | "middle" | "last" | "only" {
  const cursor = clampCursor(edit.value, edit.cursor);
  const before = edit.value.slice(0, cursor).includes("\n");
  const after = edit.value.slice(cursor).includes("\n");
  if (!before && !after) return "only";
  if (!before) return "first";
  if (!after) return "last";
  return "middle";
}

export function killToLineStart(edit: PromptEdit): PromptEdit {
  const cursor = clampCursor(edit.value, edit.cursor);
  const start = lineStartOf(edit.value, cursor);
  return { value: edit.value.slice(0, start) + edit.value.slice(cursor), cursor: start };
}

export function killToLineEnd(edit: PromptEdit): PromptEdit {
  const cursor = clampCursor(edit.value, edit.cursor);
  const end = lineEndOf(edit.value, cursor);
  return { value: edit.value.slice(0, cursor) + edit.value.slice(end), cursor };
}

/** Delete back to the previous whitespace (one path or flag per press). */
export function killWordBackward(edit: PromptEdit): PromptEdit {
  let cursor = clampCursor(edit.value, edit.cursor);
  const value = edit.value;
  while (cursor > 0 && /\s/.test(value[cursor - 1] ?? "")) cursor -= 1;
  while (cursor > 0 && !/\s/.test(value[cursor - 1] ?? "")) cursor -= 1;
  return { value: value.slice(0, cursor) + value.slice(clampCursor(value, edit.cursor)), cursor };
}

/** Accept a slash-menu completion for a leading-slash draft. */
export function acceptSlashCompletion(completion: string): PromptEdit {
  const next = completion.includes(" ") ? completion : `${completion} `;
  return { value: next, cursor: next.length };
}
