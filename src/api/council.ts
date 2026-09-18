import { summarizeBoard } from "@/domain/blackboard";
import type { OrchestrationMode } from "@/domain/models";
import {
  pickMode,
  runCouncil,
  runRelay,
  runWorkers,
  type CouncilEvent,
  type Orchestrant,
} from "@/domain/orchestrator";
import { badgeWith, THEMES, type Theme } from "@/api/theming";

const DEFAULT_THEME = THEMES[0] as Theme;

export function badge(name: string, index: number): string {
  return badgeWith(DEFAULT_THEME, true, name, index);
}

export function phaseLine(phase: string): string {
  return `—— ${phase} ——`;
}

export interface CouncilRun {
  text: string;
  sessionRecords: unknown[];
}

export class CouncilSession {
  readonly muted = new Set<string>();
  readonly stopped = new Set<string>();
  lead?: string;
  mode: OrchestrationMode = "council";
  rounds = 1;
  theme: Theme = DEFAULT_THEME;
  color = true;

  constructor(
    readonly agents: Orchestrant[],
    private readonly appendRecord: (record: unknown) => void = () => {},
  ) {}

  private tag(name: string): string {
    return badgeWith(this.theme, this.color, name, this.names().indexOf(name));
  }

  names(): string[] {
    return this.agents.map((a) => a.name);
  }

  interject(cmd: string, arg: string): string {
    switch (cmd) {
      case "agents":
        return this.names()
          .map(
            (n) =>
              `${this.tag(n)}${this.muted.has(n) ? " (muted)" : ""}${this.lead === n ? " (lead)" : ""}${this.stopped.has(n) ? " (stopped)" : ""}`,
          )
          .join(" ");
      case "mute":
        return this.toggle(this.muted, arg, "muted");
      case "unmute":
        this.muted.delete(arg);
        return `unmuted ${arg}`;
      case "promote":
      case "handoff":
        this.lead = arg;
        return cmd === "promote" ? `${arg} is now lead` : `handed execution to ${arg}`;
      case "stop-agent":
        this.stopped.add(arg);
        return `stopped ${arg}`;
      case "mode":
        if (
          arg === "solo" ||
          arg === "council" ||
          arg === "relay" ||
          arg === "workers" ||
          arg === "auto"
        ) {
          this.mode = arg;
          return `mode=${arg}`;
        }
        return `unknown mode "${arg}"`;
      case "round": {
        const n = Number(arg);
        if (!Number.isInteger(n) || n < 1 || n > 5) return `rounds must be 1–5, got "${arg}"`;
        this.rounds = n;
        return `rounds=${n}`;
      }
      default:
        return `unknown council command /${cmd}`;
    }
  }

  private toggle(set: Set<string>, name: string, verb: string): string {
    if (!this.names().includes(name)) return `unknown agent "${name}"`;
    set.add(name);
    return `${verb} ${name}`;
  }

  private live(): Orchestrant[] {
    return this.agents.filter((a) => !this.muted.has(a.name) && !this.stopped.has(a.name));
  }

  async run(task: string, emit: (line: string) => void): Promise<CouncilRun> {
    const sessionRecords: unknown[] = [{ type: "council-start", task, mode: this.mode }];
    const save = (record: unknown): void => {
      sessionRecords.push(record);
      this.appendRecord(record);
    };
    const live = this.live();
    if (live.length === 0) throw new Error("all agents muted or stopped");
    const show = (event: CouncilEvent): void => {
      const agent = event.agent ?? "";
      const who = agent === "" ? "" : `${this.tag(agent)} `;
      emit(`${phaseLine(event.phase)} ${who}${event.message}`);
      save({ type: "council-event", phase: event.phase, agent, message: event.message });
    };

    if (this.mode === "solo" || live.length === 1) {
      const only = live[0] as Orchestrant;
      show({ phase: "EXECUTION", agent: only.name, message: "solo execution" });
      const outcome = await only.execute(task);
      save({ type: "council-end", lead: only.name, outcome });
      return { text: outcome.summary, sessionRecords };
    }

    if (this.mode === "relay") {
      const { transcript } = await runRelay(live, task, show);
      save({ type: "council-end", transcript });
      return { text: transcript.join("\n"), sessionRecords };
    }

    if (this.mode === "workers") {
      const subtasks = await this.decompose(task, live[0] as Orchestrant);
      const { outcomes } = await runWorkers(live, task, subtasks, show);
      const text = Object.entries(outcomes)
        .map(([id, o]) => `[${id}] ${o.summary}`)
        .join("\n");
      save({ type: "council-end", outcomes });
      return { text, sessionRecords };
    }

    const mode = this.mode === "auto" ? pickMode(task.length, 0, live.length) : this.mode;
    if (mode !== "council") {
      const nested = new CouncilSession(live, this.appendRecord);
      nested.mode = mode;
      nested.rounds = this.rounds;
      nested.lead = this.lead;
      nested.theme = this.theme;
      nested.color = this.color;
      for (const name of this.muted) nested.muted.add(name);
      for (const name of this.stopped) nested.stopped.add(name);
      return nested.run(task, emit);
    }

    const result = await runCouncil(live, task, {
      preferredLead: this.lead,
      critiqueRounds: this.rounds,
      active: () => true,
      emit: show,
    });
    save({
      type: "council-end",
      lead: result.lead,
      plan: result.plan,
      board: summarizeBoard(result.board),
      paused: result.pausedForUser,
    });
    if (result.pausedForUser) {
      return {
        text: `paused: 2 reviewers rejected — lead ${result.lead} awaits your call (/promote, /handoff, or new instructions)`,
        sessionRecords,
      };
    }
    return { text: withRetro(result.outcome.summary, result.retros), sessionRecords };
  }

  private async decompose(
    task: string,
    lead: Orchestrant,
  ): Promise<Array<{ id: string; brief: string; files: string[] }>> {
    try {
      const plan = await lead.synthesize(task, [], ["split the task into subtasks"]);
      const start = plan.indexOf("[");
      const end = plan.lastIndexOf("]");
      if (start < 0 || end <= start) throw new Error("no list");
      const parsed = JSON.parse(plan.slice(start, end + 1)) as Array<{
        id?: unknown;
        brief?: unknown;
        files?: unknown;
      }>;
      return parsed.map((s, i) => ({
        id: typeof s.id === "string" ? s.id : `s${i + 1}`,
        brief: typeof s.brief === "string" ? s.brief : String(s.brief ?? task),
        files: Array.isArray(s.files)
          ? s.files.filter((f): f is string => typeof f === "string")
          : [],
      }));
    } catch {
      return [{ id: "s1", brief: task, files: [] }];
    }
  }
}

function withRetro(summary: string, retros: Record<string, string>): string {
  const entries = Object.entries(retros);
  if (entries.length === 0) return summary;
  return `${summary}\n\nretro:\n${entries.map(([name, text]) => `- ${name}: ${text}`).join("\n")}`;
}
