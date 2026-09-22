import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { moveCursor } from "@/api/modelPicker.js";
import { THINKING_DESCRIPTIONS, THINKING_LEVELS, type ThinkingLevel } from "@/domain/thinking.js";

export interface ThinkingPickerProps {
  defaultLevel: ThinkingLevel;
  onDone: (level: ThinkingLevel) => void;
  onCancel: () => void;
}

export function ThinkingPicker({
  defaultLevel,
  onDone,
  onCancel,
}: ThinkingPickerProps): ReactElement {
  const initial = Math.max(0, THINKING_LEVELS.indexOf(defaultLevel));
  const [cursor, setCursor] = useState(initial);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => moveCursor(c, -1, THINKING_LEVELS.length));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => moveCursor(c, 1, THINKING_LEVELS.length));
      return;
    }
    if (key.return) {
      const level = THINKING_LEVELS[cursor];
      if (level !== undefined) onDone(level);
      return;
    }
    if (key.escape || input === "q") {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="green">
          ◆ sys
        </Text>
        <Text bold> · Thinking level</Text>
        <Text dimColor> (3/3 — last step)</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        {THINKING_LEVELS.map((level, index) => (
          <Box key={level} flexDirection="column">
            <Text bold={index === cursor} color={index === cursor ? "green" : undefined}>
              {index === cursor ? ">" : " "} {level}
            </Text>
            <Text dimColor>
              {"    "}
              {THINKING_DESCRIPTIONS[level]}
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
