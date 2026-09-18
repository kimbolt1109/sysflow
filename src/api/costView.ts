import type { FlowApp } from "@/app";
import type { DailyUsage } from "@/infrastructure/usageStore";
import { dailyTotals } from "@/infrastructure/usageStore";

export async function renderStatus(app: FlowApp, daily: DailyUsage): Promise<string> {
  const lines: string[] = [];
  const providers = new Set<string>();
  for (const model of app.config.models) {
    providers.add(model.provider);
  }
  for (const provider of [...providers].sort()) {
    const representative = app.config.models.find((m) => m.provider === provider)?.id ?? provider;
    let quota;
    try {
      quota = await app.quotaFor(representative);
    } catch {
      quota = undefined;
    }
    const usage = daily.providers[provider] ?? { requests: 0, input: 0, output: 0, cost: 0 };
    let bar = "";
    if (quota?.limit !== undefined && quota.limit > 0) {
      const filled = Math.min(10, Math.round((10 * usage.requests) / quota.limit));
      bar = ` [${"█".repeat(filled)}${"░".repeat(Math.max(0, 10 - filled))}]`;
    }
    lines.push(
      `${provider}: ${usage.requests} req today, ~${usage.input + usage.output}t, $${usage.cost.toFixed(2)}${bar}${quota?.estimated === true ? " (~estimated)" : ""}${quota?.resetAt !== undefined ? ` resets ${quota.resetAt}` : ""}`,
    );
  }
  return lines.join("\n");
}

export function renderCost(sessionCost: number, daily: DailyUsage): string {
  const totals = dailyTotals(daily);
  return `session: $${sessionCost.toFixed(4)} · today: $${totals.cost.toFixed(2)} across ${totals.requests} requests`;
}
