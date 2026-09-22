#!/usr/bin/env node
import {
  createApp,
  createDriverAgents,
  createDriverFor,
  recallLessons,
  type FlowApp,
} from "@/app.js";
import { helpText, parseArgv, type CliArgs } from "@/api/cli.js";
import { describeConfig } from "@/api/configView.js";
import { CouncilSession } from "@/api/council.js";
import { runDoctor } from "@/api/doctor.js";
import { formatHeadless, runHeadless } from "@/api/headless.js";
import { startRepl } from "@/api/repl.js";
import { loadLastSelection, runSelector } from "@/api/selector.js";
import { selectTheme } from "@/api/theming.js";
import { startTui } from "@/api/tui.js";
import { loadConfig } from "@/config.js";
import { checkPermission } from "@/domain/permissions.js";
import type { PermissionMode } from "@/domain/permissions.js";
import { matchRouting } from "@/domain/routing.js";
import { sessionPreview } from "@/domain/sessions.js";
import type { ThinkingLevel } from "@/domain/thinking.js";
import type { ToolCheck } from "@/infrastructure/agentLoop.js";
import { findOnPath, passthrough } from "@/infrastructure/cliDrivers.js";
import { removeMcpServer, saveMcpServer } from "@/infrastructure/mcpClients.js";
import { loadPermissionRules } from "@/infrastructure/permissionStore.js";
import { userSettingsPath, writeUserDefaultModel } from "@/infrastructure/userSettings.js";
import { AppError } from "@/lib/errors.js";

const VERSION = "0.1.0";

function toolCheckFor(
  app: FlowApp,
  dangerouslySkip: boolean,
  getMode: () => PermissionMode = () => "default",
): ToolCheck {
  if (dangerouslySkip) return () => "allow";
  const rules = loadPermissionRules(app.config.dataDir, app.config.projectDir);
  return (tool: string, input: Record<string, unknown>) => {
    return checkPermission(getMode(), rules, tool, input);
  };
}

function buildCouncil(
  app: FlowApp,
  args: CliArgs,
  modelIds: string[],
  mode: CouncilSession["mode"],
  lead?: string,
  thinking: ThinkingLevel = "medium",
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
    createDriverAgents(app, ids, toolCheckFor(app, args.dangerouslySkip), thinking),
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
    case "models": {
      const force = args.rest.includes("--refresh");
      const models = force ? await app.refreshModels(true) : app.models;
      for (const m of models) {
        process.stdout.write(
          `${m.id} | ctx ${m.contextWindow} | $${m.inputPricePerM}/$${m.outputPricePerM} per 1M | ${m.tags.join(",")}${m.source === undefined ? "" : ` | via ${m.source}`}\n`,
        );
      }
      return 0;
    }
    case "sessions":
      for (const id of app.sessions.list()) {
        process.stdout.write(`${id}  ${sessionPreview(app.sessions.load(id))}\n`);
      }
      return 0;
    case "doctor":
      return runDoctor(app);
    case "mcp":
      return cmdMcp(app, args.rest);
    case "config":
      return cmdConfig(app, args.rest);
    case "update":
      process.stdout.write("flow updates via npm (M8 publishes flow-ai-cli)\n");
      return 0;
    case "tui": {
      if (!process.stdin.isTTY) {
        process.stderr.write("tui needs an interactive terminal\n");
        return 2;
      }
      const permission: { current: PermissionMode } = {
        current: args.permissionMode ?? "default",
      };
      return startTui(app, {
        notify: args.notify,
        yolo: args.dangerouslySkip,
        permission,
        lessons: recallLessons(app.sessions, 5),
        createAgents: (ids, level) =>
          createDriverAgents(
            app,
            ids,
            toolCheckFor(app, args.dangerouslySkip, () => permission.current),
            level,
          ),
        createDriver: (id) => createDriverFor(app.config, id, undefined, app.models),
      });
    }
    case "headless": {
      try {
        const council = buildCouncil(app, args, [], "council");
        if (council !== undefined) {
          const detected = selectTheme({
            themeName: config.uiTheme,
            color: !config.noColor,
            truecolor: config.truecolor,
          });
          council.theme = detected.theme;
          council.color = detected.color;
        }
        const result = await runHeadless(
          app,
          args,
          (line) => process.stdout.write(`${line}\n`),
          council,
          {
            notify: args.notify,
            lessons: recallLessons(app.sessions, 5),
            check: toolCheckFor(app, args.dangerouslySkip),
          },
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
      let thinking: ThinkingLevel = "medium";
      if (needsPicker) {
        const selection = await runSelector(app);
        config.defaultModel = selection.models[0] ?? config.defaultModel;
        councilModels = selection.models;
        councilMode = selection.mode;
        councilLead = selection.lead;
        thinking = selection.thinking;
      } else if (args.agents.length > 0) {
        config.defaultModel = args.agents[0] ?? config.defaultModel;
        councilModels = args.agents;
        if (args.mode !== undefined) councilMode = args.mode;
        thinking = loadLastSelection(app)?.thinking ?? "medium";
      }
      const council =
        councilModels.length > 1
          ? buildCouncil(app, args, councilModels, councilMode ?? "council", councilLead, thinking)
          : undefined;
      if (council === undefined) {
        const exit = await maybePassthrough(config.defaultModel, app, args.passthrough);
        if (exit !== undefined) return exit;
      }
      const detected = selectTheme({
        themeName: config.uiTheme,
        color: !config.noColor,
        truecolor: config.truecolor,
      });
      return startRepl(app, {
        resume: args.resume,
        continueLatest: args.continueLatest,
        permissionMode: args.permissionMode,
        dangerouslySkip: args.dangerouslySkip,
        agents: council === undefined ? undefined : council.agents,
        councilMode: council?.mode,
        councilLead: council?.lead,
        thinking,
        editor: config.editor,
        theme: detected.theme,
        color: detected.color,
        notify: args.notify,
        lessons: recallLessons(app.sessions, 5),
      });
    }
  }
}

async function cmdMcp(app: FlowApp, rest: string[]): Promise<number> {
  const [sub, ...more] = rest;
  if (sub === "list" || sub === undefined) {
    if (app.mcp.servers.length === 0) {
      process.stdout.write("no MCP servers (add one in ~/.flow/mcp.json or .flow/mcp.json)\n");
      return 0;
    }
    const inventory = await app.mcp.toolInventory();
    process.stdout.write(`servers: ${app.mcp.servers.join(", ")}\n`);
    for (const tool of inventory) {
      process.stdout.write(`- ${tool.namespaced}: ${tool.description}\n`);
    }
    return 0;
  }
  if (sub === "add" && more.length >= 3 && more[0] === "stdio") {
    const [, name, , ...cmd] = more as [string, string, string, ...string[]];
    const command = cmd[0];
    if (name === undefined || command === undefined) {
      process.stderr.write("usage: flow mcp add stdio <name> -- <command> [args...]\n");
      return 2;
    }
    saveMcpServer(app.config.dataDir, { name, transport: "stdio", command, args: cmd.slice(1) });
    process.stdout.write(`added mcp server ${name}\n`);
    return 0;
  }
  if (sub === "add" && more.length === 3 && (more[0] === "http" || more[0] === "sse")) {
    const [transport, name, url] = more as [string, string, string];
    saveMcpServer(app.config.dataDir, {
      name,
      transport: transport as "http" | "sse",
      url,
    });
    process.stdout.write(`added mcp server ${name}\n`);
    return 0;
  }
  if (sub === "remove" && more.length === 1) {
    const removed = removeMcpServer(app.config.dataDir, more[0] as string);
    process.stdout.write(removed ? `removed ${more[0]}\n` : `no such server: ${more[0]}\n`);
    return removed ? 0 : 1;
  }
  process.stderr.write(
    "usage: flow mcp [list|add stdio <name> -- <cmd>|add http|sse <name> <url>|remove <name>]\n",
  );
  return 2;
}

async function cmdConfig(app: FlowApp, rest: string[]): Promise<number> {
  const [sub, key, ...more] = rest;
  if (sub === "get" || sub === undefined) {
    process.stdout.write(`${describeConfig(app, key)}\n`);
    return 0;
  }
  if (sub === "set" && key === "defaultModel" && more.length === 1) {
    writeUserDefaultModel(app.config.dataDir, more[0] as string);
    process.stdout.write(`defaultModel=${more[0]}\n`);
    return 0;
  }
  if (sub === "edit") {
    app.editPath(userSettingsPath(app.config.dataDir), app.config.editor);
    return 0;
  }
  process.stderr.write("usage: flow config [get [key]|set defaultModel <id>|edit]\n");
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });

async function askYesNo(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolvePromise) => {
      rl.question(question, (value) => resolvePromise(value.trim().toLowerCase()));
    });
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function maybePassthrough(
  modelId: string,
  app: FlowApp,
  forced: boolean,
): Promise<number | undefined> {
  const rule = matchRouting(app.config.routing, modelId);
  if (rule.driver !== "cli" || rule.command === undefined) return undefined;
  if (findOnPath(rule.command) === undefined) return undefined;
  const cmdLine = [rule.command, ...(rule.args ?? [])].join(" ");
  const go = forced || (await askYesNo(`passthrough to \`${cmdLine}\` (interactive)? [y/N] `));
  if (!go) return undefined;
  process.stdout.write(`launching ${cmdLine} …\n`);
  return passthrough(rule.command, rule.args ?? []);
}
