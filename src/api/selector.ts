import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { FlowApp } from "@/app";
import type { ModelInfo, OrchestrationMode } from "@/domain/models";

export interface Selection {
  models: string[];
  mode: OrchestrationMode;
  lead?: string;
}

export const MODE_DESCRIPTIONS: Record<OrchestrationMode, string> = {
  solo: "solo — one agent works the task.",
  council: "council — agents draft, critique, converge, then the lead executes (default for 2+).",
  relay: "relay — agents take turns on one transcript (implement → test → review).",
  workers: "workers — lead decomposes, agents own subtasks in parallel.",
  auto: "auto — Flow picks a mode from task size and agent count.",
};

const MODES: OrchestrationMode[] = ["solo", "council", "relay", "workers", "auto"];

export function parseToggle(input: string, count: number): number[] {
  const picked = new Set<number>();
  for (const part of input.split(",")) {
    const n = Number(part.trim());
    if (!Number.isInteger(n) || n < 1 || n > count) {
      throw new Error(`pick numbers 1–${count}, got "${part.trim()}"`);
    }
    picked.add(n - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

function lastSelectionPath(app: FlowApp): string {
  return join(app.config.dataDir, "last.json");
}

export function loadLastSelection(app: FlowApp): Selection | undefined {
  const path = lastSelectionPath(app);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Selection>;
    if (!Array.isArray(parsed.models) || parsed.models.length === 0) return undefined;
    const known = new Set(app.config.models.map((m) => m.id));
    const models = parsed.models.filter((m): m is string => typeof m === "string" && known.has(m));
    if (models.length === 0) return undefined;
    const mode = MODES.includes(parsed.mode as OrchestrationMode)
      ? (parsed.mode as OrchestrationMode)
      : undefined;
    return {
      models,
      mode: mode ?? (models.length > 1 ? "council" : "solo"),
      lead: typeof parsed.lead === "string" ? parsed.lead : undefined,
    };
  } catch {
    return undefined;
  }
}

export function saveLastSelection(app: FlowApp, selection: Selection): void {
  mkdirSync(app.config.dataDir, { recursive: true });
  writeFileSync(lastSelectionPath(app), `${JSON.stringify(selection)}\n`, "utf8");
}

function printModels(models: ModelInfo[], quotas: Map<string, string>): void {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const group = byProvider.get(m.provider) ?? [];
    group.push(m);
    byProvider.set(m.provider, group);
  }
  let n = 0;
  for (const [provider, group] of byProvider) {
    process.stdout.write(`\n[${provider}]\n`);
    for (const m of group) {
      n += 1;
      process.stdout.write(
        `  ${n}. ${m.id} | ctx ${m.contextWindow} | $${m.inputPricePerM}/$${m.outputPricePerM} per 1M | quota ${quotas.get(m.id) ?? "—"} | ${m.tags.join(",")}\n`,
      );
    }
  }
  process.stdout.write("\n");
}

function question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolvePromise) => {
    rl.question(prompt, (answer) => resolvePromise(answer.trim()));
  });
}

export async function runSelector(
  app: FlowApp,
  preselected?: string[],
  preMode?: OrchestrationMode,
): Promise<Selection> {
  const last = loadLastSelection(app);
  const flat = app.config.models;
  const quotas = new Map<string, string>();
  await Promise.all(
    flat.map(async (m) => {
      try {
        const quota = await app.quotaFor(m.id);
        quotas.set(
          m.id,
          quota.limit !== undefined && quota.limit > 0
            ? `${quota.requestsToday}/${quota.limit}`
            : quota.requestsToday > 0
              ? `${quota.requestsToday} req`
              : "—",
        );
      } catch {
        quotas.set(m.id, "—");
      }
    }),
  );
  printModels(app.config.models, quotas);

  let models: string[];
  if (preselected !== undefined && preselected.length > 0) {
    models = preselected;
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const def = last?.models.join(",") ?? "1";
    const answer = await question(rl, `Toggle models by number, comma-separated [${def}]: `);
    rl.close();
    const raw = answer === "" ? def : answer;
    if (/^[0-9,\s]+$/.test(raw)) {
      models = parseToggle(raw, flat.length).map((i) => (flat[i] as ModelInfo).id);
    } else {
      models = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
    }
    if (models.length === 0) models = [(flat[0] as ModelInfo).id];
  }

  let mode = preMode ?? (models.length > 1 ? "council" : "solo");
  if (preMode === undefined && process.stdin.isTTY) {
    process.stdout.write("\nModes:\n");
    for (const m of MODES) {
      process.stdout.write(`  ${m} — ${MODE_DESCRIPTIONS[m]}\n`);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await question(rl, `Mode [${mode}]: `);
    rl.close();
    if (answer !== "") {
      if (!MODES.includes(answer as OrchestrationMode)) {
        throw new Error(`unknown mode "${answer}"`);
      }
      mode = answer as OrchestrationMode;
    }
  }

  let lead: string | undefined;
  if (models.length > 1 && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await question(rl, "Lead agent (Enter = highest-scored plan wins): ");
    rl.close();
    if (answer !== "") lead = answer;
  }

  const selection: Selection = { models, mode, lead };
  saveLastSelection(app, selection);
  return selection;
}
