import {
  buildPickerItems,
  moveCursor,
  shouldConfirmWithM,
  toggleGroup,
  toggleSelected,
} from "@/api/modelPicker.js";
import type { ModelInfo } from "@/domain/models.js";

export interface PickerState {
  query: string;
  cursor: number;
  selected: string[];
  recent: string[];
}

export interface PickerKey {
  input: string;
  ctrl?: boolean;
  meta?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  enter?: boolean;
  escape?: boolean;
  backspace?: boolean;
}

export interface PickerStep {
  state: PickerState;
  done?: string[];
  cancelled?: boolean;
}

export function initPickerState(selected: string[] = [], recent: string[] = []): PickerState {
  return { query: "", cursor: 0, selected: [...selected], recent: [...recent] };
}

function visibleIds(models: ModelInfo[], query: string, recent: string[]): string[] {
  return buildPickerItems(models, query, recent).map((i) => i.model.id);
}

function next(
  prev: PickerState,
  query: string,
  cursor: number,
  selected: Set<string>,
): PickerState {
  return { query, cursor, selected: [...selected], recent: prev.recent };
}

export function applyPickerKey(models: ModelInfo[], prev: PickerState, key: PickerKey): PickerStep {
  const ids = visibleIds(models, prev.query, prev.recent);
  const selected = new Set(prev.selected);
  const { query } = prev;
  let cursor = prev.cursor;

  if (key.ctrl === true && key.input === "c") return { state: prev, cancelled: true };
  if (key.upArrow === true) {
    return { state: next(prev, query, moveCursor(cursor, -1, ids.length), selected) };
  }
  if (key.downArrow === true) {
    return { state: next(prev, query, moveCursor(cursor, 1, ids.length), selected) };
  }
  if (key.enter === true || key.input === " ") {
    const current = ids[cursor];
    if (current !== undefined) toggleSelected(selected, current);
    cursor = moveCursor(cursor, 1, ids.length);
    return { state: next(prev, query, cursor, selected) };
  }
  if (key.escape === true) {
    if (query !== "") return { state: next(prev, "", 0, selected) };
    return { state: prev, cancelled: true };
  }
  if (key.backspace === true) {
    return { state: next(prev, query.slice(0, -1), 0, selected) };
  }
  if (key.input === "a" && query === "") {
    const items = buildPickerItems(models, query, prev.recent);
    const provider = items[cursor]?.provider;
    if (provider !== undefined) toggleGroup(selected, items, provider);
    return { state: next(prev, query, cursor, selected) };
  }
  if (shouldConfirmWithM(key.input, key.ctrl, query, selected.size)) {
    return { state: prev, done: [...selected] };
  }
  if (key.input !== "" && key.ctrl !== true && key.meta !== true) {
    return { state: next(prev, query + key.input, 0, selected) };
  }
  return { state: prev };
}
