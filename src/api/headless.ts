import { randomUUID } from "node:crypto";
import type { FlowApp } from "@/app";
import type { CliArgs } from "@/api/cli";
import type { CouncilSession } from "@/api/council";
import type { ChatMessage } from "@/domain/models";

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

  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  app.sessions.append(sessionId, { type: "headless-start", prompt, model });

  if (args.outputFormat === "stream-json") {
    const result = await app.driver.streamMessage(messages, (token) => {
      emit(JSON.stringify({ type: "token", delta: token }));
    });
    app.sessions.append(sessionId, {
      type: "headless-end",
      text: result.text,
      usage: result.usage,
    });
    await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
    await app.hooks.fire("Stop", { session_id: sessionId });
    return finish(result.text, result.usage.input, result.usage.output);
  }
  const result = await app.driver.sendMessage(messages);
  app.sessions.append(sessionId, { type: "headless-end", text: result.text, usage: result.usage });
  await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
  await app.hooks.fire("Stop", { session_id: sessionId });
  return finish(result.text, result.usage.input, result.usage.output);
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
