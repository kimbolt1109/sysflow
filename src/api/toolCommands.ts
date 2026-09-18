import { createInterface } from "node:readline";
import type { FlowApp } from "@/app";
import { checkPermission } from "@/domain/permissions";
import type { PermissionMode, PermissionRule } from "@/domain/permissions";
import { TOOL_DESCRIPTIONS, type ToolName } from "@/domain/toolDefs";

export function toolLabel(name: ToolName): string {
  return name[0]?.toUpperCase() + name.slice(1);
}

export function alwaysAllowPattern(tool: string, target: string): string {
  if (tool === "Bash") {
    const words = target.split(/\s+/).filter((w) => w !== "");
    const head = words.slice(0, 2).join(" ");
    return `${head === "" ? "*" : head}:*`;
  }
  return target === "" ? "*" : target;
}

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => resolvePromise(answer.trim().toLowerCase()));
  });
}

export async function confirmTool(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  mode: PermissionMode,
  rules: PermissionRule[],
  tool: string,
  target: Record<string, unknown>,
  pattern: string,
): Promise<boolean> {
  const hook = await app.hooks.fire("PreToolUse", {
    session_id: sessionId,
    tool_name: tool,
    tool_input: target,
  });
  if (hook.decision === "block") {
    process.stdout.write(`hook blocked ${tool}: ${hook.reason}\n`);
    app.sessions.append(sessionId, { type: "tool-blocked", tool, reason: hook.reason });
    return false;
  }
  const decision = checkPermission(mode, rules, tool, target);
  if (decision === "deny") {
    process.stdout.write(`denied by permission rules.\n`);
    app.sessions.append(sessionId, { type: "tool-blocked", tool });
    return false;
  }
  if (decision === "ask") {
    const answer = await ask(rl, `allow ${tool} ${JSON.stringify(target)}? [y/a(always)/n] `);
    if (answer === "a") {
      app.savePermissionRule({ tool, pattern, decision: "allow" });
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

export async function runReadTool(
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
  await app.hooks.fire("PostToolUse", {
    session_id: sessionId,
    tool_name: tool,
    output: result.output.slice(0, 2000),
  });
  return "continue";
}

export async function runWriteTool(
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
    await app.hooks.fire("PostToolUse", {
      session_id: sessionId,
      tool_name: "Bash",
      output: result.output.slice(0, 2000),
    });
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
      await app.hooks.fire("PostToolUse", {
        session_id: sessionId,
        tool_name: tool,
        output: result.output.slice(0, 2000),
      });
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
    await app.hooks.fire("PostToolUse", {
      session_id: sessionId,
      tool_name: tool,
      output: result.output.slice(0, 2000),
    });
    return "continue";
  }
  process.stdout.write(
    cmd === "bash" ? "usage: /bash <command>\n" : `usage: /${cmd} <path> <content...>\n`,
  );
  return "continue";
}
