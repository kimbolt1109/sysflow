import { randomUUID } from "node:crypto";
import type { FlowApp } from "@/app";
import type { CliArgs } from "@/api/cli";
import type { ChatMessage } from "@/domain/models";

export interface HeadlessResult {
  text: string;
  model: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
}

export async function runHeadless(
  app: FlowApp,
  args: CliArgs,
  emit: (line: string) => void = () => {},
): Promise<HeadlessResult> {
  const prompt = args.prompt ?? "";
  if (prompt.trim() === "") throw new Error('headless mode needs -p "task"');
  const model = args.model ?? app.config.defaultModel;
  const sessionId = randomUUID();
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
    return {
      text: result.text,
      model,
      sessionId,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
    };
  }
  const result = await app.driver.sendMessage(messages);
  app.sessions.append(sessionId, { type: "headless-end", text: result.text, usage: result.usage });
  return {
    text: result.text,
    model,
    sessionId,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
  };
}

export function formatHeadless(result: HeadlessResult, args: CliArgs): string {
  if (args.outputFormat === "json" || args.outputFormat === "stream-json") {
    return JSON.stringify({
      result: result.text,
      model: result.model,
      session_id: result.sessionId,
      usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
    });
  }
  return result.text;
}
