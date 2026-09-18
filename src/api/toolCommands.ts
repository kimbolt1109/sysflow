import { createInterface } from "node:readline";
import type { FlowApp } from "@/app";
import { checkPermission } from "@/domain/permissions";
import type { PermissionMode, PermissionRule } from "@/domain/permissions";
import { TOOL_DESCRIPTIONS, type ToolName } from "@/domain/toolDefs";

export type ConfirmVerdict = "allow" | "deny" | "edit";

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
  editable = false,
): Promise<ConfirmVerdict> {
  const hook = await app.hooks.fire("PreToolUse", {
    session_id: sessionId,
    tool_name: tool,
    tool_input: target,
  });
  if (hook.decision === "block") {
    process.stdout.write(`hook blocked ${tool}: ${hook.reason}\n`);
    app.sessions.append(sessionId, { type: "tool-blocked", tool, reason: hook.reason });
    return "deny";
  }
  const decision = checkPermission(mode, rules, tool, target);
  if (decision === "deny") {
    process.stdout.write(`denied by permission rules.\n`);
    app.sessions.append(sessionId, { type: "tool-blocked", tool });
    return "deny";
  }
  if (decision === "ask") {
    const hint = editable ? "[y/a(always)/e(edit)/n]" : "[y/a(always)/n]";
    const answer = await ask(rl, `allow ${tool} ${JSON.stringify(target)}? ${hint} `);
    if (answer === "a") {
      app.savePermissionRule({ tool, pattern, decision: "allow" });
      process.stdout.write("allowed always (saved to .flow/settings.local.json).\n");
      return "allow";
    }
    if (answer === "e" && editable) return "edit";
    if (answer !== "y") {
      process.stdout.write("blocked.\n");
      app.sessions.append(sessionId, { type: "tool-blocked", tool });
      return "deny";
    }
  }
  return "allow";
}

async function postTool(
  app: FlowApp,
  sessionId: string,
  tool: string,
  output: string,
): Promise<void> {
  await app.hooks.fire("PostToolUse", {
    session_id: sessionId,
    tool_name: tool,
    output: output.slice(0, 2000),
  });
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
  if ((await confirmTool(app, rl, sessionId, mode, rules, tool, target, arg)) !== "allow") {
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
  await postTool(app, sessionId, tool, result.output);
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
  editor?: string,
): Promise<"exit" | "continue"> {
  if (mode === "plan") {
    process.stdout.write("plan mode: writes are disabled (read-only).\n");
    return "continue";
  }
  const parts = arg.split(/\s+/).filter((p) => p !== "");
  if (cmd === "bash" && arg !== "") {
    const target = { command: arg };
    if (
      (await confirmTool(
        app,
        rl,
        sessionId,
        mode,
        rules,
        "Bash",
        target,
        alwaysAllowPattern("Bash", arg),
      )) !== "allow"
    ) {
      return "continue";
    }
    const result = await app.tools.bash(arg);
    process.stdout.write(`${result.output === "" ? "(no output)" : result.output}\n`);
    app.sessions.append(sessionId, { type: "tool", tool: cmd, ok: result.ok });
    await postTool(app, sessionId, "Bash", result.output);
    return "continue";
  }
  if ((cmd === "write" || cmd === "edit") && parts.length >= 2) {
    const [path, ...contentParts] = parts as [string, ...string[]];
    const tool = toolLabel(cmd as ToolName);
    let newContent: string;
    if (cmd === "write") {
      newContent = contentParts.join(" ");
    } else {
      const joined = contentParts.join(" ");
      const sep = joined.indexOf(" :: ");
      if (sep < 0) {
        process.stdout.write("usage: /edit <path> <old> :: <new>\n");
        return "continue";
      }
      newContent = joined.slice(sep + 4);
    }
    const verdict = await confirmTool(
      app,
      rl,
      sessionId,
      mode,
      rules,
      tool,
      { path },
      path ?? "",
      true,
    );
    if (verdict === "deny") return "continue";
    if (verdict === "edit") {
      if (editor === undefined) {
        process.stdout.write("no editor configured.\n");
        return "continue";
      }
      try {
        newContent = app.editTempContent(newContent, editor);
      } catch (err) {
        process.stdout.write(`edit aborted: ${err instanceof Error ? err.message : String(err)}\n`);
        return "continue";
      }
    }
    try {
      await app.takeCheckpoint(sessionId, `before ${cmd} ${path ?? ""}`);
    } catch {
      // checkpoints are best-effort and never block execution
    }
    if (cmd === "write") {
      const result = await app.tools.write(path ?? "", newContent);
      process.stdout.write(`${result.output}\n`);
      app.sessions.append(sessionId, { type: "tool", tool: cmd, ok: result.ok });
      await postTool(app, sessionId, tool, result.output);
      return "continue";
    }
    const content = contentParts.join(" ");
    const sep = content.indexOf(" :: ");
    const result = await app.tools.edit(path ?? "", content.slice(0, sep), newContent);
    process.stdout.write(`${result.output}\n`);
    app.sessions.append(sessionId, { type: "tool", tool: cmd, ok: result.ok });
    await postTool(app, sessionId, tool, result.output);
    return "continue";
  }
  process.stdout.write(
    cmd === "bash" ? "usage: /bash <command>\n" : `usage: /${cmd} <path> <content...>\n`,
  );
  return "continue";
}
