import { Box, Text, useApp, useInput, useStdout } from "ink";
import { Spinner } from "@inkjs/ui";
import { randomUUID } from "node:crypto";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { FlowApp } from "@/app.js";
import { CouncilSession } from "@/api/council.js";
import { renderCost } from "@/api/costView.js";
import { buildSlashCatalog, resolveSlashAlias } from "@/api/tui/slashMenu.js";
import { PromptInput } from "@/api/tui/PromptInput.js";
import { buildSkillTask, renderTranscriptMarkdown } from "@/api/tui/sessionTurn.js";
import {
  Header,
  HelpOverlay,
  QueuePane,
  ShortcutsBar,
  SideBar,
  StatusBar,
  TranscriptView,
  type AgentBadge,
  type TranscriptLine,
} from "@/api/tui/SessionView.js";
import { substituteArgs } from "@/domain/commands.js";
import { formatMcpInventory } from "@/domain/mcp.js";
import type { Checkpoint } from "@/domain/checkpoints.js";
import { diffCheckpoints } from "@/domain/diff.js";
import type { Driver } from "@/domain/drivers.js";
import { findModel } from "@/domain/modelRegistry.js";
import type { ChatMessage, OrchestrationMode } from "@/domain/models.js";
import type { Orchestrant } from "@/domain/orchestrator.js";
import { checkPermission, nextPermissionMode, type PermissionMode } from "@/domain/permissions.js";
import { skillListing } from "@/domain/skills.js";
import { subagentListing } from "@/domain/subagents.js";
import { thinkingDirective, type ThinkingLevel } from "@/domain/thinking.js";
import { buildContextUsage, renderContextBars } from "@/domain/tokenizer.js";
import { runToolLoop, TOOL_SYSTEM } from "@/infrastructure/agentLoop.js";
import { fetchPageText } from "@/lib/webfetch.js";
import { openBrowser } from "@/lib/browser.js";
import { answerQuestions } from "@/infrastructure/layaClient.js";
import { formatDecisions, screenPrompt, triageQuestions } from "@/domain/decide.js";
import {
  findMatches,
  formatElapsed,
  sanitizeTranscriptText,
  scrollStep,
  transcriptRowCounts,
} from "@/domain/transcript.js";

export interface SessionProps {
  app: FlowApp;
  modelIds: string[];
  mode: OrchestrationMode;
  lead?: string;
  thinking: ThinkingLevel;
  notify: boolean;
  yolo: boolean;
  permission: { current: PermissionMode };
  createAgents: (ids: string[], thinking: ThinkingLevel) => Orchestrant[];
  createDriver: (id: string) => Driver;
  /** past council lessons, injected by the composition root ("" when none) */
  lessons?: string;
}

export interface PendingQuestion {
  question: string;
  options: string[];
}

function historyTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function Session({
  app,
  modelIds,
  mode,
  lead,
  thinking,
  notify,
  yolo,
  permission,
  createAgents,
  createDriver,
  lessons = "",
}: SessionProps): ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [sessionId] = useState(() => randomUUID());
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const draftRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState(0);
  const [turnKey, setTurnKey] = useState(0);
  const [restored, setRestored] = useState("");
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const keyRef = useRef(0);
  const busyRef = useRef(false);
  const busyStartRef = useRef<number | undefined>(undefined);
  const queueRef = useRef<string[]>([]);
  const [queued, setQueued] = useState(0);
  const [queueList, setQueueList] = useState<string[]>([]);
  const [lastTurnMs, setLastTurnMs] = useState<number | undefined>(undefined);
  const [pending, setPending] = useState<PendingQuestion | undefined>(undefined);
  const [, setModeTick] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stashNote, setStashNote] = useState("");
  const stashRef = useRef<string | undefined>(undefined);
  const [find, setFind] = useState<{ needle: string; matches: number[]; pos: number } | undefined>(
    undefined,
  );
  const linesRef = useRef<TranscriptLine[]>([]);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  const pendingRef = useRef<
    { question: string; options: string[]; resolve: (answer: string) => void } | undefined
  >(undefined);
  const [now, setNow] = useState(() => Date.now());
  const historyRef = useRef<ChatMessage[]>([
    {
      role: "system",
      content: thinkingDirective(thinking) + (lessons === "" ? "" : `\n\n${lessons}`),
    },
  ]);

  const soloId = modelIds[0] ?? app.config.defaultModel;
  const driver = useMemo(() => createDriver(soloId), [createDriver, soloId]);
  const council = useMemo(() => {
    if (modelIds.length < 2) return undefined;
    const session = new CouncilSession(createAgents(modelIds, thinking), (record) =>
      app.sessions.append(sessionId, record),
    );
    session.mode = mode;
    if (lead !== undefined) session.lead = lead;
    return session;
  }, [sessionId]);

  const catalog = useMemo(
    () =>
      buildSlashCatalog({
        skills: app.skills,
        subagents: app.subagents,
        customCommands: app.customCommands,
      }),
    [app],
  );
  const columns = stdout?.columns ?? 100;
  const termRows = stdout?.rows ?? 24;
  const narrow = columns < 90;
  const sidebarCollapsed = sidebarHidden || narrow;
  const viewHeight = Math.max(5, termRows - 14);
  const transcriptWidth = Math.max(20, columns - (sidebarCollapsed ? 12 : 48));
  const rowCounts = useMemo(
    () => transcriptRowCounts(lines, transcriptWidth),
    [lines, transcriptWidth],
  );
  const totalRows = rowCounts.reduce((sum, c) => sum + c, 0);

  const contextWindowOf = (): number => {
    const base = soloId.split(" (")[0] ?? soloId;
    return findModel(app.config.models, base)?.contextWindow ?? 200000;
  };

  const contextPct = ((): number => {
    try {
      const usage = buildContextUsage(
        { system: "", tools: "", memory: "", skills: "", mcp: "", messages: historyRef.current },
        contextWindowOf(),
      );
      return usage.pct;
    } catch {
      return 0;
    }
  })();

  const onDraftChange = (value: string): void => {
    draftRef.current = value;
  };

  const push = (role: TranscriptLine["role"], text: string): number => {
    keyRef.current += 1;
    const key = keyRef.current;
    const clean = sanitizeTranscriptText(text);
    const at = Date.now();
    setLines((prev) => [...prev, { key, role, text: clean, at }].slice(-2000));
    return key;
  };
  const updateLine = (key: number, text: string): void => {
    const clean = sanitizeTranscriptText(text);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, text: clean } : l)));
  };

  const scrollBy = (delta: number): void => {
    setScrollOffset((prev) => scrollStep(prev, delta, totalRows, viewHeight));
  };

  const toggleStash = (): void => {
    if (pendingRef.current !== undefined) return;
    const current = draftRef.current;
    if (current.trim() !== "") {
      stashRef.current = current;
      draftRef.current = "";
      setRestored("");
      setTurnKey((k) => k + 1);
      setStashNote("stashed — Ctrl+S restores");
    } else if (stashRef.current !== undefined) {
      const saved = stashRef.current;
      stashRef.current = undefined;
      draftRef.current = saved;
      setRestored(saved);
      setTurnKey((k) => k + 1);
      setStashNote("");
    }
  };

  useInput((input, key) => {
    if (key.tab && key.shift && pendingRef.current === undefined) {
      const base = permission.current === "bypassPermissions" ? "default" : permission.current;
      permission.current = nextPermissionMode(base);
      setModeTick((t) => t + 1);
      push("info", `permission mode: ${permission.current}`);
      return;
    }
    if (key.pageUp && pendingRef.current === undefined) {
      scrollBy(-(viewHeight - 2));
      return;
    }
    if (key.pageDown && pendingRef.current === undefined) {
      scrollBy(viewHeight - 2);
      return;
    }
    if (key.ctrl && (input === "b" || input === "B")) {
      setSidebarHidden((v) => !v);
      return;
    }
    if (key.ctrl && (input === "s" || input === "S")) {
      toggleStash();
      return;
    }
  });

  useEffect(() => {
    app.askUser = (question, options) => {
      if (notify) app.notifyUser("Sys needs your input", question.slice(0, 120));
      return new Promise<string>((resolve) => {
        const entry = { question, options, resolve };
        pendingRef.current = entry;
        setPending({ question, options });
      });
    };
    return () => {
      app.askUser = undefined;
      pendingRef.current?.resolve("(session ended)");
      pendingRef.current = undefined;
    };
  }, [app, notify]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    app.sessions.append(sessionId, { type: "session-start", model: soloId });
    push(
      "info",
      `session ${sessionId.slice(0, 8)} · ${council === undefined ? soloId : `${modelIds.length} agents · mode=${council.mode}`} · /help for commands`,
    );
    void app.hooks.fire("SessionStart", { session_id: sessionId, model: soloId });
  }, [sessionId]);

  const snapshotBefore = async (): Promise<Checkpoint | undefined> => {
    try {
      return await app.takeCheckpoint(sessionId, "before turn");
    } catch {
      return undefined;
    }
  };

  const pushDiffs = async (before: Checkpoint | undefined): Promise<void> => {
    if (before === undefined) return;
    let after: Record<string, string | null>;
    try {
      after = await app.snapshotWorkspace();
    } catch {
      return;
    }
    const diffs = diffCheckpoints(before.files, after);
    const shown = diffs.slice(0, 10);
    let rendered = 0;
    for (const diff of shown) {
      const header =
        diff.added > 0 && diff.removed === 0 && before.files[diff.path] === undefined
          ? `New ${diff.path} (+${diff.added})`
          : before.files[diff.path] !== undefined && after[diff.path] === undefined
            ? `Deleted ${diff.path} (-${diff.removed})`
            : `Edit ${diff.path} (+${diff.added} -${diff.removed})`;
      push("info", header);
      for (const line of diff.lines) {
        if (rendered >= 150) break;
        push("diff", `${line.op} ${line.text}`);
        rendered += 1;
      }
      if (rendered >= 150) break;
    }
    if (rendered >= 150) push("info", "… diff truncated, /review for the full diff");
    if (diffs.length > shown.length)
      push("info", `… and ${diffs.length - shown.length} more files`);
  };

  const runTask = async (task: string): Promise<void> => {
    push("user", task);
    app.sessions.append(sessionId, { type: "user", text: task });
    const submitted = await app.hooks.fire("UserPromptSubmit", {
      session_id: sessionId,
      prompt: task,
    });
    if (submitted.decision === "block") {
      push("error", `blocked: ${submitted.reason}`);
      return;
    }
    const screen = screenPrompt(task);
    if (screen.risky) {
      push(
        "info",
        `guard: this prompt trips ${screen.notes.join("; ")} — continuing; tell me to stop if I'm wrong.`,
      );
    }
    if (council !== undefined) {
      try {
        const before = await snapshotBefore();
        if (before !== undefined) {
          app.sessions.append(sessionId, {
            type: "checkpoint",
            id: before.id,
            label: before.label,
          });
        }
        const run = await council.run(task, (line) => push("info", line));
        push("assistant", run.text);
        historyRef.current.push(
          { role: "user", content: task },
          { role: "assistant", content: run.text },
        );
        app.sessions.append(sessionId, { type: "assistant", text: run.text });
        const used = app.recordUsage("council", "", historyTokens(task), historyTokens(run.text));
        setCost((c) => c + used.cost);
        if (notify) app.notifyUser("Sys task complete", run.text.slice(0, 120));
        await pushDiffs(before);
      } catch (err) {
        push("error", `error: ${err instanceof Error ? err.message : String(err)}`);
        app.sessions.append(sessionId, { type: "error", message: String(err) });
      }
      return;
    }
    const key = push("assistant", "");
    historyRef.current.push({ role: "user", content: task });
    const before = await snapshotBefore();
    try {
      let text = "";
      const soloCheck = (tool: string, input: Record<string, unknown>) =>
        yolo ? "allow" : checkPermission(permission.current, app.rules, tool, input);
      const full = await runToolLoop(driver, app.tools, TOOL_SYSTEM, task, {
        seed: historyRef.current.slice(0, -1),
        maxTurns: 12,
        check: soloCheck,
        emit: (token) => {
          text += token;
          updateLine(key, text);
        },
        hooks: {
          before: (name, input) =>
            app.hooks.fire("PreToolUse", { tool_name: name, tool_input: input }),
          after: (name, input, output) =>
            app.hooks
              .fire("PostToolUse", {
                tool_name: name,
                tool_input: input,
                output: output.slice(0, 2000),
              })
              .then(() => undefined),
        },
        onSkill: (name) => {
          const skill = app.skills.find((s) => s.name === name);
          if (skill?.disableModelInvocation === true) return undefined;
          return app.skillBody(name);
        },
        onQuestion: app.askUser,
        onWebfetch: (url) => fetchPageText(url),
        onBrowse: (url) => openBrowser(url),
        onDecide: async (state, questions) =>
          formatDecisions((await answerQuestions(app.config.layaUrl, state, questions)).answers),
        onListMcpTools: async () => formatMcpInventory(await app.mcp.toolInventory()),
        onMcpTool: (toolName, args) => app.mcp.call(toolName, args),
      });
      updateLine(key, full.answer);
      historyRef.current.push({ role: "assistant", content: full.answer });
      app.sessions.append(sessionId, { type: "assistant", text: full.answer });
      const base = soloId.split(" (")[0] ?? soloId;
      const used = app.recordUsage(
        base.split("/")[0] ?? "unknown",
        base,
        historyTokens(task),
        historyTokens(full.answer),
      );
      setCost((c) => c + used.cost);
      if (notify) app.notifyUser("Sys task complete", full.answer.slice(0, 120));
      await pushDiffs(before);
    } catch (err) {
      updateLine(key, `error: ${err instanceof Error ? err.message : String(err)}`);
      app.sessions.append(sessionId, { type: "error", message: String(err) });
    }
  };

  const runSlash = async (raw: string): Promise<void> => {
    const [rawCmd, ...rest] = raw.slice(1).split(/\s+/);
    const cmd = resolveSlashAlias(`/${rawCmd ?? ""}`).slice(1);
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "exit":
      case "quit":
        exit();
        return;
      case "help":
        push(
          "info",
          "slash: /clear (/new) /model /models /skills [/name] /agents [/run name prompt] /cost /context /triage text /find text /dump [path] /plan [/approve] /exit (/quit) — plus /<skill> and /<custom>. keys: ↑↓ history and slash menu · Tab accept · \\+Enter newline · PgUp/PgDn scroll · Ctrl+B sidebar · Ctrl+S stash · Shift+Tab permit · Esc Esc help",
        );
        return;
      case "clear":
        setLines([]);
        setScrollOffset(0);
        setFind(undefined);
        return;
      case "model":
        push(
          "info",
          council === undefined
            ? `model: ${driver.id}`
            : `council: ${modelIds.join(", ")} · mode=${council.mode}`,
        );
        return;
      case "models":
        push(
          "info",
          app.models
            .slice(0, 20)
            .map((m) => m.id)
            .join("\n") + (app.models.length > 20 ? `\n… ${app.models.length} total` : ""),
        );
        return;
      case "skills":
        if (arg === "") {
          push("info", skillListing(app.skills));
          return;
        }
        {
          const body = app.skillBody(arg);
          push("info", body ?? `unknown skill "${arg}"`);
        }
        return;
      case "agents": {
        const [sub, ...subRest] = arg.split(/\s+/).filter((p) => p !== "");
        if (sub === "run" && subRest.length >= 2) {
          const [name, ...promptParts] = subRest as [string, ...string[]];
          const key = push("assistant", "");
          try {
            let text = "";
            const answer = await app.runSubagent(name ?? "", promptParts.join(" "), (token) => {
              text += token;
              updateLine(key, text);
            });
            updateLine(key, answer);
          } catch (err) {
            updateLine(key, `error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }
        push("info", council === undefined ? "solo session" : council.interject("agents", ""));
        push("info", subagentListing(app.subagents));
        return;
      }
      case "mute":
      case "unmute":
      case "promote":
      case "handoff":
      case "mode":
      case "round":
      case "plan":
      case "stop-agent":
        push(
          "info",
          council === undefined ? `/${cmd} needs a council` : council.interject(cmd, arg),
        );
        return;
      case "approve": {
        if (council === undefined) {
          push("info", "/approve needs a council");
          return;
        }
        const run = await council.approve((line) => push("info", line));
        if (run === undefined) {
          push("info", "no pending plan — send a task first with /plan on.");
          return;
        }
        push("assistant", run.text);
        historyRef.current.push({ role: "assistant", content: run.text });
        app.sessions.append(sessionId, { type: "assistant", text: run.text });
        const used = app.recordUsage(
          "council",
          "",
          historyTokens("/approve"),
          historyTokens(run.text),
        );
        setCost((c) => c + used.cost);
        return;
      }
      case "cost":
        push("info", renderCost(cost, app.dailyUsage()));
        return;
      case "triage": {
        if (arg === "") {
          push("info", "usage: /triage <text> — route, urgency, refund, and churn in one pass");
          return;
        }
        const triaged = await answerQuestions(app.config.layaUrl, arg, triageQuestions());
        push("info", `triage (${triaged.source}):\n${formatDecisions(triaged.answers)}`);
        return;
      }
      case "find": {
        if (arg === "") {
          setFind(undefined);
          push("info", "find cleared");
          return;
        }
        const snapshot = linesRef.current;
        const matches = findMatches(snapshot, arg);
        if (matches.length === 0) {
          setFind(undefined);
          push("info", `no matches for "${arg}"`);
          return;
        }
        const cycling = find !== undefined && find.needle.toLowerCase() === arg.toLowerCase();
        const pos =
          cycling && find !== undefined
            ? (find.pos - 1 + matches.length) % matches.length
            : matches.length - 1;
        const target = matches[pos] ?? matches[matches.length - 1] ?? 0;
        const counts = transcriptRowCounts(snapshot, transcriptWidth);
        const total = counts.reduce((sum, c) => sum + c, 0);
        const below = counts.slice(target + 1).reduce((sum, c) => sum + c, 0);
        setScrollOffset(Math.max(0, Math.min(below, Math.max(0, total - viewHeight))));
        setFind({ needle: arg, matches, pos });
        push(
          "info",
          `find "${arg}" — match ${pos + 1}/${matches.length} (repeat /find to cycle, /find clears)`,
        );
        return;
      }
      case "dump": {
        const target = arg === "" ? `sys-transcript-${sessionId.slice(0, 8)}.md` : arg;
        try {
          const body = renderTranscriptMarkdown(linesRef.current, sessionId, soloId);
          const result = await app.tools.write(target, body);
          push("info", result.output === "" ? `wrote ${target}` : result.output);
        } catch (err) {
          push("error", `dump failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      case "context": {
        const usage = buildContextUsage(
          { system: "", tools: "", memory: "", skills: "", mcp: "", messages: historyRef.current },
          contextWindowOf(),
        );
        push("info", renderContextBars(usage));
        return;
      }
      default: {
        const skill = app.skills.find((s) => s.name === cmd);
        if (skill !== undefined) {
          if (!skill.userInvocable) {
            push("info", `skill "${skill.name}" is not directly runnable`);
            return;
          }
          const body = app.skillBody(skill.name);
          if (body === undefined) {
            push("error", `unknown skill "${skill.name}"`);
            return;
          }
          await runTask(buildSkillTask(skill.name, body, arg));
          return;
        }
        const custom = app.customCommands.find((c) => c.name === cmd);
        if (custom !== undefined) {
          await runTask(substituteArgs(custom.template, arg));
          return;
        }
        push("error", `unknown command /${cmd ?? ""} — try /help`);
      }
    }
  };

  const submit = (value: string): void => {
    const input = sanitizeTranscriptText(value).trim();
    setTurnKey((k) => k + 1);
    draftRef.current = "";
    setRestored("");
    setStashNote("");
    if (input === "") return;
    const pendingQuestion = pendingRef.current;
    if (pendingQuestion !== undefined) {
      pendingRef.current = undefined;
      setPending(undefined);
      const n = Number(input);
      pendingQuestion.resolve(
        pendingQuestion.options.length > 0 &&
          Number.isInteger(n) &&
          n >= 1 &&
          n <= pendingQuestion.options.length
          ? (pendingQuestion.options[n - 1] as string)
          : input,
      );
      return;
    }
    setInputHistory((prev) =>
      prev[prev.length - 1] === input ? prev : [...prev, input].slice(-100),
    );
    if (busyRef.current) {
      queueRef.current.push(input);
      setQueued(queueRef.current.length);
      setQueueList([...queueRef.current]);
      push("info", `queued #${queueRef.current.length} — runs after the current turn`);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    busyStartRef.current = Date.now();
    void runOne(input);
  };

  const runOne = async (input: string): Promise<void> => {
    const started = Date.now();
    try {
      if (input.startsWith("/")) await runSlash(input);
      else await runTask(input);
    } finally {
      setLastTurnMs(Date.now() - started);
      const next = queueRef.current.shift();
      setQueued(queueRef.current.length);
      setQueueList([...queueRef.current]);
      if (next !== undefined) {
        await runOne(next);
      } else {
        busyRef.current = false;
        setBusy(false);
        busyStartRef.current = undefined;
      }
    }
  };

  const badges: AgentBadge[] =
    council === undefined
      ? [{ name: soloId, lead: true, muted: false, stopped: false }]
      : council.names().map((n) => ({
          name: n,
          lead: council.lead === n,
          muted: council.muted.has(n),
          stopped: council.stopped.has(n),
        }));

  const elapsed =
    busy && busyStartRef.current !== undefined
      ? formatElapsed(now - busyStartRef.current)
      : undefined;
  const runningLabel = elapsed === undefined ? undefined : `working ${elapsed}`;
  const headerLeft = council === undefined ? soloId : `${modelIds.length} agents · ${council.mode}`;
  const headerRight =
    `${sessionId.slice(0, 8)} · ${thinking} · ${permission.current}` +
    (queued > 0 ? ` · ⏳${queued}` : "");
  const headerAlert =
    yolo === true
      ? "YOLO"
      : council?.pendingPlan !== undefined
        ? "plan pending"
        : council?.planMode === true
          ? "plan-mode"
          : undefined;

  return (
    <Box flexDirection="column">
      <Header left={headerLeft} right={headerRight} alert={headerAlert} />
      <Box marginTop={1}>
        <Box flexDirection="column" flexGrow={1}>
          <TranscriptView
            lines={lines}
            height={viewHeight}
            scrollOffset={scrollOffset}
            width={transcriptWidth}
            highlight={find?.needle ?? ""}
          />
        </Box>
        <SideBar
          mode={council?.mode ?? "solo"}
          agents={badges}
          skills={app.skills.map((s) => s.name)}
          sessionId={sessionId}
          cost={cost}
          collapsed={sidebarCollapsed}
          queue={queueList}
          contextPct={contextPct}
          runningLabel={runningLabel}
        />
      </Box>
      <QueuePane queue={queueList} />
      {pending !== undefined && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
        >
          <Text bold color="yellow">
            ? {pending.question}
          </Text>
          {pending.options.map((o, i) => (
            <Text key={o}>
              {" "}
              {i + 1}. {o}
            </Text>
          ))}
          <Text dimColor>reply with the number or your own answer</Text>
        </Box>
      )}
      {helpOpen && pending === undefined && <HelpOverlay />}
      <Box marginTop={1} flexDirection="column">
        <PromptInput
          key={turnKey}
          initialValue={restored}
          history={inputHistory}
          catalog={catalog}
          placeholder={
            busy
              ? `working… (type to queue${elapsed === undefined ? "" : ` · ${elapsed}`})`
              : stashNote !== ""
                ? stashNote
                : "message or /command · ↑↓ history · \\+Enter newline"
          }
          onChange={onDraftChange}
          onSubmit={submit}
          onToggleHelp={() => setHelpOpen((v) => !v)}
        />
        {busy && <Spinner label={elapsed === undefined ? "working" : `working ${elapsed}`} />}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <StatusBar
          left={`${council === undefined ? soloId : `${modelIds.length} agents · ${council.mode}`} · thinking=${thinking} · $${cost.toFixed(4)} · ctx ${Math.round(contextPct * 100)}%${queued > 0 ? ` · ${queued} queued` : ""}`}
          right={`${scrollOffset > 0 ? "scrolled" : "live"}${lastTurnMs === undefined ? "" : ` · took ${formatElapsed(lastTurnMs)}`}${find !== undefined ? ` · find "${find.needle}" ${find.pos + 1}/${find.matches.length}` : ""}${sidebarCollapsed ? " · sidebar hidden (Ctrl+B)" : ""}`}
        />
        <ShortcutsBar narrow={narrow} />
      </Box>
    </Box>
  );
}
