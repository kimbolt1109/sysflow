import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { FlowApp } from "@/app";
import { helpText } from "@/api/cli";
import { runDoctor } from "@/api/doctor";
import type { ChatMessage } from "@/domain/models";
import { findCommand } from "@/domain/commands";
import { checkPermission, parseRule } from "@/domain/permissions";
import type { PermissionMode, PermissionRule } from "@/domain/permissions";
import { sessionPreview } from "@/domain/sessions";
import { TOOL_DESCRIPTIONS, type ToolName } from "@/domain/toolDefs";
import { loadPermissionRules, saveRule } from "@/infrastructure/permissionStore";

export interface ReplOptions {
  resume?: string;
  continueLatest: boolean;
  permissionMode?: PermissionMode;
  dangerouslySkip: boolean;
}

function toolLabel(name: ToolName): string {
  return name[0]?.toUpperCase() + name.slice(1);
}

function alwaysAllowPattern(tool: string, target: string): string {
  if (tool === "Bash") {
    const words = target.split(/\s+/).filter((w) => w !== "");
    const head = words.slice(0, 2).join(" ");
    return `${head === "" ? "*" : head}:*`;
  }
  return target === "" ? "*" : target;
}

export async function startRepl(app: FlowApp, opts: ReplOptions): Promise<number> {
  const mode: PermissionMode = opts.dangerouslySkip
    ? "bypassPermissions"
    : (opts.permissionMode ?? "default");
  const rules = loadPermissionRules(app.config.dataDir, app.config.projectDir);
  let sessionId = resolveSession(app, opts);
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
    if (input === "/resume" || input.startsWith("/resume ")) {
      sessionId = resumeInPlace(app, sessionId, history, input.slice("/resume".length).trim());
      rl.prompt();
      continue;
    }
    if (input.startsWith("/")) {
      const done = await runSlash(app, rl, sessionId, history, mode, rules, input);
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

function resumeInPlace(
  app: FlowApp,
  sessionId: string,
  history: ChatMessage[],
  arg: string,
): string {
  const ids = app.sessions.list();
  let target = arg;
  if (target === "") {
    const last = ids[ids.length - 1];
    if (last === undefined) {
      process.stdout.write("no sessions yet.\n");
      return sessionId;
    }
    target = last;
  }
  if (!ids.includes(target)) {
    process.stdout.write(`unknown session "${target}" — try /sessions\n`);
    return sessionId;
  }
  history.length = 0;
  history.push(...loadHistory(app, target));
  app.sessions.append(target, { type: "session-resumed" });
  process.stdout.write(`resumed ${target}: ${sessionPreview(app.sessions.load(target))}\n`);
  return target;
}

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => resolvePromise(answer.trim().toLowerCase()));
  });
}

async function confirmTool(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  mode: PermissionMode,
  rules: PermissionRule[],
  tool: string,
  target: Record<string, unknown>,
  pattern: string,
): Promise<boolean> {
  const decision = checkPermission(mode, rules, tool, target);
  if (decision === "deny") {
    process.stdout.write(`denied by permission rules.\n`);
    app.sessions.append(sessionId, { type: "tool-blocked", tool });
    return false;
  }
  if (decision === "ask") {
    const answer = await ask(rl, `allow ${tool} ${JSON.stringify(target)}? [y/a(always)/n] `);
    if (answer === "a") {
      const rule = { tool, pattern, decision: "allow" as const };
      saveRule(app.config.projectDir, rule);
      rules.push(rule);
      process.stdout.write("allowed always (saved to .flow/settings.local.json).\n");
      return true;
    }
    if (answer !== "y") {
      process.stdout.write("blocked.\n");
      app.sessions.append(sessionId, { type: "tool-blocked", tool });
      return false;
    }
  }
  return true;
}

async function runSlash(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  history: ChatMessage[],
  mode: PermissionMode,
  rules: PermissionRule[],
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
        `${helpText()}\n\nREPL: /clear /model /models /permissions /sessions /resume /doctor plus /read /write /edit /bash /glob /grep\n`,
      );
      return "continue";
    case "clear":
      history.length = 0;
      app.sessions.append(sessionId, { type: "clear" });
      process.stdout.write("cleared.\n");
      return "continue";
    case "model":
      process.stdout.write(
        `model: ${app.driver.id}${arg !== "" ? ` (switch with: flow --model ${arg})` : ""}\n`,
      );
      return "continue";
    case "models":
      for (const m of app.config.models) {
        process.stdout.write(
          `- ${m.id} (${m.contextWindow} ctx, $${m.inputPricePerM}/$${m.outputPricePerM} per 1M)\n`,
        );
      }
      return "continue";
    case "permissions": {
      if (arg === "") {
        process.stdout.write(`mode: ${mode}\n`);
        if (rules.length === 0) process.stdout.write("(no custom rules)\n");
        for (const r of rules) {
          process.stdout.write(`- ${r.decision} ${r.tool}(${r.pattern})\n`);
        }
        return "continue";
      }
      const [decision, ...ruleParts] = arg.split(/\s+/);
      if (decision !== "allow" && decision !== "deny" && decision !== "ask") {
        process.stdout.write("usage: /permissions [allow|deny|ask Tool(pattern)]\n");
        return "continue";
      }
      try {
        const rule = parseRule(ruleParts.join(" "), decision);
        saveRule(app.config.projectDir, rule);
        rules.push(rule);
        process.stdout.write(`saved ${decision} ${rule.tool}(${rule.pattern}).\n`);
      } catch (err) {
        process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return "continue";
    }
    case "sessions":
      for (const id of app.sessions.list()) {
        process.stdout.write(`${id}  ${sessionPreview(app.sessions.load(id))}\n`);
      }
      return "continue";
    case "doctor":
      runDoctor(app);
      return "continue";
    case "read":
    case "glob":
    case "grep":
      return runReadTool(app, rl, sessionId, mode, rules, cmd, arg);
    case "write":
    case "edit":
    case "bash":
      return runWriteTool(app, rl, sessionId, mode, rules, cmd, arg);
    default: {
      const known = findCommand(cmd ?? "");
      if (known !== undefined) {
        process.stdout.write(
          `/${known.name}: ${known.description} Lands in ${known.status.toUpperCase()}.\n`,
        );
      } else {
        process.stdout.write(`unknown command /${cmd ?? ""} — try /help\n`);
      }
      return "continue";
    }
  }
}

async function runReadTool(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  mode: PermissionMode,
  rules: PermissionRule[],
  cmd: string,
  arg: string,
): Promise<"exit" | "continue"> {
  if (arg === "") {
    process.stdout.write(`usage: /${cmd} <target>\n${TOOL_DESCRIPTIONS[cmd as ToolName]}\n`);
    return "continue";
  }
  const tool = toolLabel(cmd as ToolName);
  const target = { path: arg, command: arg };
  if (!(await confirmTool(app, rl, sessionId, mode, rules, tool, target, arg))) return "continue";
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
  rules: PermissionRule[],
  cmd: string,
  arg: string,
): Promise<"exit" | "continue"> {
  if (mode === "plan") {
    process.stdout.write("plan mode: writes are disabled (read-only).\n");
    return "continue";
  }
  const parts = arg.split(/\s+/).filter((p) => p !== "");
  if (cmd === "bash" && arg !== "") {
    const target = { command: arg };
    if (
      !(await confirmTool(
        app,
        rl,
        sessionId,
        mode,
        rules,
        "Bash",
        target,
        alwaysAllowPattern("Bash", arg),
      ))
    ) {
      return "continue";
    }
    const result = await app.tools.bash(arg);
    process.stdout.write(`${result.output === "" ? "(no output)" : result.output}\n`);
    app.sessions.append(sessionId, { type: "tool", tool: cmd, ok: result.ok });
    return "continue";
  }
  if ((cmd === "write" || cmd === "edit") && parts.length >= 2) {
    const [path, ...contentParts] = parts as [string, ...string[]];
    const tool = toolLabel(cmd as ToolName);
    if (!(await confirmTool(app, rl, sessionId, mode, rules, tool, { path }, path ?? ""))) {
      return "continue";
    }
    if (cmd === "write") {
      const result = await app.tools.write(path ?? "", contentParts.join(" "));
      process.stdout.write(`${result.output}\n`);
      app.sessions.append(sessionId, { type: "tool", tool: cmd, ok: result.ok });
      return "continue";
    }
    const content = contentParts.join(" ");
    const sep = content.indexOf(" :: ");
    if (sep < 0) {
      process.stdout.write("usage: /edit <path> <old> :: <new>\n");
      return "continue";
    }
    const result = await app.tools.edit(path ?? "", content.slice(0, sep), content.slice(sep + 4));
    process.stdout.write(`${result.output}\n`);
    app.sessions.append(sessionId, { type: "tool", tool: cmd, ok: result.ok });
    return "continue";
  }
  process.stdout.write(
    cmd === "bash" ? "usage: /bash <command>\n" : `usage: /${cmd} <path> <content...>\n`,
  );
  return "continue";
}
