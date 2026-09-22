import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { FlowApp } from "@/app.js";
import { helpText } from "@/api/cli.js";
import { describeConfig } from "@/api/configView.js";
import { CouncilSession } from "@/api/council.js";
import { renderCost, renderStatus } from "@/api/costView.js";
import { runDoctor } from "@/api/doctor.js";
import { badgeWith, THEMES, type Theme } from "@/api/theming.js";
import type { ChatMessage, OrchestrationMode } from "@/domain/models.js";
import { thinkingDirective, type ThinkingLevel } from "@/domain/thinking.js";
import { findCommand, substituteArgs } from "@/domain/commands.js";
import { compactHistory } from "@/domain/compaction.js";
import { describeCheckpoint } from "@/domain/checkpoints.js";
import { findModel } from "@/domain/modelRegistry.js";
import type { Orchestrant } from "@/domain/orchestrator.js";
import { checkPermission, parseRule } from "@/domain/permissions.js";
import type { PermissionMode, PermissionRule } from "@/domain/permissions.js";
import { formatMcpInventory } from "@/domain/mcp.js";
import { sessionPreview } from "@/domain/sessions.js";
import { skillListing } from "@/domain/skills.js";
import { subagentListing } from "@/domain/subagents.js";
import { buildContextUsage, renderContextBars } from "@/domain/tokenizer.js";
import { formatElapsed } from "@/domain/transcript.js";
import { confirmTool, runReadTool, runWriteTool } from "@/api/toolCommands.js";
import { runToolLoop, TOOL_SYSTEM } from "@/infrastructure/agentLoop.js";
import { fetchPageText } from "@/lib/webfetch.js";
import { openBrowser } from "@/lib/browser.js";
import { answerQuestions } from "@/infrastructure/layaClient.js";
import { formatDecisions, screenPrompt, triageQuestions } from "@/domain/decide.js";
import type { DecisionQuestion } from "@/domain/decide.js";

export interface ReplOptions {
  resume?: string;
  continueLatest: boolean;
  permissionMode?: PermissionMode;
  dangerouslySkip: boolean;
  agents?: Orchestrant[];
  councilMode?: OrchestrationMode;
  councilLead?: string;
  thinking?: ThinkingLevel;
  editor?: string;
  theme?: Theme;
  color?: boolean;
  notify?: boolean;
  /** past council lessons from the composition root ("" / undefined when none) */
  lessons?: string;
}

export async function startRepl(app: FlowApp, opts: ReplOptions): Promise<number> {
  const mode: PermissionMode = opts.dangerouslySkip
    ? "bypassPermissions"
    : (opts.permissionMode ?? "default");
  const rules = app.rules;
  let sessionId = resolveSession(app, opts);
  const history: ChatMessage[] = loadHistory(app, sessionId);
  if (opts.thinking !== undefined) {
    const lessons = opts.lessons ?? "";
    history.push({
      role: "system",
      content: thinkingDirective(opts.thinking) + (lessons === "" ? "" : `\n\n${lessons}`),
    });
  }
  const costs = { session: 0 };
  let theme = opts.theme ?? (THEMES[0] as Theme);
  const color = opts.color ?? true;
  const notify = opts.notify ?? true;
  const council =
    opts.agents !== undefined && opts.agents.length > 0
      ? new CouncilSession(opts.agents, (record) => app.sessions.append(sessionId, record))
      : undefined;
  if (council !== undefined) {
    if (opts.councilMode !== undefined) council.mode = opts.councilMode;
    if (opts.councilLead !== undefined) council.lead = opts.councilLead;
    council.theme = theme;
    council.color = color;
  }
  app.sessions.append(sessionId, { type: "session-start", mode, model: app.driver.id });

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "sys> " });
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
    `sys · ${app.driver.id} · session ${sessionId.slice(0, 8)} · /help for commands\n`,
  );
  if (opts.dangerouslySkip) {
    process.stdout.write("YOLO: dangerously skipping permissions — every tool auto-approved.\n");
  }
  if (council !== undefined) {
    process.stdout.write(
      `council: ${council.names().join(", ")} · mode=${council.mode} · Esc interjects, @agent DMs\n`,
    );
  }
  if (app.legacyImport !== undefined && !app.importOffered()) {
    process.stdout.write(`found ${app.legacyImport} — run /init to import it into .flow/FLOW.md\n`);
    app.markImportOffered();
  }
  await app.hooks.fire("SessionStart", { session_id: sessionId, model: app.driver.id });
  const pendingQuestions: Array<{
    question: string;
    options: string[];
    resolve: (answer: string) => void;
  }> = [];
  app.askUser = (question, options) => {
    app.notifyUser("Sys needs your input", question.slice(0, 120));
    return new Promise<string>((resolve) => {
      pendingQuestions.push({ question, options, resolve });
      process.stdout.write(
        `\n[agent question] ${question}\n${options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}${options.length > 0 ? "\n" : ""}(reply with the number or text)\n`,
      );
      rl.prompt();
    });
  };
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (input === "") {
      rl.prompt();
      continue;
    }
    const pending = pendingQuestions.shift();
    if (pending !== undefined) {
      const n = Number(input);
      pending.resolve(
        pending.options.length > 0 && Number.isInteger(n) && n >= 1 && n <= pending.options.length
          ? (pending.options[n - 1] as string)
          : input,
      );
      rl.prompt();
      continue;
    }
    if (input === "/resume" || input.startsWith("/resume ")) {
      sessionId = resumeInPlace(app, sessionId, history, input.slice("/resume".length).trim());
      rl.prompt();
      continue;
    }
    if (input === "/theme" || input.startsWith("/theme ")) {
      const name = input.slice("/theme".length).trim();
      if (name === "") {
        process.stdout.write(
          `themes: ${THEMES.map((t) => t.name).join(", ")} (current: ${theme.name})\n`,
        );
      } else {
        const next = THEMES.find((t) => t.name === name);
        if (next === undefined) {
          process.stdout.write(`unknown theme "${name}"\n`);
        } else {
          theme = next;
          if (council !== undefined) council.theme = next;
          process.stdout.write(`theme: ${next.name} ${badgeWith(next, color, "agent", 0)}\n`);
        }
      }
      rl.prompt();
      continue;
    }
    if (input === "/cost") {
      process.stdout.write(`${renderCost(costs.session, app.dailyUsage())}\n`);
      rl.prompt();
      continue;
    }
    if (input.startsWith("/")) {
      const done = await runSlash(
        app,
        rl,
        sessionId,
        history,
        mode,
        rules,
        council,
        input,
        opts,
        costs,
      );
      if (done === "exit") {
        rl.close();
        await app.hooks.fire("SessionEnd", { session_id: sessionId });
        await app.hooks.fire("Stop", { session_id: sessionId });
        return 0;
      }
      if (typeof done === "object") {
        sessionId = done.switchSession;
      }
      rl.prompt();
      continue;
    }
    if (council !== undefined) {
      await runCouncilTurn(app, council, sessionId, history, costs, notify, input);
      rl.prompt();
      continue;
    }
    const submitted = await app.hooks.fire("UserPromptSubmit", {
      session_id: sessionId,
      prompt: input,
    });
    if (submitted.decision === "block") {
      process.stdout.write(`blocked: ${submitted.reason}\n`);
      rl.prompt();
      continue;
    }
    generating = true;
    stopCurrent = false;
    const turnStart = Date.now();
    const screen = screenPrompt(input);
    if (screen.risky) {
      process.stdout.write(
        `[guard: this prompt trips ${screen.notes.join("; ")} — continuing; tell me to stop if I'm wrong]\n`,
      );
    }
    history.push({ role: "user", content: input });
    app.sessions.append(sessionId, { type: "user", text: input });
    try {
      let text = "";
      const loop = await runToolLoop(app.driver, app.tools, TOOL_SYSTEM, input, {
        seed: history.slice(0, -1),
        emit: (token) => {
          if (stopCurrent) return;
          text += token;
          process.stdout.write(token);
        },
        ...soloLoopOpts(app, mode, rules),
      });
      text = loop.answer;
      process.stdout.write("\n");
      if (stopCurrent) {
        app.sessions.append(sessionId, { type: "interrupted" });
      } else {
        process.stdout.write(`[took ${formatElapsed(Date.now() - turnStart)}]\n`);
        history.push({ role: "assistant", content: text });
        app.sessions.append(sessionId, { type: "assistant", text });
        const base = app.driver.id.split(" (")[0] ?? app.driver.id;
        const used = app.recordUsage(
          base.split("/")[0] ?? "unknown",
          base,
          historyTokens(input),
          historyTokens(text),
        );
        costs.session += used.cost;
        if (notify) app.notifyUser("Sys task complete", text.slice(0, 120));
        if (used.level !== "ok" && notify) {
          app.notifyUser("Sys budget", `daily spend $${used.dailyCost.toFixed(2)} (${used.level})`);
        }
      }
      if (await maybeCompact(app, sessionId, history)) {
        process.stdout.write(
          `[auto-compact at ${Math.round(app.config.compactThreshold * 100)}%: transcript summarized, recent window kept]\n`,
        );
      }
    } catch (err) {
      process.stdout.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`);
      app.sessions.append(sessionId, { type: "error", message: String(err) });
    }
    generating = false;
    rl.prompt();
  }
  await app.hooks.fire("SessionEnd", { session_id: sessionId });
  await app.hooks.fire("Stop", { session_id: sessionId });
  return 0;
}

async function runCouncilTurn(
  app: FlowApp,
  council: CouncilSession,
  sessionId: string,
  history: ChatMessage[],
  costs: { session: number },
  notify: boolean,
  input: string,
): Promise<void> {
  const dm = input.match(/^@(\S+)\s+([\s\S]+)$/);
  const task = dm !== null ? `[direct message for ${dm[1]}] ${dm[2]}` : input;
  const submitted = await app.hooks.fire("UserPromptSubmit", {
    session_id: sessionId,
    prompt: task,
  });
  if (submitted.decision === "block") {
    process.stdout.write(`blocked: ${submitted.reason}\n`);
    return;
  }
  history.push({ role: "user", content: input });
  app.sessions.append(sessionId, { type: "user", text: input });
  const turnStart = Date.now();
  const screen = screenPrompt(task);
  if (screen.risky) {
    process.stdout.write(
      `[guard: this prompt trips ${screen.notes.join("; ")} — continuing; tell me to stop if I'm wrong]\n`,
    );
  }
  try {
    try {
      const checkpoint = await app.takeCheckpoint(sessionId, "before council execution");
      app.sessions.append(sessionId, {
        type: "checkpoint",
        id: checkpoint.id,
        label: checkpoint.label,
      });
    } catch {
      // checkpoints are best-effort and never block execution
    }
    const run = await council.run(task, (line) => process.stdout.write(`${line}\n`));
    process.stdout.write(`${run.text}\n[took ${formatElapsed(Date.now() - turnStart)}]\n`);
    history.push({ role: "assistant", content: run.text });
    app.sessions.append(sessionId, { type: "assistant", text: run.text });
    const used = app.recordUsage("council", "", historyTokens(task), historyTokens(run.text));
    costs.session += used.cost;
    if (notify) app.notifyUser("Sys task complete", run.text.slice(0, 120));
    await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
    if (await maybeCompact(app, sessionId, history)) {
      process.stdout.write("[auto-compact: transcript summarized, recent window kept]\n");
    }
  } catch (err) {
    process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    app.sessions.append(sessionId, { type: "error", message: String(err) });
  }
}

async function runApproveTurn(
  app: FlowApp,
  council: CouncilSession,
  sessionId: string,
  history: ChatMessage[],
  costs: { session: number },
  notify: boolean,
): Promise<void> {
  try {
    const run = await council.approve((line) => process.stdout.write(`${line}\n`));
    if (run === undefined) {
      process.stdout.write("no pending plan — send a task first with /plan on.\n");
      return;
    }
    process.stdout.write(`${run.text}\n`);
    history.push({ role: "assistant", content: run.text });
    app.sessions.append(sessionId, { type: "assistant", text: run.text });
    const used = app.recordUsage("council", "", historyTokens("/approve"), historyTokens(run.text));
    costs.session += used.cost;
    if (notify) app.notifyUser("Sys task complete", run.text.slice(0, 120));
    await app.hooks.fire("Notification", { session_id: sessionId, kind: "task-complete" });
  } catch (err) {
    process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    app.sessions.append(sessionId, { type: "error", message: String(err) });
  }
}

function historyTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Shared tool-loop wiring for every solo turn: same checks, skills, web, MCP. */
function soloLoopOpts(app: FlowApp, mode: PermissionMode, rules: PermissionRule[]) {
  return {
    maxTurns: 12,
    check: (tool: string, toolInput: Record<string, unknown>) =>
      checkPermission(mode, rules, tool, toolInput),
    hooks: {
      before: (name: string, toolInput: Record<string, unknown>) =>
        app.hooks.fire("PreToolUse", { tool_name: name, tool_input: toolInput }),
      after: (name: string, toolInput: Record<string, unknown>, output: string) =>
        app.hooks
          .fire("PostToolUse", {
            tool_name: name,
            tool_input: toolInput,
            output: output.slice(0, 2000),
          })
          .then(() => undefined),
    },
    onSkill: (name: string) => {
      const skill = app.skills.find((s) => s.name === name);
      if (skill?.disableModelInvocation === true) return undefined;
      return app.skillBody(name);
    },
    onQuestion: app.askUser,
    onWebfetch: (url: string) => fetchPageText(url),
    onBrowse: (url: string) => openBrowser(url),
    onDecide: async (state: string, questions: Record<string, DecisionQuestion>) =>
      formatDecisions((await answerQuestions(app.config.layaUrl, state, questions)).answers),
    onListMcpTools: async () => formatMcpInventory(await app.mcp.toolInventory()),
    onMcpTool: (toolName: string, args: unknown) => app.mcp.call(toolName, args),
  };
}

function contextWindowOf(app: FlowApp): number {
  const base = app.driver.id.split(" (")[0] ?? app.driver.id;
  return findModel(app.config.models, base)?.contextWindow ?? 200000;
}

function usageOf(app: FlowApp, history: ChatMessage[]) {
  return buildContextUsage(
    { system: "", tools: "", memory: "", skills: "", mcp: "", messages: history },
    contextWindowOf(app),
  );
}

async function maybeCompact(
  app: FlowApp,
  sessionId: string,
  history: ChatMessage[],
): Promise<boolean> {
  const result = compactHistory(history, contextWindowOf(app), app.config.compactThreshold);
  if (!result.compacted) return false;
  const pre = await app.hooks.fire("PreCompact", {
    session_id: sessionId,
    summary: result.summary,
  });
  if (pre.decision === "block") {
    process.stdout.write(`compact skipped: ${pre.reason}\n`);
    return false;
  }
  history.length = 0;
  history.push(...result.history);
  app.sessions.append(sessionId, { type: "compact", summary: result.summary });
  return true;
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

async function runSlash(
  app: FlowApp,
  rl: ReturnType<typeof createInterface>,
  sessionId: string,
  history: ChatMessage[],
  mode: PermissionMode,
  rules: PermissionRule[],
  council: CouncilSession | undefined,
  input: string,
  opts: ReplOptions,
  costs: { session: number },
): Promise<"exit" | "continue" | { switchSession: string }> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd) {
    case "exit":
    case "quit":
      return "exit";
    case "help":
      process.stdout.write(
        `${helpText()}\n\nREPL: /clear /context /compact [focus] /model /models /permissions /sessions /resume /doctor /skills /triage /memory /init /mcp /agents /plan /approve /config /review /add-dir plus /read /write /edit /bash /glob /grep\n`,
      );
      return "continue";
    case "context": {
      const usage = usageOf(app, history);
      process.stdout.write(
        `${renderContextBars(usage)}\n(each agent compacts independently; the blackboard persists)\n`,
      );
      return "continue";
    }
    case "compact": {
      const result = compactHistory(
        history,
        contextWindowOf(app),
        0,
        10,
        arg === "" ? undefined : arg,
      );
      history.length = 0;
      history.push(...result.history);
      app.sessions.append(sessionId, { type: "compact", manual: true, summary: result.summary });
      process.stdout.write("compacted: summary pinned, recent window kept.\n");
      return "continue";
    }
    case "clear":
      history.length = 0;
      app.sessions.append(sessionId, { type: "clear" });
      process.stdout.write("cleared.\n");
      return "continue";
    case "model":
      process.stdout.write(
        `model: ${app.driver.id}${arg !== "" ? ` (switch with: sys --model ${arg})` : ""}\n`,
      );
      return "continue";
    case "models":
      for (const m of app.models) {
        process.stdout.write(
          `- ${m.id} (${m.contextWindow} ctx, $${m.inputPricePerM}/$${m.outputPricePerM} per 1M${m.source === undefined ? "" : `, via ${m.source}`})\n`,
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
        app.savePermissionRule(rule);
        process.stdout.write(`saved ${decision} ${rule.tool}(${rule.pattern}).\n`);
      } catch (err) {
        process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return "continue";
    }
    case "skills":
      if (arg === "") {
        process.stdout.write(`${skillListing(app.skills)}\n`);
        return "continue";
      }
      {
        const body = app.skillBody(arg);
        if (body === undefined) {
          process.stdout.write(`unknown skill "${arg}"\n`);
          return "continue";
        }
        process.stdout.write(`${body}\n`);
      }
      return "continue";
    case "triage": {
      if (arg === "") {
        process.stdout.write(
          "usage: /triage <text> — route, urgency, refund, and churn in one pass\n",
        );
        return "continue";
      }
      const triaged = await answerQuestions(app.config.layaUrl, arg, triageQuestions());
      process.stdout.write(`triage (${triaged.source}):\n${formatDecisions(triaged.answers)}\n`);
      return "continue";
    }
    case "memory":
      if (arg === "edit") {
        const project = app.memoryFiles[1];
        if (project === undefined) {
          process.stdout.write("no project memory file.\n");
          return "continue";
        }
        app.editPath(project.path, opts.editor ?? defaultEditor());
        return "continue";
      }
      for (const file of app.memoryFiles) {
        process.stdout.write(`${file.path}: ${file.content.length} chars\n`);
      }
      return "continue";
    case "init": {
      const done = app.initMemory();
      process.stdout.write(
        `wrote ${done.path}${done.imported === undefined ? "" : ` (imported ${done.imported})`}\n`,
      );
      return "continue";
    }
    case "mcp": {
      const names = app.mcp.servers;
      if (names.length === 0) {
        process.stdout.write("no MCP servers (see .flow/mcp.json)\n");
        return "continue";
      }
      const inventory = await app.mcp.toolInventory();
      process.stdout.write(`servers: ${names.join(", ")}\n`);
      for (const tool of inventory.slice(0, 50)) {
        process.stdout.write(`- ${tool.namespaced}: ${tool.description}\n`);
      }
      return "continue";
    }
    case "config":
      process.stdout.write(`${describeConfig(app)}\n`);
      return "continue";
    case "review": {
      const diff = await app.tools.bash("git diff --stat && git diff | head -c 6000");
      if (!diff.ok) {
        process.stdout.write(`review needs a git repo: ${diff.output.slice(0, 200)}\n`);
        return "continue";
      }
      const verdict = await app.driver.sendMessage([
        { role: "system", content: "Review this diff for bugs and quality. Be concise." },
        { role: "user", content: diff.output },
      ]);
      process.stdout.write(`${verdict.text}\n`);
      return "continue";
    }
    case "add-dir":
      if (arg === "") {
        process.stdout.write(`workspace: ${app.tools.rootDir}\nusage: /add-dir <path>\n`);
        return "continue";
      }
      try {
        app.tools.chdir(arg);
        process.stdout.write(`workspace: ${app.tools.rootDir}\n`);
      } catch (err) {
        process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return "continue";
    case "sessions":
      for (const id of app.sessions.list()) {
        process.stdout.write(`${id}  ${sessionPreview(app.sessions.load(id))}\n`);
      }
      return "continue";
    case "fork": {
      const source = arg === "" ? sessionId : arg;
      try {
        const next = app.sessions.fork(source);
        app.sessions.append(next, { type: "session-forked", from: source });
        process.stdout.write(`forked → ${next}\n`);
      } catch (err) {
        process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return "continue";
    }
    case "new": {
      history.length = 0;
      costs.session = 0;
      const next = randomUUID();
      app.sessions.append(next, { type: "session-start", mode, model: app.driver.id });
      process.stdout.write(`new session ${next.slice(0, 8)}\n`);
      return { switchSession: next };
    }
    case "rename": {
      if (arg === "") {
        process.stdout.write("usage: /rename <name>\n");
        return "continue";
      }
      try {
        const next = app.sessions.rename(sessionId, arg);
        process.stdout.write(`renamed → ${next}\n`);
        return { switchSession: next };
      } catch (err) {
        process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return "continue";
    }
    case "copy": {
      const parts = arg.split(/\s+/).filter((p) => p !== "");
      let nth = 1;
      if (parts.length > 0 && /^\d+$/.test(parts[0] as string)) {
        nth = Math.max(1, Number(parts.shift()));
      }
      const responses = history.filter((m) => m.role === "assistant").map((m) => m.content);
      const picked = responses[responses.length - nth];
      if (picked === undefined) {
        process.stdout.write("nothing to copy yet.\n");
        return "continue";
      }
      const target = parts.join(" ");
      if (target === "") {
        process.stdout.write(`${picked}\n(copied to output — clipboard needs a TTY helper)\n`);
        return "continue";
      }
      if (mode === "plan") {
        process.stdout.write("plan mode: writes are disabled (read-only).\n");
        return "continue";
      }
      const verdict = await confirmTool(
        app,
        rl,
        sessionId,
        mode,
        rules,
        "Write",
        { path: target },
        target,
      );
      if (verdict !== "allow") return "continue";
      const result = await app.tools.write(target, picked);
      process.stdout.write(`${result.output}\n`);
      return "continue";
    }
    case "tasks": {
      const counts = new Map<string, number>();
      for (const record of app.sessions.load(sessionId)) {
        const type =
          typeof record === "object" && record !== null
            ? String((record as Record<string, unknown>).type ?? "unknown")
            : "unknown";
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
      if (counts.size === 0) {
        process.stdout.write("no activity yet.\n");
        return "continue";
      }
      for (const [type, count] of [...counts.entries()].sort()) {
        process.stdout.write(`${type}: ${count}\n`);
      }
      return "continue";
    }
    case "reload": {
      const counts = app.reloadExtensions();
      process.stdout.write(
        `reloaded: ${counts.skills} skills, ${counts.subagents} subagents, ${counts.commands} commands.\n`,
      );
      return "continue";
    }
    case "doctor":
      await runDoctor(app);
      return "continue";
    case "status":
    case "usage":
      process.stdout.write(`${await renderStatus(app, app.dailyUsage())}\n`);
      return "continue";
    case "undo":
    case "rewind": {
      const checkpoints = app.listCheckpoints(sessionId);
      const last = checkpoints.at(-1);
      if (last === undefined) {
        process.stdout.write("no checkpoints yet (taken before council runs and file writes).\n");
        return "continue";
      }
      if (cmd === "rewind" && arg === "") {
        for (const checkpoint of checkpoints) {
          process.stdout.write(`${describeCheckpoint(checkpoint)}\n`);
        }
        process.stdout.write("usage: /rewind <id-prefix>\n");
        return "continue";
      }
      const wanted = cmd === "undo" && arg === "" ? last.id : arg;
      try {
        const { touched, failed } = await app.restoreCheckpoint(sessionId, wanted);
        const verb = cmd === "undo" && arg === "" ? "undone" : "rewound";
        const failures = failed.length > 0 ? ` ${failed.length} failed: ${failed.join("; ")}` : "";
        process.stdout.write(`${verb} → restored ${touched.length} paths.${failures}\n`);
      } catch (err) {
        process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return "continue";
    }
    case "export": {
      const target = arg === "" ? `sys-export-${Date.now()}.md` : arg;
      if (mode === "plan") {
        process.stdout.write("plan mode: writes are disabled (read-only).\n");
        return "continue";
      }
      const verdict = await confirmTool(
        app,
        rl,
        sessionId,
        mode,
        rules,
        "Write",
        { path: target },
        target,
      );
      if (verdict !== "allow") return "continue";
      const body = history.map((m) => `## ${m.role}\n\n${m.content}`).join("\n\n");
      const result = await app.tools.write(target, `# Sys export\n\n${body}\n`);
      process.stdout.write(`${result.output}\n`);
      return "continue";
    }
    case "vim":
      process.stdout.write(
        "vim bindings need the full-screen TUI (tracked); editing stays emacs-style here.\n",
      );
      return "continue";
    case "agents": {
      const [sub, ...subRest] = arg.split(/\s+/).filter((p) => p !== "");
      if (sub === "run" && subRest.length >= 2) {
        const [name, ...promptParts] = subRest as [string, ...string[]];
        try {
          const answer = await app.runSubagent(name ?? "", promptParts.join(" "), (token) =>
            process.stdout.write(token),
          );
          process.stdout.write(`\n${answer}\n`);
        } catch (err) {
          process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        return "continue";
      }
      if (council !== undefined) {
        process.stdout.write(`${council.interject("agents", "")}\n`);
      } else {
        process.stdout.write("solo session — start with --agents a,b for a council.\n");
      }
      process.stdout.write(`${subagentListing(app.subagents)}\n`);
      return "continue";
    }
    case "mute":
    case "unmute":
    case "promote":
    case "handoff":
    case "mode":
    case "round":
    case "plan":
    case "stop-agent":
      if (council === undefined) {
        process.stdout.write(`/${cmd} needs a council — start with --agents a,b.\n`);
        return "continue";
      }
      process.stdout.write(`${council.interject(cmd, arg)}\n`);
      return "continue";
    case "approve": {
      if (council === undefined) {
        process.stdout.write("/approve needs a council — start with --agents a,b.\n");
        return "continue";
      }
      await runApproveTurn(app, council, sessionId, history, costs, opts.notify ?? true);
      return "continue";
    }
    case "read":
    case "glob":
    case "grep":
      return runReadTool(app, rl, sessionId, mode, rules, cmd, arg);
    case "write":
    case "edit":
    case "bash":
      return runWriteTool(app, rl, sessionId, mode, rules, cmd, arg, opts.editor);
    default: {
      const custom = app.customCommands.find((c) => c.name === cmd);
      if (custom !== undefined) {
        await runCustomCommand(
          app,
          council,
          sessionId,
          history,
          substituteArgs(custom.template, arg),
          mode,
          rules,
        );
        return "continue";
      }
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

function defaultEditor(): string {
  return process.platform === "win32" ? "notepad" : "vi";
}

async function runCustomCommand(
  app: FlowApp,
  council: CouncilSession | undefined,
  sessionId: string,
  history: ChatMessage[],
  task: string,
  mode: PermissionMode,
  rules: PermissionRule[],
): Promise<void> {
  history.push({ role: "user", content: task });
  app.sessions.append(sessionId, { type: "user", text: task });
  if (council !== undefined) {
    const run = await council.run(task, (line) => process.stdout.write(`${line}\n`));
    process.stdout.write(`${run.text}\n`);
    history.push({ role: "assistant", content: run.text });
    app.sessions.append(sessionId, { type: "assistant", text: run.text });
    return;
  }
  try {
    let text = "";
    const loop = await runToolLoop(app.driver, app.tools, TOOL_SYSTEM, task, {
      seed: history.slice(0, -1),
      emit: (token) => {
        text += token;
        process.stdout.write(token);
      },
      ...soloLoopOpts(app, mode, rules),
    });
    text = loop.answer;
    process.stdout.write("\n");
    history.push({ role: "assistant", content: text });
    app.sessions.append(sessionId, { type: "assistant", text });
  } catch (err) {
    process.stdout.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
