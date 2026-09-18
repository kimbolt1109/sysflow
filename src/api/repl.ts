import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { FlowApp } from "@/app";
import { helpText } from "@/api/cli";
import type { ChatMessage } from "@/domain/models";
import { checkPermission } from "@/domain/permissions";
import type { PermissionMode } from "@/domain/permissions";
import { TOOL_DESCRIPTIONS, type ToolName } from "@/domain/toolDefs";

export interface ReplOptions {
  resume?: string;
  continueLatest: boolean;
  permissionMode?: PermissionMode;
  dangerouslySkip: boolean;
}

function toolLabel(name: ToolName): string {
  return name[0]?.toUpperCase() + name.slice(1);
}

export async function startRepl(app: FlowApp, opts: ReplOptions): Promise<number> {
  const mode: PermissionMode = opts.dangerouslySkip
    ? "bypassPermissions"
    : (opts.permissionMode ?? "default");
  const sessionId = resolveSession(app, opts);
  const history: ChatMessage[] = loadHistory(app, sessionId);
  app.sessions.append(sessionId, { type: "session-start", mode, model: app.driver.id });

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "flow> " });
  let generating = false;
  let stopCurrent = false;
  let lastSigint = 0;
  rl.on("SIGINT", () => {
    if (generating) {
      stopCurrent = true;
      return;
    }
    const now = Date.now();
    if (now - lastSigint < 800) {
      rl.close();
    } else {
      lastSigint = now;
      process.stdout.write("\n(ctrl+c again to exit)\n");
      rl.prompt();
    }
  });

  process.stdout.write(
    `flow · ${app.driver.id} · session ${sessionId.slice(0, 8)} · /help for commands\n`,
  );
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (input === "") {
      rl.prompt();
      continue;
    }
    if (input.startsWith("/")) {
      const done = await runSlash(app, rl, sessionId, history, mode, input);
      if (done === "exit") {
        rl.close();
        return 0;
      }
      rl.prompt();
      continue;
    }
    generating = true;
    stopCurrent = false;
    history.push({ role: "user", content: input });
    app.sessions.append(sessionId, { type: "user", text: input });
    try {
      let text = "";
      await app.driver.streamMessage(history, (token) => {
        if (stopCurrent) return;
        text += token;
        process.stdout.write(token);
      });
      process.stdout.write("\n");
      if (stopCurrent) {
        app.sessions.append(sessionId, { type: "interrupted" });
      } else {
        history.push({ role: "assistant", content: text });
        app.sessions.append(sessionId, { type: "assistant", text });
      }
    } catch (err) {
      process.stdout.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`);
      app.sessions.append(sessionId, { type: "error", message: String(err) });
    }
    generating = false;
    rl.prompt();
  }
  return 0;
}

function resolveSession(app: FlowApp, opts: ReplOptions): string {
  if (opts.resume !== undefined) {
    if (opts.resume === "latest") {
      const ids = app.sessions.list();
      const last = ids[ids.length - 1];
      if (last !== undefined) return last;
    } else {
      return opts.resume;
    }
  }
  if (opts.continueLatest) {
    const ids = app.sessions.list();
    const last = ids[ids.length - 1];
    if (last !== undefined) return last;
  }
  return randomUUID();
}

function loadHistory(app: FlowApp, sessionId: string): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (const record of app.sessions.load(sessionId)) {
    if (typeof record !== "object" || record === null) continue;
    const r = record as Record<string, unknown>;
    if ((r.type === "user" || r.type === "assistant") && typeof r.text === "string") {
      history.push({ role: r.type, content: r.text });
    }
  }
  return history;
}

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => resolvePromise(answer.trim().toLowerCase()));
  });
}

async function runSlash(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  history: ChatMessage[],
  mode: PermissionMode,
  input: string,
): Promise<"exit" | "continue"> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd) {
    case "exit":
    case "quit":
      return "exit";
    case "help":
      process.stdout.write(
        `${helpText()}\n\nREPL: /clear /model [id] /models plus /read /write /edit /bash /glob /grep\n`,
      );
      return "continue";
    case "clear":
      history.length = 0;
      app.sessions.append(sessionId, { type: "clear" });
      process.stdout.write("cleared.\n");
      return "continue";
    case "model":
      process.stdout.write(
        `model: ${app.driver.id}${arg !== "" ? ` (switch to "${arg}" needs restart: flow --model ${arg})` : ""}\n`,
      );
      return "continue";
    case "models":
      for (const m of app.config.models) {
        process.stdout.write(
          `- ${m.id} (${m.contextWindow} ctx, $${m.inputPricePerM}/$${m.outputPricePerM} per 1M)\n`,
        );
      }
      return "continue";
    case "read":
    case "glob":
    case "grep":
      return runReadTool(app, rl, sessionId, mode, cmd, arg);
    case "write":
    case "edit":
    case "bash":
      return runWriteTool(app, rl, sessionId, mode, cmd, arg);
    default:
      process.stdout.write(`unknown command /${cmd ?? ""} — try /help\n`);
      return "continue";
  }
}

async function runReadTool(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  mode: PermissionMode,
  cmd: string,
  arg: string,
): Promise<"exit" | "continue"> {
  if (arg === "") {
    process.stdout.write(`usage: /${cmd} <target>\n${TOOL_DESCRIPTIONS[cmd as ToolName]}\n`);
    return "continue";
  }
  const tool = toolLabel(cmd as ToolName);
  const decision = checkPermission(mode, [], tool, { path: arg, command: arg });
  if (decision === "ask" && (await ask(rl, `allow ${tool}(${arg})? [y/n] `)) !== "y") {
    process.stdout.write("blocked.\n");
    return "continue";
  }
  const result =
    cmd === "read"
      ? await app.tools.read(arg)
      : cmd === "glob"
        ? await app.tools.glob(arg)
        : await app.tools.grep(arg);
  process.stdout.write(`${result.output === "" ? "(no output)" : result.output}\n`);
  app.sessions.append(sessionId, { type: "tool", tool: cmd, arg, ok: result.ok });
  return "continue";
}

async function runWriteTool(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  mode: PermissionMode,
  cmd: string,
  arg: string,
): Promise<"exit" | "continue"> {
  const parts = arg.split(/\s+/).filter((p) => p !== "");
  if (cmd === "bash" && arg !== "") {
    return confirmAndRun(app, rl, sessionId, mode, "Bash", { command: arg }, () =>
      app.tools.bash(arg),
    );
  }
  if ((cmd === "write" || cmd === "edit") && parts.length >= 2) {
    const [path, ...contentParts] = parts as [string, ...string[]];
    const content = contentParts.join(" ");
    if (cmd === "write") {
      return confirmAndRun(app, rl, sessionId, mode, "Write", { path }, () =>
        app.tools.write(path ?? "", content),
      );
    }
    const sep = content.indexOf(" :: ");
    if (sep < 0) {
      process.stdout.write("usage: /edit <path> <old> :: <new>\n");
      return "continue";
    }
    const oldString = content.slice(0, sep);
    const newString = content.slice(sep + 4);
    return confirmAndRun(app, rl, sessionId, mode, "Edit", { path }, () =>
      app.tools.edit(path ?? "", oldString, newString),
    );
  }
  process.stdout.write(
    cmd === "bash" ? "usage: /bash <command>\n" : `usage: /${cmd} <path> <content...>\n`,
  );
  return "continue";
}

async function confirmAndRun(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  mode: PermissionMode,
  tool: string,
  target: Record<string, unknown>,
  run: () => Promise<{ ok: boolean; output: string }>,
): Promise<"exit" | "continue"> {
  const decision = checkPermission(mode, [], tool, target);
  if (decision === "ask") {
    const answer = await ask(rl, `allow ${tool} ${JSON.stringify(target)}? [y/n] `);
    if (answer !== "y") {
      process.stdout.write("blocked.\n");
      app.sessions.append(sessionId, { type: "tool-blocked", tool });
      return "continue";
    }
  }
  if (mode === "plan") {
    process.stdout.write("plan mode: writes are disabled, showing the diff only.\n");
    return "continue";
  }
  const result = await run();
  process.stdout.write(`${result.output === "" ? "(no output)" : result.output}\n`);
  app.sessions.append(sessionId, { type: "tool", tool, ok: result.ok });
  return "continue";
}
