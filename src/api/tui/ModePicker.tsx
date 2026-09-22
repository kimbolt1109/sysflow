import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { MODE_DESCRIPTIONS } from "@/api/selector.js";
import type { OrchestrationMode } from "@/domain/models.js";
import { moveCursor } from "@/api/modelPicker.js";

const MODES: OrchestrationMode[] = ["solo", "council", "relay", "workers", "auto"];

export interface ModePickerProps {
  defaultMode: OrchestrationMode;
  onDone: (mode: OrchestrationMode) => void;
  onCancel: () => void;
}

export function ModePicker({ defaultMode, onDone, onCancel }: ModePickerProps): ReactElement {
  const initial = Math.max(0, MODES.indexOf(defaultMode));
  const [cursor, setCursor] = useState(initial);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => moveCursor(c, -1, MODES.length));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => moveCursor(c, 1, MODES.length));
      return;
    }
    if (key.return) {
      const mode = MODES[cursor];
      if (mode !== undefined) onDone(mode);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (input === "q") onCancel();
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="green">
          ◆ sys
        </Text>
        <Text bold> · Select mode</Text>
        <Text dimColor> (2/3)</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        {MODES.map((mode, index) => (
          <Box key={mode} flexDirection="column">
            <Text bold={index === cursor} color={index === cursor ? "green" : undefined}>
              {index === cursor ? ">" : " "} {mode}
            </Text>
            <Text dimColor>
              {"    "}
              {MODE_DESCRIPTIONS[mode]}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}
