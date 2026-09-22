import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { phaseLine } from "@/api/council.js";
import type { OrchestrationMode } from "@/domain/models.js";
import {
  capTranscript,
  sanitizeTranscriptText,
  sliceByRows,
  transcriptRowCounts,
} from "@/domain/transcript.js";

export interface TranscriptLine {
  key: number;
  role: "user" | "assistant" | "info" | "diff" | "error";
  text: string;
  /** epoch ms; when present a dim HH:MM:SS prefix is shown */
  at?: number;
}

export interface AgentBadge {
  name: string;
  lead: boolean;
  muted: boolean;
  stopped: boolean;
}

export interface SideBarProps {
  mode: OrchestrationMode;
  agents: AgentBadge[];
  skills: string[];
  sessionId: string;
  cost: number;
  collapsed?: boolean;
  queue?: string[];
  contextPct?: number;
  runningLabel?: string;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const PHASE = /^[─—―]+\s*(.+?)\s*[─—―]+\s*(?:\[(.*?)\]\s*)?(.*)$/;

interface FoldGroup {
  key: number;
  phase: string;
  message: string;
  agents: string[];
}

export function foldInfoLines(lines: TranscriptLine[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let group: FoldGroup | undefined;
  const flush = (): void => {
    if (group === undefined) return;
    const who = group.agents.length > 0 ? ` — ${summarizeAgents(group.agents)}` : "";
    out.push({
      key: group.key,
      role: "info",
      text: `${phaseLine(group.phase)} ${group.message}${who}`,
    });
    group = undefined;
  };
  for (const line of lines) {
    if (line.role !== "info") {
      flush();
      out.push(line);
      continue;
    }
    const match = PHASE.exec(line.text.replace(ANSI, ""));
    if (match === null) {
      flush();
      out.push(line);
      continue;
    }
    const [, phase = "", agent = "", message = ""] = match;
    if (
      group !== undefined &&
      group.phase === phase.trim() &&
      group.message === message.trim() &&
      agent.trim() !== ""
    ) {
      if (!group.agents.includes(agent.trim())) group.agents.push(agent.trim());
      continue;
    }
    flush();
    if (agent.trim() === "") {
      out.push(line);
      continue;
    }
    group = { key: line.key, phase: phase.trim(), message: message.trim(), agents: [agent.trim()] };
  }
  flush();
  return out;
}

function summarizeAgents(agents: string[]): string {
  if (agents.length <= 6) return agents.join(", ");
  return `${agents.slice(0, 6).join(", ")} +${agents.length - 6} more`;
}

function timestampOf(at: number): string {
  const date = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface TranscriptViewProps {
  lines: TranscriptLine[];
  /** visible rows; when omitted every entry shows (legacy behavior) */
  height?: number;
  /** terminal rows hidden from the bottom; 0 follows live output */
  scrollOffset?: number;
  /** hard cap on stored entries; oldest are dropped with a notice */
  maxStored?: number;
  /** transcript-area columns for wrap estimation */
  width?: number;
  /** case-insensitive substring highlighted in user/assistant/info/error lines */
  highlight?: string;
}

function Highlighted({ text, needle }: { text: string; needle: string }): ReactElement {
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Text bold color="yellow">
        {text.slice(at, at + needle.length)}
      </Text>
      {text.slice(at + needle.length)}
    </>
  );
}

export function TranscriptView({
  lines,
  height,
  scrollOffset = 0,
  maxStored = 1000,
  width = 80,
  highlight = "",
}: TranscriptViewProps): ReactElement {
  const { kept, dropped } = capTranscript(foldInfoLines(lines), maxStored);
  const clean = kept.map((line) => ({ ...line, text: sanitizeTranscriptText(line.text) }));
  const counts = transcriptRowCounts(clean, width);
  const view =
    height === undefined
      ? { start: 0, end: clean.length, hiddenAboveRows: 0, hiddenBelowRows: 0, follow: true }
      : sliceByRows(counts, height, scrollOffset);
  const visible = clean.slice(view.start, view.end);

  return (
    <Box flexDirection="column">
      {dropped > 0 && (
        <Text dimColor>
          … {dropped} earlier {dropped === 1 ? "entry" : "entries"} trimmed (bigger window: raise
          maxStored)
        </Text>
      )}
      {view.hiddenAboveRows > 0 && (
        <Text dimColor>
          ▲ ~{view.hiddenAboveRows} lines earlier · PgUp scrolls · PgDn jumps to live
        </Text>
      )}
      {visible.length === 0 && (
        <Box flexDirection="column" marginY={1}>
          <Text bold color="green">
            ◆ flow
          </Text>
          <Text dimColor>
            Ask anything or type / for commands. Conversation stays here — PgUp scrolls back, PgDn
            returns to live output.
          </Text>
        </Box>
      )}
      {visible.map((line) => {
        const stamp = line.at === undefined ? null : <Text dimColor>{timestampOf(line.at)} </Text>;
        if (line.role === "user")
          return (
            <Box key={line.key} marginTop={1}>
              <Text bold color="cyan">
                ❯{" "}
              </Text>
              <Text bold color="cyan" wrap="wrap">
                {stamp}
                <Highlighted text={line.text} needle={highlight} />
              </Text>
            </Box>
          );
        if (line.role === "info")
          return (
            <Text key={line.key} dimColor wrap="wrap">
              {stamp}· <Highlighted text={line.text} needle={highlight} />
            </Text>
          );
        if (line.role === "error")
          return (
            <Text key={line.key} bold color="red" wrap="wrap">
              {stamp}✖ <Highlighted text={line.text} needle={highlight} />
            </Text>
          );
        if (line.role === "diff")
          return (
            <Text
              key={line.key}
              color={
                line.text.startsWith("+") ? "green" : line.text.startsWith("-") ? "red" : undefined
              }
              dimColor={!line.text.startsWith("+") && !line.text.startsWith("-")}
              wrap="wrap"
            >
              {line.text}
            </Text>
          );
        return (
          <Box key={line.key} marginTop={1}>
            <Text bold color="green">
              ◆{" "}
            </Text>
            <Text wrap="wrap">
              {stamp}
              <Highlighted text={line.text} needle={highlight} />
            </Text>
          </Box>
        );
      })}
      {!view.follow && (
        <Text dimColor>▼ scrolled · PgDn returns to live (~{view.hiddenBelowRows} below)</Text>
      )}
    </Box>
  );
}

function contextBar(pct: number): string {
  const width = 10;
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${Math.round(pct * 100)}%`;
}

export function SideBar({
  mode,
  agents,
  skills,
  sessionId,
  cost,
  collapsed = false,
  queue = [],
  contextPct,
  runningLabel,
}: SideBarProps): ReactElement {
  if (collapsed) {
    return (
      <Box borderStyle="single" borderColor="gray" marginLeft={1} paddingX={1}>
        <Text dimColor>
          ◆{agents.length} · ${cost.toFixed(4)}
          {queue.length > 0 ? ` · ⏳${queue.length}` : ""}
          {runningLabel !== undefined ? ` · ${runningLabel}` : ""}
        </Text>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      width={42}
      marginLeft={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold>agents · {mode}</Text>
      {agents.map((a) => (
        <Text key={a.name} dimColor={a.muted || a.stopped} wrap="truncate-middle">
          {a.lead ? "◆" : "◇"} {a.name}
          {a.muted ? " (muted)" : ""}
          {a.stopped ? " (stopped)" : ""}
        </Text>
      ))}
      {runningLabel !== undefined && (
        <Box marginTop={1}>
          <Text color="yellow">◎ {runningLabel}</Text>
        </Box>
      )}
      {queue.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>queue ({queue.length})</Text>
          {queue.slice(0, 3).map((q, i) => (
            <Text key={`${i}-${q.slice(0, 24)}`} dimColor wrap="truncate">
              #{i + 1} {q.length > 48 ? `${q.slice(0, 48)}…` : q}
            </Text>
          ))}
          {queue.length > 3 && <Text dimColor>+{queue.length - 3} more</Text>}
        </Box>
      )}
      <Box marginTop={1}>
        <Text bold>skills ({skills.length})</Text>
      </Box>
      {skills.slice(0, 8).map((s) => (
        <Text key={s} dimColor wrap="truncate-middle">
          /{s}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {sessionId.slice(0, 8)} · ${cost.toFixed(4)}
        </Text>
        {contextPct !== undefined && <Text dimColor>ctx {contextBar(contextPct)}</Text>}
      </Box>
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
    <Box>
      <Text bold color="green">
        ◆ flow
      </Text>
      <Text bold> · {left}</Text>
      {right !== undefined && right !== "" && <Text dimColor> · {right}</Text>}
      {alert !== undefined && alert !== "" && (
        <Text bold color="red">
          {" "}
          · {alert}
        </Text>
      )}
    </Box>
  );
}

export interface StatusBarProps {
  left: string;
  right?: string;
}

export function StatusBar({ left, right }: StatusBarProps): ReactElement {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>
        {left}
        {right !== undefined && right !== "" ? ` · ${right}` : ""}
      </Text>
    </Box>
  );
}

export function ShortcutsBar({ narrow = false }: { narrow?: boolean }): ReactElement {
  return (
    <Box>
      <Text dimColor>
        {narrow
          ? "PgUp/Dn scroll · ↑↓ history · Esc Esc help · /exit quit"
          : "PgUp/PgDn scroll · ↑↓ history · Tab accept · /find · /dump · Ctrl+B sidebar · Ctrl+S stash · Shift+Tab permit · Esc Esc help"}
      </Text>
    </Box>
  );
}

export function QueuePane({ queue }: { queue: string[] }): ReactElement | null {
  if (queue.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        ⏳ queued ({queue.length}) — runs in order after this turn
      </Text>
      {queue.slice(0, 3).map((q, i) => (
        <Text key={`${i}-${q.slice(0, 24)}`} dimColor wrap="wrap">
          #{i + 1} {q.length > 120 ? `${q.slice(0, 120)}…` : q}
        </Text>
      ))}
      {queue.length > 3 && <Text dimColor>+{queue.length - 3} more</Text>}
    </Box>
  );
}

const HELP_ROWS: Array<[string, string]> = [
  ["PgUp / PgDn", "scroll conversation, PgDn returns to live"],
  ["Ctrl+B", "collapse / expand the sidebar"],
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
          <Text bold>{keys}</Text>
          <Text dimColor> — {what}</Text>
        </Text>
      ))}
    </Box>
  );
}
