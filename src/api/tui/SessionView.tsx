import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { phaseLine } from "@/api/council.js";
import {
  capTranscript,
  sanitizeTranscriptText,
  sliceByRows,
  transcriptRowCounts,
} from "@/domain/transcript.js";
import { DOVE_ART, DOVE_BLUE, doveGreeting } from "@/api/tui/dove.js";
import { MarkdownText } from "@/api/tui/MarkdownText.js";
import { isFailedToolSummary } from "@/api/tui/toolLines.js";

export interface TranscriptLine {
  key: number;
  /** "tool" text is "<name> <target>\n<result summary>" */
  role: "user" | "assistant" | "tool" | "info" | "diff" | "error";
  text: string;
  /** epoch ms, kept for exports */
  at?: number;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const PHASE = /^[─—―]+\s*(.+?)\s*[─—―]+\s*(?:\[(.*?)\]\s*)?(.*)$/;

interface FoldGroup {
  key: number;
  phase: string;
  verb: string;
  agents: string[];
  details: Array<[string, string]>;
}

function splitMessage(message: string): { verb: string; detail: string } {
  const sep = message.indexOf(": ");
  return sep < 0
    ? { verb: message, detail: "" }
    : { verb: message.slice(0, sep), detail: message.slice(sep + 2) };
}

/** Folds consecutive council events that share a phase and verb into one entry:
 * "PLANNING drafted an approach — a, b", with each agent's preview underneath. */
export function foldInfoLines(lines: TranscriptLine[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let group: FoldGroup | undefined;
  const flush = (): void => {
    if (group === undefined) return;
    const who = group.agents.length > 0 ? ` — ${summarizeAgents(group.agents)}` : "";
    const details = group.details
      .filter(([, d]) => d !== "")
      .slice(0, 6)
      .map(([agent, d]) => `  ${agent}: ${clip(d, 140)}`);
    out.push({
      key: group.key,
      role: "info",
      text: [`${phaseLine(group.phase)} ${group.verb}${who}`, ...details].join("\n"),
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
    const [, rawPhase = "", rawAgent = "", message = ""] = match;
    const phase = rawPhase.trim();
    const agent = rawAgent.trim();
    const { verb, detail } = splitMessage(message.trim());
    if (agent === "") {
      flush();
      out.push(line);
      continue;
    }
    if (group !== undefined && group.phase === phase && group.verb === verb) {
      if (!group.agents.includes(agent)) group.agents.push(agent);
      group.details.push([agent, detail]);
      continue;
    }
    flush();
    group = { key: line.key, phase, verb, agents: [agent], details: [[agent, detail]] };
  }
  flush();
  return out;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function summarizeAgents(agents: string[]): string {
  if (agents.length <= 6) return agents.join(", ");
  return `${agents.slice(0, 6).join(", ")} +${agents.length - 6} more`;
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
  /** case-insensitive substring highlighted in the transcript */
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

function Greeting(): ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {DOVE_ART.map((line, i) => (
        <Text key={i} color={DOVE_BLUE}>
          {line}
        </Text>
      ))}
      <Text bold>{doveGreeting()}</Text>
      <Text dimColor>Type a task and press Enter · / for commands · PgUp scrolls back</Text>
    </Box>
  );
}

function ToolLine({ text, spaced }: { text: string; spaced: boolean }): ReactElement {
  const [label = "", ...rest] = text.split("\n");
  const space = label.indexOf(" ");
  const name = space < 0 ? label : label.slice(0, space);
  const target = space < 0 ? "" : label.slice(space);
  const summary = rest.join(" ").trim();
  const failed = isFailedToolSummary(summary);
  return (
    <Box flexDirection="column" marginTop={spaced ? 1 : 0}>
      <Text wrap="truncate-end">
        <Text color={failed ? "red" : "magenta"}>⏺ </Text>
        <Text bold>{name}</Text>
        {target}
      </Text>
      {summary !== "" && (
        <Text color={failed ? "red" : undefined} dimColor={!failed} wrap="truncate-end">
          {"  ⎿ "}
          {summary}
        </Text>
      )}
    </Box>
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
  const conversing = clean.some((l) => l.role === "user" || l.role === "assistant");

  return (
    <Box flexDirection="column">
      {!conversing && <Greeting />}
      {dropped > 0 && (
        <Text dimColor>
          … {dropped} earlier {dropped === 1 ? "entry" : "entries"} trimmed
        </Text>
      )}
      {view.hiddenAboveRows > 0 && (
        <Text dimColor>
          ▲ ~{view.hiddenAboveRows} lines earlier · PgUp scrolls · PgDn jumps to live
        </Text>
      )}
      {visible.map((line, i) => {
        if (line.role === "user")
          return (
            <Box key={line.key} marginTop={1}>
              <Text bold color="cyan">
                {"❯ "}
              </Text>
              <Text bold wrap="wrap">
                <Highlighted text={line.text} needle={highlight} />
              </Text>
            </Box>
          );
        if (line.role === "assistant")
          return (
            <Box key={line.key} marginTop={1}>
              <Text color="green">{"◆ "}</Text>
              <Box flexDirection="column" flexGrow={1}>
                <MarkdownText text={line.text} highlight={highlight} />
              </Box>
            </Box>
          );
        if (line.role === "tool")
          return (
            <ToolLine key={line.key} text={line.text} spaced={visible[i - 1]?.role === "user"} />
          );
        if (line.role === "info")
          return (
            <Text key={line.key} dimColor wrap="wrap">
              {"· "}
              <Highlighted text={line.text} needle={highlight} />
            </Text>
          );
        if (line.role === "error")
          return (
            <Text key={line.key} bold color="red" wrap="wrap">
              {"✖ "}
              <Highlighted text={line.text} needle={highlight} />
            </Text>
          );
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
      })}
      {!view.follow && (
        <Text dimColor>▼ scrolled · PgDn returns to live (~{view.hiddenBelowRows} below)</Text>
      )}
    </Box>
  );
}
