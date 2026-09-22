import { Box, Text, useInput } from "ink";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { filterSlash, type SlashEntry } from "@/api/tui/slashMenu.js";
import {
  acceptSlashCompletion,
  caretLinePosition,
  eraseBackward,
  eraseForward,
  insertText,
  killToLineEnd,
  killToLineStart,
  killWordBackward,
  moveChar,
  moveLineEnd,
  moveLineStart,
  moveLineVertical,
  type PromptEdit,
} from "@/api/tui/promptState.js";

export interface PromptInputProps {
  initialValue?: string;
  history: string[];
  catalog: SlashEntry[];
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  onToggleHelp: () => void;
}

export function PromptInput({
  initialValue = "",
  history,
  catalog,
  placeholder = "",
  onChange,
  onSubmit,
  onToggleHelp,
}: PromptInputProps): ReactElement {
  const [edit, setEdit] = useState<PromptEdit>({
    value: initialValue,
    cursor: initialValue.length,
  });
  const [histIndex, setHistIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuBrowsed, setMenuBrowsed] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const escRef = useRef(0);

  const menuSource = edit.value.includes("\n") ? "" : edit.value;
  const menu = useMemo(
    () => (menuDismissed ? [] : filterSlash(menuSource, catalog)),
    [menuSource, catalog, menuDismissed],
  );
  const menuActive = menu.length > 0;

  const commit = (next: PromptEdit): void => {
    setEdit(next);
    setMenuIndex(0);
    setMenuBrowsed(false);
    setMenuDismissed(false);
    onChange?.(next.value);
  };

  const acceptCompletion = (command: string): void => {
    commit(acceptSlashCompletion(command));
  };

  const resetAll = (): void => {
    setEdit({ value: "", cursor: 0 });
    setHistIndex(-1);
    setSavedDraft("");
    setMenuIndex(0);
    setMenuBrowsed(false);
    setMenuDismissed(false);
  };

  const submit = (): void => {
    const value = edit.value;
    resetAll();
    onChange?.("");
    onSubmit(value);
  };

  const goHistory = (dir: -1 | 1): void => {
    if (history.length === 0) return;
    if (histIndex === -1) {
      if (dir === 1) return;
      setSavedDraft(edit.value);
      const idx = history.length - 1;
      setHistIndex(idx);
      const recalled = history[idx] ?? "";
      commit({ value: recalled, cursor: recalled.length });
      return;
    }
    const next = histIndex + dir;
    if (next < 0) return;
    if (next >= history.length) {
      setHistIndex(-1);
      commit({ value: savedDraft, cursor: savedDraft.length });
      return;
    }
    setHistIndex(next);
    const recalled = history[next] ?? "";
    commit({ value: recalled, cursor: recalled.length });
  };

  useInput((input, key) => {
    if (key.return) {
      if (edit.value.endsWith("\\")) {
        const cut: PromptEdit = {
          value: edit.value.slice(0, -1),
          cursor: Math.max(0, edit.cursor - 1),
        };
        commit(insertText(cut, "\n"));
        return;
      }
      if (menuActive && menuBrowsed) {
        const pick = menu[menuIndex] ?? menu[0];
        if (pick !== undefined) acceptCompletion(pick.command);
        return;
      }
      submit();
      return;
    }
    if (key.tab && !key.shift) {
      if (menuActive) {
        const pick = menu[menuIndex] ?? menu[0];
        if (pick !== undefined) acceptCompletion(pick.command);
      }
      return;
    }
    if (key.escape) {
      if (menuActive) {
        setMenuDismissed(true);
        setMenuBrowsed(false);
        setMenuIndex(0);
        return;
      }
      if (edit.value !== "") {
        commit({ value: "", cursor: 0 });
        return;
      }
      const now = Date.now();
      if (now - escRef.current < 800) {
        escRef.current = 0;
        onToggleHelp();
      } else {
        escRef.current = now;
      }
      return;
    }
    if (key.upArrow) {
      if (menuActive) {
        setMenuIndex((i) => (i - 1 + menu.length) % menu.length);
        setMenuBrowsed(true);
        return;
      }
      const pos = caretLinePosition(edit);
      if (pos === "first" || pos === "only") {
        goHistory(-1);
        return;
      }
      commit(moveLineVertical(edit, -1));
      return;
    }
    if (key.downArrow) {
      if (menuActive) {
        setMenuIndex((i) => (i + 1) % menu.length);
        setMenuBrowsed(true);
        return;
      }
      const pos = caretLinePosition(edit);
      if (pos === "last" || pos === "only") {
        goHistory(1);
        return;
      }
      commit(moveLineVertical(edit, 1));
      return;
    }
    if (key.leftArrow) {
      commit(moveChar(edit, -1));
      return;
    }
    if (key.rightArrow) {
      commit(moveChar(edit, 1));
      return;
    }
    if (key.backspace) {
      commit(eraseBackward(edit));
      return;
    }
    if (key.delete) {
      commit(eraseForward(edit));
      return;
    }
    if (key.ctrl && input === "a") {
      commit(moveLineStart(edit));
      return;
    }
    if (key.ctrl && input === "e") {
      commit(moveLineEnd(edit));
      return;
    }
    if (key.ctrl && input === "u") {
      commit(killToLineStart(edit));
      return;
    }
    if (key.ctrl && input === "k") {
      commit(killToLineEnd(edit));
      return;
    }
    if (key.ctrl && input === "w") {
      commit(killWordBackward(edit));
      return;
    }
    if (input.length === 1 && !key.ctrl && !key.meta) {
      commit(insertText(edit, input));
    }
  });

  const lines = edit.value.split("\n");
  let caretLine = 0;
  let caretCol = edit.cursor;
  for (let i = 0; i < lines.length; i += 1) {
    const len = lines[i]?.length ?? 0;
    if (caretCol <= len) {
      caretLine = i;
      break;
    }
    caretCol -= len + 1;
    caretLine = i;
  }

  return (
    <Box flexDirection="column">
      {menuActive && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {menu.map((m, i) => (
            <Text
              key={m.command}
              dimColor={i !== menuIndex}
              bold={i === menuIndex}
              color={i === menuIndex ? "green" : undefined}
              wrap="truncate"
            >
              {i === menuIndex ? ">" : " "} [{m.group}] {m.command} — {m.hint}
            </Text>
          ))}
          <Text dimColor>↑↓ browse · Tab accept · Enter {menuBrowsed ? "accepts" : "sends"}</Text>
        </Box>
      )}
      <Box>
        <Text color="green">❯ </Text>
        <Box flexDirection="column" flexGrow={1}>
          {edit.value === "" ? (
            <Text dimColor>{placeholder}▌</Text>
          ) : (
            lines.map((ln, i) =>
              i === caretLine ? (
                <Text key={i} wrap="wrap">
                  {ln.slice(0, caretCol)}
                  <Text inverse>{ln[caretCol] ?? " "}</Text>
                  {ln.slice(caretCol + 1)}
                </Text>
              ) : (
                <Text key={i} wrap="wrap">
                  {ln === "" ? " " : ln}
                </Text>
              ),
            )
          )}
        </Box>
      </Box>
    </Box>
  );
}
