#!/usr/bin/env node
import { createApp } from "@/app";
import type { FlowApp } from "@/app";
import { helpText, parseArgv } from "@/api/cli";
import { formatHeadless, runHeadless } from "@/api/headless";
import { startRepl } from "@/api/repl";
import { loadConfig } from "@/config";
import { AppError } from "@/lib/errors";

const VERSION = "0.1.0";

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  if (args.command === "help") {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (args.command === "version") {
    process.stdout.write(`flow ${VERSION}\n`);
    return 0;
  }

  const config = loadConfig();
  if (args.outputFormat !== "text") {
    config.logLevel = "error";
  }
  if (args.model !== undefined) {
    config.defaultModel = args.model;
  }
  const app = createApp(config);

  switch (args.command) {
    case "models":
      for (const m of app.config.models) {
        process.stdout.write(
          `${m.id} | ctx ${m.contextWindow} | $${m.inputPricePerM}/$${m.outputPricePerM} per 1M | ${m.tags.join(",")}\n`,
        );
      }
      return 0;
    case "sessions":
      for (const id of app.sessions.list()) {
        process.stdout.write(`${id}\n`);
      }
      return 0;
    case "doctor":
      return runDoctor(app);
    case "mcp":
    case "config":
    case "update":
      process.stdout.write(
        `${args.command} management lands in M5/M7 — see docs/ARCHITECTURE.md\n`,
      );
      return 0;
    case "headless": {
      try {
        const result = await runHeadless(app, args, (line) => process.stdout.write(`${line}\n`));
        process.stdout.write(`${formatHeadless(result, args)}\n`);
        return 0;
      } catch (err) {
        if (err instanceof AppError) {
          process.stderr.write(`error: ${err.message}\n`);
          return 1;
        }
        process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case "repl":
      if (!process.stdin.isTTY) {
        process.stderr.write('no prompt given (use flow -p "task" for non-interactive mode)\n');
        return 2;
      }
      return startRepl(app, {
        resume: args.resume,
        continueLatest: args.continueLatest,
        permissionMode: args.permissionMode,
        dangerouslySkip: args.dangerouslySkip,
      });
  }
}

function runDoctor(app: FlowApp): number {
  process.stdout.write(`ok    node: ${process.version}\n`);
  process.stdout.write(`ok    storage: ${app.sessions.dir()}\n`);
  process.stdout.write(
    app.config.auth.anthropic !== undefined
      ? "ok    anthropic-auth: key present\n"
      : "warn  anthropic-auth: no APP_ANTHROPIC_API_KEY (mock driver)\n",
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
