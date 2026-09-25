import { describe, expect, it } from "vitest";
import { extractCliText, streamParserFor } from "@/infrastructure/cliOutput.js";

function run(dialect: string, stdout: string): { tokens: string[]; text: string; rest: object } {
  const parser = streamParserFor(dialect);
  const tokens = stdout.split("\n").flatMap((line) => parser.feed(line));
  const { text, ...rest } = parser.finish(stdout);
  return { tokens, text, rest };
}

// Trimmed from real `agy --output-format stream-json` output (agy 1.2.10).
const AGY_STREAM = [
  '{"event":"init","conversation_id":"5a64","init":{"cwd":"C:\\\\x","tools":["view_file","run_command"],"permission_mode":"request-review"}}',
  '{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}',
  '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Let me check."}}',
  '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool"}}',
  '{"event":"step_update","step_update":{"step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"1\\n2\\n"}}',
  '{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"3\\n"}}',
  '{"event":"result","result":{"conversation_id":"5a64","status":"SUCCESS","response":"1\\n2\\n3\\n","num_turns":1,"usage":{"input_tokens":17945,"output_tokens":110,"thinking_tokens":101,"cache_read_tokens":0,"total_tokens":18055}}}',
].join("\n");

// Trimmed from real `claude -p --output-format stream-json --verbose` output.
const CLAUDE_STREAM = [
  '{"type":"system","subtype":"hook_response","hook_name":"SessionStart:startup","output":"No session to restore\\n","stdout":"No session to restore\\n","exit_code":0}',
  '{"type":"system","subtype":"init","cwd":"C:\\\\x","session_id":"dfaf","tools":["Bash","Edit"],"slash_commands":["doctor","color","focus"],"output_style":"default"}',
  '{"type":"assistant","message":{"model":"claude-opus-5-5","role":"assistant","content":[{"type":"text","text":"PONG"}]},"session_id":"dfaf"}',
  '{"type":"result","subtype":"success","is_error":false,"result":"PONG","session_id":"dfaf","total_cost_usd":0.27,"usage":{"input_tokens":2,"cache_creation_input_tokens":33974,"cache_read_input_tokens":13801,"output_tokens":5}}',
].join("\n");

// Trimmed from real `opencode run --format json` output.
const OPENCODE_STREAM = [
  '{"type":"step_start","sessionID":"ses_f","part":{"type":"step-start"}}',
  '{"type":"text","sessionID":"ses_f","part":{"type":"text","text":"PONG"}}',
  '{"type":"step_finish","sessionID":"ses_f","part":{"type":"step-finish","reason":"stop","tokens":{"total":22721,"input":16564,"output":4,"reasoning":9,"cache":{"write":0,"read":6144}},"cost":0}}',
].join("\n");

const GROK_JSON = [
  "{",
  '  "text": "PONG",',
  '  "stopReason": "end_turn",',
  '  "thought": "The user wants PONG.",',
  '  "usage": { "input_tokens": 58493, "output_tokens": 31 }',
  "}",
].join("\n");

describe("cliOutput", () => {
  it("streams agy text deltas and separates response steps", () => {
    const { tokens, text, rest } = run("agy", AGY_STREAM);

    expect(tokens.join("")).toBe("Let me check.\n\n1\n2\n3\n");
    expect(text).toBe("1\n2\n3");
    expect(rest).toEqual({ usage: { input: 17945, output: 110 } });
  });

  it("surfaces agy turn errors even when the process exits 0", () => {
    const failed =
      '{"event":"result","result":{"status":"ERROR","response":"","error":"stream input message is missing the \\"event\\" field","usage":{"input_tokens":0,"output_tokens":0}}}';

    expect(run("agy", failed).rest).toMatchObject({ error: expect.stringContaining("event") });
  });

  it("reads agy's single-document json output too", () => {
    const doc =
      '{"conversation_id":"48dc","status":"SUCCESS","response":"PONG\\n","usage":{"input_tokens":17938,"output_tokens":62}}';

    expect(run("agy", doc).text).toBe("PONG");
  });

  it("returns claude's answer once, without init metadata", () => {
    const { tokens, text, rest } = run("claude", CLAUDE_STREAM);

    expect(text).toBe("PONG");
    expect(tokens).toEqual(["PONG"]);
    expect(rest).toEqual({ usage: { input: 47777, output: 5 } });
  });

  it("flags claude results marked is_error", () => {
    const failed = '{"type":"result","subtype":"error_max_turns","is_error":true}';

    expect(run("claude", failed).rest).toMatchObject({ error: "error_max_turns" });
  });

  it("streams opencode text parts and totals step tokens", () => {
    const { tokens, text, rest } = run("opencode", OPENCODE_STREAM);

    expect(tokens).toEqual(["PONG"]);
    expect(text).toBe("PONG");
    expect(rest).toEqual({ usage: { input: 22708, output: 4 } });
  });

  it("keeps the last opencode step as the answer", () => {
    const stdout = [
      '{"type":"step_start","part":{}}',
      '{"type":"text","part":{"type":"text","text":"Let me look."}}',
      '{"type":"step_start","part":{}}',
      '{"type":"text","part":{"type":"text","text":"Final answer."}}',
    ].join("\n");

    expect(run("opencode", stdout).text).toBe("Final answer.");
  });

  it("reads grok's pretty-printed json without leaking its thoughts", () => {
    const { text, rest } = run("grok", GROK_JSON);

    expect(text).toBe("PONG");
    expect(rest).toEqual({ usage: { input: 58493, output: 31 } });
  });

  it("falls back to generic extraction for unknown CLIs", () => {
    const { tokens, text } = run("codex", '{"type":"assistant","text":"hi there"}\n');

    expect(tokens).toEqual(["hi there"]);
    expect(text).toBe("hi there");
    expect(extractCliText("just an answer\n")).toBe("just an answer");
  });
});
