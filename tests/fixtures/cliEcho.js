// Fake external CLI for CliDriver tests. Usage:
//   node cliEcho.js <format>   (reads PROMPT from argv or stdin, prints canned output)
// Formats: jsonl (one {"text"} per line), raw (plain text), fail (exit 3), slow (sleep),
// agy / agy-error (agy stream-json over stdin, echoing argv into the answer).
"use strict";

const format = process.argv[2] || "jsonl";

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

async function main() {
  if (format === "slow") {
    await new Promise((resolve) => setTimeout(resolve, 30000));
    return;
  }
  if (format === "fail") {
    process.stderr.write("boom\n");
    process.exitCode = 3;
    return;
  }
  if (format === "agy" || format === "agy-error") {
    // agy stream-json protocol: one {"event":"user"} envelope per stdin line.
    const envelope = JSON.parse((await readStdin()).trim().split("\n")[0] || "{}");
    const prompt = (envelope.message && envelope.message.content) || "none";
    const args = process.argv.slice(3).join(" ");
    const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
    emit({ event: "init", conversation_id: "c1", init: { tools: ["view_file"] } });
    if (format === "agy-error") {
      emit({
        event: "result",
        result: { status: "ERROR", response: "", error: "quota exhausted" },
      });
      return;
    }
    const answer = `answer to ${prompt} | args: ${args}`;
    const half = Math.floor(answer.length / 2);
    for (const delta of [answer.slice(0, half), answer.slice(half)]) {
      emit({
        event: "step_update",
        step_update: { step_index: 1, step_type: "agent_response", text_delta: delta },
      });
    }
    emit({
      event: "result",
      result: {
        status: "SUCCESS",
        response: answer,
        usage: { input_tokens: 42, output_tokens: 7 },
      },
    });
    return;
  }
  const promptFlag = process.argv.indexOf("-p");
  const messageFlag = process.argv.indexOf("--message");
  const execIndex = process.argv.indexOf("exec");
  const runIndex = process.argv.indexOf("run");
  let prompt = "none";
  if (promptFlag >= 0 && process.argv[promptFlag + 1]) prompt = process.argv[promptFlag + 1];
  else if (messageFlag >= 0 && process.argv[messageFlag + 1])
    prompt = process.argv[messageFlag + 1];
  else if (execIndex >= 0 && process.argv[execIndex + 1]) prompt = process.argv[execIndex + 1];
  else if (runIndex >= 0 && process.argv[runIndex + 1]) prompt = process.argv[runIndex + 1];
  else {
    prompt = (await readStdin()).trim() || "none";
  }
  if (format === "raw") {
    process.stdout.write(`answer to ${prompt}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ type: "assistant", text: `answer to ${prompt}` })}\n`);
}

if (process.argv.includes("--version")) {
  process.stdout.write("cliEcho 0.0.1\n");
} else {
  main();
}
