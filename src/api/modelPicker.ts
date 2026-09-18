import { emitKeypressEvents } from "node:readline";
import type { ModelInfo } from "@/domain/models";

export interface PickerTheme {
  color: boolean;
  highlightBg: string;
  provider: string;
  free: string;
  dim: string;
}

export const PICKER_THEME: PickerTheme = {
  color: true,
  highlightBg: "\x1b[48;5;208m\x1b[30m",
  provider: "\x1b[35m",
  free: "\x1b[32m",
  dim: "\x1b[90m",
};

export const PICKER_PLAIN: PickerTheme = {
  color: false,
  highlightBg: "",
  provider: "",
  free: "",
  dim: "",
};

const RESET = "\x1b[0m";

function paint(theme: PickerTheme, code: string, text: string): string {
  return theme.color && code !== "" ? `${code}${text}${RESET}` : text;
}

export interface PickerItem {
  model: ModelInfo;
  provider: string;
}

export function groupModels(models: ModelInfo[]): Map<string, ModelInfo[]> {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const group = groups.get(model.provider) ?? [];
    group.push(model);
    groups.set(model.provider, group);
  }
  return groups;
}

export function flattenGroups(groups: Map<string, ModelInfo[]>): PickerItem[] {
  const items: PickerItem[] = [];
  for (const [provider, models] of groups) {
    for (const model of models) {
      items.push({ model, provider });
    }
  }
  return items;
}

export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return models;
  return models.filter(
    (m) =>
      m.id.toLowerCase().includes(needle) ||
      m.label.toLowerCase().includes(needle) ||
      m.provider.toLowerCase().includes(needle),
  );
}

export function moveCursor(cursor: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((cursor + delta) % length) + length) % length;
}

export function toggleSelected(selected: Set<string>, id: string): void {
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
}

export function toggleGroup(selected: Set<string>, items: PickerItem[], provider: string): void {
  const ids = items.filter((i) => i.provider === provider).map((i) => i.model.id);
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  for (const id of ids) {
    if (all) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
  }
}

export interface PickerRender {
  text: string;
  lines: number;
}

export function renderPicker(
  theme: PickerTheme,
  items: PickerItem[],
  cursor: number,
  selected: Set<string>,
  query: string,
  maxRows: number,
): PickerRender {
  const lines: string[] = [];
  lines.push(`Select model${theme.color ? paint(theme, theme.dim, " ".repeat(50) + "esc") : ""}`);
  lines.push(theme.color ? `> ${query}${paint(theme, theme.dim, "▌")}` : `> ${query}`);
  lines.push("");
  const rows = Math.max(5, maxRows);
  let start = 0;
  if (cursor >= start + rows) start = cursor - rows + 1;
  const window = items.slice(start, start + rows);
  let lastProvider: string | undefined;
  for (const [offset, item] of window.entries()) {
    const index = start + offset;
    if (item.provider !== lastProvider) {
      lastProvider = item.provider;
      lines.push(paint(theme, theme.provider, item.provider));
    }
    const active = index === cursor;
    const picked = selected.has(item.model.id);
    const mark = picked ? "●" : "○";
    const free = item.model.tags.includes("free") ? paint(theme, theme.free, "  Free") : "";
    const row = `${mark} ${item.model.id}${free}`;
    if (theme.color && active) {
      lines.push(`${theme.highlightBg} ${row} ${RESET}`);
    } else if (!theme.color && active) {
      lines.push(`> ${row}`);
    } else {
      lines.push(`  ${row}`);
    }
  }
  lines.push("");
  const footer =
    `↑↓ move · Space toggle${query === "" ? " · a group" : ""} · Enter confirm · Esc cancel` +
    (selected.size > 0 ? paint(theme, theme.dim, ` · ${selected.size} selected`) : "");
  lines.push(theme.color ? paint(theme, theme.dim, footer) : footer);
  return { text: lines.join("\n"), lines: lines.length };
}

export async function pickModels(
  models: ModelInfo[],
  theme: PickerTheme,
  maxRows: number,
): Promise<string[] | null> {
  const selected = new Set<string>();
  let query = "";
  let cursor = 0;
  let items = flattenGroups(groupModels(models));
  let rendered: PickerRender | undefined;

  const stdin = process.stdin;
  const stdout = process.stdout;
  emitKeypressEvents(stdin);
  const raw = stdin as unknown as { isRaw?: boolean; setRawMode?: (mode: boolean) => void };
  const wasRaw = stdin.isTTY === true ? (raw.isRaw ?? false) : false;
  if (stdin.isTTY === true) raw.setRawMode?.(true);
  stdout.write("\x1b[?25l");

  const draw = (): void => {
    items = flattenGroups(groupModels(filterModels(models, query)));
    cursor = items.length === 0 ? 0 : Math.min(cursor, items.length - 1);
    if (rendered !== undefined) {
      stdout.write(`\x1b[${rendered.lines}A`);
    }
    rendered = renderPicker(theme, items, cursor, selected, query, maxRows);
    stdout.write(`\x1b[0J${rendered.text}`);
  };

  try {
    return await new Promise<string[] | null>((resolvePromise) => {
      const cleanup = (): void => {
        stdin.removeListener("keypress", onKeypress);
        if (stdin.isTTY === true) raw.setRawMode?.(wasRaw);
        stdout.write("\x1b[?25h\n");
      };
      const onKeypress = (
        chunk: string | undefined,
        key: { name?: string; ctrl?: boolean; sequence?: string } | undefined,
      ): void => {
        if (key?.ctrl === true && key.name === "c") {
          cleanup();
          resolvePromise(null);
          return;
        }
        switch (key?.name) {
          case "up":
            cursor = moveCursor(cursor, -1, items.length);
            draw();
            return;
          case "down":
            cursor = moveCursor(cursor, 1, items.length);
            draw();
            return;
          case "space": {
            const current = items[cursor];
            if (current !== undefined) toggleSelected(selected, current.model.id);
            cursor = moveCursor(cursor, 1, items.length);
            draw();
            return;
          }
          case "return": {
            if (items.length === 0) {
              draw();
              return;
            }
            if (selected.size === 0) {
              const current = items[cursor];
              if (current !== undefined) selected.add(current.model.id);
            }
            cleanup();
            resolvePromise([...selected]);
            return;
          }
          case "escape":
            if (query !== "") {
              query = "";
              cursor = 0;
              draw();
              return;
            }
            cleanup();
            resolvePromise(null);
            return;
          case "backspace":
            query = query.slice(0, -1);
            cursor = 0;
            draw();
            return;
          default:
            break;
        }
        if (key?.name === "a" && query === "") {
          const current = items[cursor];
          if (current !== undefined) toggleGroup(selected, items, current.provider);
          draw();
          return;
        }
        const char = typeof chunk === "string" && chunk.length === 1 ? chunk : key?.sequence;
        if (typeof char === "string" && char >= " " && char !== "\x7f") {
          query += char;
          cursor = 0;
          draw();
        }
      };
      stdin.on("keypress", onKeypress);
      draw();
    });
  } finally {
    if (stdin.isTTY === true) raw.setRawMode?.(wasRaw);
    stdout.write("\x1b[?25h");
  }
}
