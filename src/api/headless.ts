import { randomUUID } from "node:crypto";
import type { FlowApp } from "@/app.js";
import type { CliArgs } from "@/api/cli.js";
import type { CouncilSession } from "@/api/council.js";
import { formatMcpInventory } from "@/domain/mcp.js";
import { runToolLoop, TOOL_SYSTEM, type ToolCheck } from "@/infrastructure/agentLoop.js";
import { fetchPageText } from "@/lib/webfetch.js";
import { openBrowser } from "@/lib/browser.js";

export interface HeadlessResult {
  text: string;
  model: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface HeadlessOptions {
  notify?: boolean;
  /** past council lessons from the composition root ("" / undefined when none) */
  lessons?: string;
  /** permission gate; defaults to allow (ask-gated calls deny without an asker) */
  check?: ToolCheck;
}

export async function runHeadless(
  app: FlowApp,
  args: CliArgs,
  emit: (line: string) => void = () => {},
  council?: CouncilSession,
  opts: HeadlessOptions = {},
): Promise<HeadlessResult> {
  const prompt = args.prompt ?? "";
  if (prompt.trim() === "") throw new Error('headless mode needs -p "task"');
  const model = args.model ?? app.config.defaultModel;
  const sessionId = randomUUID();
  await app.hooks.fire("SessionStart", { session_id: sessionId, model, headless: true });
  const submitted = await app.hooks.fire("UserPromptSubmit", { session_id: sessionId, prompt });
  if (submitted.decision === "block") {
    throw new Error(`prompt blocked: ${submitted.reason}`);
  }
  const finish = (text: string, input: number, output: number): HeadlessResult => {
    const base = model.split(" (")[0] ?? model;
    const used = app.recordUsage(base.split("/")[0] ?? "unknown", base, input, output);
    if (args.maxCost !== undefined && args.maxCost > 0 && used.cost > args.maxCost) {
      throw new Error(
        `cost $${used.cost.toFixed(4)} exceeded --max-cost $${args.maxCost} (task output kept in ${sessionId})`,
      );
    }
    if (used.level !== "ok") {
      process.stderr.write(`[quota] daily spend $${used.dailyCost.toFixed(2)} (${used.level})\n`);
    }
    if (opts.notify === true) {
      app.notifyUser("Flow task complete", text.slice(0, 120));
    }
    return { text, model, sessionId, inputTokens: input, outputTokens: output, cost: used.cost };
  };

  if (council !== undefined) {
    app.sessions.append(sessionId, { type: "headless-start", prompt, model, mode: council.mode });
    try {
      await app.takeCheckpoint(sessionId, "before council execution");
    } catch {
      // checkpoints are best-effort
    }
    const run = await council.run(prompt, emit);
    for (const record of run.sessionRecords) app.sessions.append(sessionId, record);
    await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
    await app.hooks.fire("Stop", { session_id: sessionId });
    return finish(run.text, app.driver.countTokens(prompt), app.driver.countTokens(run.text));
  }

  const lessons = opts.lessons ?? "";
  const soloCheck = opts.check ?? (() => "allow" as const);
  const loop = await runToolLoop(app.driver, app.tools, TOOL_SYSTEM, prompt, {
    seed: lessons === "" ? [] : [{ role: "system", content: lessons }],
    maxTurns: 12,
    check: soloCheck,
    hooks: {
      before: (name, toolInput) =>
        app.hooks.fire("PreToolUse", { tool_name: name, tool_input: toolInput }),
      after: (name, toolInput, output) =>
        app.hooks
          .fire("PostToolUse", {
            tool_name: name,
            tool_input: toolInput,
            output: output.slice(0, 2000),
          })
          .then(() => undefined),
    },
    onSkill: (name) => {
      const skill = app.skills.find((s) => s.name === name);
      if (skill?.disableModelInvocation === true) return undefined;
      return app.skillBody(name);
    },
    onWebfetch: (url) => fetchPageText(url),
    onBrowse: (url) => openBrowser(url),
    onListMcpTools: async () => formatMcpInventory(await app.mcp.toolInventory()),
    onMcpTool: (toolName, args) => app.mcp.call(toolName, args),
  });
  const text = loop.answer;
  const usage = loop.usage;
  app.sessions.append(sessionId, { type: "headless-start", prompt, model });

  if (args.outputFormat === "stream-json") {
    emit(JSON.stringify({ type: "token", delta: text }));
    app.sessions.append(sessionId, { type: "headless-end", text, usage });
    await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
    await app.hooks.fire("Stop", { session_id: sessionId });
    return finish(text, usage.input, usage.output);
  }
  app.sessions.append(sessionId, { type: "headless-end", text, usage });
  await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
  await app.hooks.fire("Stop", { session_id: sessionId });
  return finish(text, usage.input, usage.output);
}

export function formatHeadless(result: HeadlessResult, args: CliArgs): string {
  if (args.outputFormat === "json" || args.outputFormat === "stream-json") {
    return JSON.stringify({
      result: result.text,
      model: result.model,
      session_id: result.sessionId,
      usage: {
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: result.cost,
      },
    });
  }
  return result.text;
}
