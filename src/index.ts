#!/usr/bin/env node
import { createApp, createDriverAgents, type FlowApp } from "@/app";
import { helpText, parseArgv, type CliArgs } from "@/api/cli";
import { CouncilSession } from "@/api/council";
import { runDoctor } from "@/api/doctor";
import { formatHeadless, runHeadless } from "@/api/headless";
import { startRepl } from "@/api/repl";
import { runSelector } from "@/api/selector";
import { loadConfig } from "@/config";
import { checkPermission } from "@/domain/permissions";
import { sessionPreview } from "@/domain/sessions";
import type { ToolCheck } from "@/infrastructure/agentLoop";
import { loadPermissionRules } from "@/infrastructure/permissionStore";
import { AppError } from "@/lib/errors";

const VERSION = "0.1.0";

function toolCheckFor(app: FlowApp, dangerouslySkip: boolean): ToolCheck {
  if (dangerouslySkip) return () => "allow";
  const rules = loadPermissionRules(app.config.dataDir, app.config.projectDir);
  return (tool: string, input: Record<string, unknown>) => {
    const decision = checkPermission("default", rules, tool, input);
    return decision === "deny" ? "deny" : "allow";
  };
}

function buildCouncil(
  app: FlowApp,
  args: CliArgs,
  modelIds: string[],
  mode: CouncilSession["mode"],
  lead?: string,
): CouncilSession | undefined {
  const ids = args.agents.length > 0 ? args.agents : modelIds;
  if (ids.length === 0) {
    if (args.mode !== undefined && args.mode !== "solo") {
      ids.push(app.config.defaultModel);
    } else {
      return undefined;
    }
  }
  const session = new CouncilSession(
    createDriverAgents(app, ids, toolCheckFor(app, args.dangerouslySkip)),
  );
  const wantMode = args.mode ?? mode;
  if (wantMode !== undefined) session.mode = wantMode;
  if (lead !== undefined) session.lead = lead;
  return session;
}

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
        process.stdout.write(`${id}  ${sessionPreview(app.sessions.load(id))}\n`);
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
        const council = buildCouncil(app, args, [], "council");
        const result = await runHeadless(
          app,
          args,
          (line) => process.stdout.write(`${line}\n`),
          council,
        );
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
    case "repl": {
      if (!process.stdin.isTTY) {
        process.stderr.write('no prompt given (use flow -p "task" for non-interactive mode)\n');
        return 2;
      }
      const needsPicker =
        args.model === undefined &&
        args.agents.length === 0 &&
        args.resume === undefined &&
        !args.continueLatest;
      let councilModels: string[] = [];
      let councilMode: CouncilSession["mode"] | undefined;
      let councilLead: string | undefined;
      if (needsPicker) {
        const selection = await runSelector(app);
        config.defaultModel = selection.models[0] ?? config.defaultModel;
        councilModels = selection.models;
        councilMode = selection.mode;
        councilLead = selection.lead;
      } else if (args.agents.length > 0) {
        config.defaultModel = args.agents[0] ?? config.defaultModel;
        councilModels = args.agents;
        if (args.mode !== undefined) councilMode = args.mode;
      }
      const council =
        councilModels.length > 1
          ? buildCouncil(app, args, councilModels, councilMode ?? "council", councilLead)
          : undefined;
      return startRepl(app, {
        resume: args.resume,
        continueLatest: args.continueLatest,
        permissionMode: args.permissionMode,
        dangerouslySkip: args.dangerouslySkip,
        agents: council === undefined ? undefined : council.agents,
        councilMode: council?.mode,
        councilLead: council?.lead,
      });
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
