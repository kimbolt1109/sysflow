import type { TokenUsage } from "@/domain/models.js";

export interface CliOutcome {
  text: string;
  /** real token counts when the CLI reports them */
  usage?: TokenUsage;
  /** the CLI reported a failed turn (its exit code may still be 0) */
  error?: string;
}

/** Incremental parser for one CLI run: `feed` gets each complete stdout line and
 * returns text to stream now; `finish` gets the whole stdout after exit. */
export interface CliStreamParser {
  feed(line: string): string[];
  finish(stdout: string): CliOutcome;
}

const TEXT_KEYS = new Set(["text", "delta", "result", "output_text", "response"]);
const SKIP_KEYS = new Set([
  "prompt",
  "command",
  "input",
  "query",
  "cwd",
  "tools",
  "slash_commands",
  "skills",
  "agents",
  "plugins",
  "mcp_servers",
  "model",
  "session_id",
  "uuid",
]);

function collectText(value: unknown, skipKey = ""): string[] {
  if (typeof value === "string") {
    return TEXT_KEYS.has(skipKey) || skipKey === "" ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v) => collectText(v));
  if (typeof value === "object" && value !== null) {
    const out: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof entry === "string" && TEXT_KEYS.has(key)) out.push(entry);
      else if (typeof entry === "object") out.push(...collectText(entry, key));
    }
    return out;
  }
  return [];
}

/** Best-effort text from unknown CLI output: JSON documents (one per line or pretty-printed)
 * contribute their text-like fields; anything else passes through as plain lines. */
export function extractCliText(stdout: string): string {
  const parts: string[] = [];
  let pending: string[] = [];
  const flushDoc = (): void => {
    if (pending.length === 0) return;
    const doc = pending.join("\n");
    pending = [];
    try {
      parts.push(...collectText(JSON.parse(doc) as unknown));
    } catch {
      for (const line of doc.split("\n")) {
        const trimmed = line.trim();
        if (trimmed !== "") parts.push(trimmed);
      }
    }
  };
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (pending.length > 0 || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      pending.push(line);
      if (pending.length > 200) {
        flushDoc();
        continue;
      }
      try {
        parts.push(...collectText(JSON.parse(pending.join("\n")) as unknown));
        pending = [];
      } catch {
        // keep accumulating: multi-line JSON document
      }
      continue;
    }
    parts.push(trimmed);
  }
  flushDoc();
  const text = parts
    .filter((p) => p !== "")
    .join("\n")
    .slice(0, 32000);
  return text === "" ? stdout.slice(0, 32000) : text;
}

type Json = Record<string, unknown>;

function parseLine(line: string): Json | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return record(JSON.parse(trimmed) as unknown);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** agy --output-format stream-json: `step_update` events carry `text_delta` for
 * agent_response steps; the closing `result` event has the answer, usage, and status. */
function agyParser(): CliStreamParser {
  let lastStep: unknown;
  let streamed = "";
  let result: Json | undefined;
  return {
    feed(line) {
      const event = parseLine(line);
      if (event === undefined) return [];
      if (event.event === "result") {
        result = record(event.result);
        return [];
      }
      const step = record(event.step_update);
      if (event.event !== "step_update" || step === undefined) return [];
      const delta = str(step.text_delta);
      if (step.step_type !== "agent_response" || delta === undefined || delta === "") return [];
      const out: string[] = [];
      if (streamed !== "" && lastStep !== undefined && step.step_index !== lastStep) {
        out.push("\n\n");
      }
      lastStep = step.step_index;
      out.push(delta);
      streamed += out.join("");
      return out;
    },
    finish(stdout) {
      const doc = result ?? parseLine(stdout);
      if (doc === undefined) return { text: streamed !== "" ? streamed : extractCliText(stdout) };
      const usage = record(doc.usage);
      const outcome: CliOutcome = {
        text: (str(doc.response) ?? streamed).trim(),
        ...(usage !== undefined
          ? { usage: { input: num(usage.input_tokens), output: num(usage.output_tokens) } }
          : {}),
      };
      if (doc.status === "ERROR") outcome.error = str(doc.error) ?? "agy reported an error";
      return outcome;
    },
  };
}

/** claude -p --output-format stream-json --verbose: whole `assistant` messages stream as
 * they finish; the `result` event holds the final answer and usage. */
function claudeParser(): CliStreamParser {
  let streamed = "";
  let result: Json | undefined;
  return {
    feed(line) {
      const event = parseLine(line);
      if (event === undefined) return [];
      if (event.type === "result") {
        result = event;
        return [];
      }
      if (event.type !== "assistant") return [];
      const content = record(event.message)?.content;
      if (!Array.isArray(content)) return [];
      const text = content
        .map((block) => record(block))
        .filter((block) => block?.type === "text")
        .map((block) => str(block?.text) ?? "")
        .join("");
      if (text === "") return [];
      const out = streamed === "" ? [text] : ["\n\n", text];
      streamed += out.join("");
      return out;
    },
    finish(stdout) {
      if (result === undefined)
        return { text: streamed !== "" ? streamed : extractCliText(stdout) };
      const usage = record(result.usage);
      const outcome: CliOutcome = {
        text: (str(result.result) ?? streamed).trim(),
        ...(usage !== undefined
          ? {
              usage: {
                input:
                  num(usage.input_tokens) +
                  num(usage.cache_creation_input_tokens) +
                  num(usage.cache_read_input_tokens),
                output: num(usage.output_tokens),
              },
            }
          : {}),
      };
      if (result.is_error === true) {
        outcome.error = str(result.result) ?? str(result.subtype) ?? "claude reported an error";
      }
      return outcome;
    },
  };
}

/** opencode run --format json: `text` parts stream per step; `step_finish` reports tokens.
 * The answer is the text of the last step that produced any. */
function opencodeParser(): CliStreamParser {
  let streamed = "";
  let stepText = "";
  let lastText = "";
  let input = 0;
  let output = 0;
  let sawTokens = false;
  let error: string | undefined;
  return {
    feed(line) {
      const event = parseLine(line);
      if (event === undefined) return [];
      const part = record(event.part);
      if (event.type === "step_start") {
        if (stepText !== "") lastText = stepText;
        stepText = "";
        return [];
      }
      if (event.type === "step_finish") {
        const tokens = record(part?.tokens);
        if (tokens !== undefined) {
          sawTokens = true;
          input += num(tokens.input) + num(record(tokens.cache)?.read);
          output += num(tokens.output);
        }
        return [];
      }
      if (event.type === "error") {
        const detail = record(event.error);
        error =
          str(record(detail?.data)?.message) ?? str(detail?.message) ?? JSON.stringify(event.error);
        return [];
      }
      const text = event.type === "text" ? str(part?.text) : undefined;
      if (text === undefined || text === "") return [];
      const out = streamed === "" ? [text] : ["\n\n", text];
      streamed += out.join("");
      stepText = stepText === "" ? text : `${stepText}\n\n${text}`;
      return out;
    },
    finish(stdout) {
      const final = stepText !== "" ? stepText : lastText;
      const outcome: CliOutcome = {
        text: (final !== "" ? final : extractCliText(stdout)).trim(),
        ...(sawTokens ? { usage: { input, output } } : {}),
      };
      if (error !== undefined) outcome.error = error;
      return outcome;
    },
  };
}

/** grok -p --output-format json: one pretty-printed document after the run ends. */
function grokParser(): CliStreamParser {
  return {
    feed: () => [],
    finish(stdout) {
      let doc: Json | undefined;
      try {
        doc = record(JSON.parse(stdout.trim()) as unknown);
      } catch {
        doc = undefined;
      }
      const text = str(doc?.text);
      if (doc === undefined || text === undefined) return { text: extractCliText(stdout) };
      const usage = record(doc.usage);
      return {
        text: text.trim(),
        ...(usage !== undefined
          ? { usage: { input: num(usage.input_tokens), output: num(usage.output_tokens) } }
          : {}),
      };
    },
  };
}

function genericParser(): CliStreamParser {
  return {
    feed(line) {
      const event = parseLine(line);
      return event === undefined ? [] : collectText(event);
    },
    finish: (stdout) => ({ text: extractCliText(stdout) }),
  };
}

export function streamParserFor(dialect: string): CliStreamParser {
  switch (dialect) {
    case "agy":
      return agyParser();
    case "claude":
      return claudeParser();
    case "opencode":
      return opencodeParser();
    case "grok":
      return grokParser();
    default:
      return genericParser();
  }
}
