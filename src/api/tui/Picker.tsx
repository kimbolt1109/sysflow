import { Box, Text, useInput } from "ink";
import { useMemo, useState, type ReactElement } from "react";
import { buildPickerItems } from "@/api/modelPicker.js";
import type { ModelInfo } from "@/domain/models.js";
import { applyPickerKey, initPickerState } from "@/api/tui/pickerState.js";

export interface PickerProps {
  models: ModelInfo[];
  maxRows?: number;
  initialSelected?: string[];
  recent?: string[];
  onDone: (ids: string[]) => void;
  onCancel: () => void;
}

export function Picker({
  models,
  maxRows = 15,
  initialSelected = [],
  recent = [],
  onDone,
  onCancel,
}: PickerProps): ReactElement {
  const [state, setState] = useState(() => initPickerState(initialSelected, recent));
  const items = useMemo(
    () => buildPickerItems(models, state.query, state.recent),
    [models, state.query, state.recent],
  );

  useInput((input, key) => {
    const step = applyPickerKey(models, state, {
      input,
      ctrl: key.ctrl,
      meta: key.meta,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      enter: key.return,
      escape: key.escape,
      backspace: key.backspace || key.delete,
    });
    if (step.done !== undefined) {
      onDone(step.done);
      return;
    }
    if (step.cancelled === true) {
      onCancel();
      return;
    }
    setState(step.state);
  });

  const rows = Math.max(5, maxRows);
  const start = state.cursor >= rows ? state.cursor - rows + 1 : 0;
  const window = items.slice(start, start + rows);
  const footer =
    state.query === ""
      ? "↑↓ move · Enter/Space toggle · a group · m done · Esc cancel"
      : "↑↓ move · Enter/Space toggle · Esc clear";

  let lastProvider: string | undefined;
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="green">
          ◆ sys
        </Text>
        <Text bold> · Select models</Text>
        <Text dimColor> (1/3)</Text>
        {state.selected.length > 0 && (
          <Text color="green"> · {state.selected.length} selected</Text>
        )}
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="green">❯ </Text>
        <Text>
          {state.query}
          <Text dimColor>▌</Text>
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {items.length === 0 && <Text dimColor>No models match — Esc clears the search.</Text>}
        {window.map((item, offset) => {
          const header =
            item.provider !== lastProvider ? (
              <Text bold color="magenta">
                {item.provider}
              </Text>
            ) : null;
          lastProvider = item.provider;
          const active = start + offset === state.cursor;
          const picked = state.selected.includes(item.model.id);
          return (
            <Box key={`row-${item.model.id}`} flexDirection="column">
              {header}
              <Text key={item.model.id} bold={active} color={active ? "green" : undefined}>
                {active ? ">" : " "} {picked ? <Text color="green">●</Text> : "○"} {item.model.id}
                {item.model.tags.includes("free") ? <Text color="green"> Free</Text> : ""}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {footer}
          {state.selected.length > 0 ? ` · ${state.selected.length} selected` : ""}
        </Text>
      </Box>
    </Box>
  );
}
