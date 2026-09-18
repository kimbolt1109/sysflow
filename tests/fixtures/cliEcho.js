// Fake external CLI for CliDriver tests. Usage:
//   node cliEcho.js <format>   (reads PROMPT from argv or stdin, prints canned output)
// Formats: jsonl (one {"text"} per line), raw (plain text), fail (exit 3), slow (sleep).
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
