import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { OrchestrationMode } from "@/domain/models.js";

export interface AgentBadge {
  name: string;
  lead: boolean;
  muted: boolean;
  stopped: boolean;
}

export const SIDEBAR_WIDTH = 34;

/** Council roster. Solo sessions have no sidebar: the header already names the model. */
export function SideBar({
  mode,
  agents,
}: {
  mode: OrchestrationMode;
  agents: AgentBadge[];
}): ReactElement {
  return (
    <Box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      marginLeft={1}
      alignSelf="flex-start"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold>
        {mode} · {agents.length} agents
      </Text>
      {agents.map((a) => (
        <Text key={a.name} dimColor={a.muted || a.stopped} wrap="truncate-middle">
          <Text color={a.lead ? "green" : undefined}>{a.lead ? "◆" : "◇"}</Text> {a.name}
          {a.muted ? " (muted)" : ""}
          {a.stopped ? " (stopped)" : ""}
        </Text>
      ))}
    </Box>
  );
}

export interface HeaderProps {
  left: string;
  right?: string;
  alert?: string;
}

export function Header({ left, right, alert }: HeaderProps): ReactElement {
  return (
    <Text wrap="truncate-end">
      <Text bold color="green">
        ◆ sys
      </Text>
      <Text bold>{`  ${left}`}</Text>
      {right !== undefined && right !== "" && <Text dimColor>{`  ${right}`}</Text>}
      {alert !== undefined && alert !== "" && (
        <Text bold color="red">
          {`  ${alert}`}
        </Text>
      )}
    </Text>
  );
}

export interface StatusBarProps {
  left: string;
  right?: string;
}

export function StatusBar({ left, right }: StatusBarProps): ReactElement {
  return (
    <Box justifyContent="space-between">
      <Text dimColor wrap="truncate-end">
        {left}
      </Text>
      {right !== undefined && right !== "" && (
        <Text dimColor wrap="truncate-start">
          {right}
        </Text>
      )}
    </Box>
  );
}

export function ShortcutsBar({ narrow = false }: { narrow?: boolean }): ReactElement {
  return (
    <Text dimColor wrap="truncate-end">
      {narrow
        ? "/ commands · PgUp/PgDn scroll · Esc Esc help"
        : "/ commands · ↑↓ history · PgUp/PgDn scroll · Shift+Tab permissions · Ctrl+S stash · Esc Esc help"}
    </Text>
  );
}

export function QueuePane({ queue }: { queue: string[] }): ReactElement | null {
  if (queue.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        queued ({queue.length}) — runs in order after this turn
      </Text>
      {queue.slice(0, 3).map((q, i) => (
        <Text key={`${i}-${q.slice(0, 24)}`} dimColor wrap="truncate-end">
          {i + 1}. {q.replace(/\s+/g, " ")}
        </Text>
      ))}
      {queue.length > 3 && <Text dimColor>+{queue.length - 3} more</Text>}
    </Box>
  );
}

export const HELP_ROWS: Array<[string, string]> = [
  ["PgUp / PgDn", "scroll conversation, PgDn returns to live"],
  ["Ctrl+B", "show / hide the council roster"],
  ["Ctrl+S", "stash the draft, press again to restore"],
  ["Shift+Tab", "cycle permission mode"],
  ["/ menu", "↑↓ browse · Tab accept · Enter sends (accepts while browsing)"],
  ["Up / Down", "command history, or move between lines in multiline input"],
  ["\\ + Enter", "newline instead of sending"],
  ["/find text", "search the transcript, repeat /find to cycle matches"],
  ["/dump [path]", "save the transcript to a markdown file"],
  ["Esc Esc", "toggle this help (when the input is empty)"],
  ["/exit", "quit the session"],
];

export function HelpOverlay(): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
      <Text bold color="green">
        ? shortcuts
      </Text>
      {HELP_ROWS.map(([keys, what]) => (
        <Text key={keys}>
          <Text bold>{keys.padEnd(14)}</Text>
          <Text dimColor>{what}</Text>
        </Text>
      ))}
    </Box>
  );
}
