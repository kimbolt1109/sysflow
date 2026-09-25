import type { ChatMessage } from "@/domain/models.js";

const FRAME_OVERHEAD = 400;

function clipHead(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 20))}\n…[truncated]`;
}

function clipTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `[truncated]…\n${text.slice(text.length - Math.max(0, max - 20))}`;
}

function renderTurn(message: ChatMessage): string {
  const body = message.content.trim();
  if (message.role === "tool") {
    return `[tool result${message.name !== undefined ? `: ${message.name}` : ""}]\n${body}`;
  }
  return `[${message.role}]\n${body}`;
}

/** Keeps the newest blocks that fit; a lone oversized newest block is tail-clipped, not dropped. */
function fitNewest(blocks: string[], budget: number): { kept: string[]; omitted: number } {
  const kept: string[] = [];
  let used = 0;
  let i = blocks.length - 1;
  for (; i >= 0; i -= 1) {
    const block = blocks[i] ?? "";
    if (used + block.length + 2 > budget) break;
    kept.unshift(block);
    used += block.length + 2;
  }
  if (kept.length === 0 && i >= 0 && budget > 200) {
    kept.unshift(clipTail(blocks[i] ?? "", budget - 2));
    i -= 1;
  }
  return { kept, omitted: i + 1 };
}

/** Flattens a chat transcript into the single prompt a headless CLI agent takes per run.
 * Order: system instructions, earlier turns (oldest dropped first when over budget), the
 * current task, then tool progress made on it. A bare user message passes through as-is. */
export function renderCliPrompt(messages: ChatMessage[], maxChars: number): string {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content.trim())
    .filter((s) => s !== "")
    .join("\n\n");
  const convo = messages.filter((m) => m.role !== "system");
  let lastUser = -1;
  for (let i = convo.length - 1; i >= 0; i -= 1) {
    if (convo[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  const history = lastUser < 0 ? [] : convo.slice(0, lastUser);
  const task = lastUser < 0 ? "" : (convo[lastUser]?.content ?? "");
  const progress = lastUser < 0 ? convo : convo.slice(lastUser + 1);

  if (system === "" && history.length === 0 && progress.length === 0) {
    return clipHead(task, maxChars);
  }

  const systemText = clipHead(system, Math.floor(maxChars / 4));
  const taskText = clipHead(task.trim(), Math.floor(maxChars / 2));
  let budget = maxChars - systemText.length - taskText.length - FRAME_OVERHEAD;
  const done = fitNewest(progress.map(renderTurn), Math.max(0, budget));
  budget -= done.kept.reduce((sum, b) => sum + b.length + 2, 0);
  const earlier = fitNewest(history.map(renderTurn), Math.max(0, budget));

  const parts: string[] = [];
  if (systemText !== "") parts.push(`<instructions>\n${systemText}\n</instructions>`);
  if (earlier.kept.length > 0 || earlier.omitted > 0) {
    const note = earlier.omitted > 0 ? `(${earlier.omitted} earlier messages omitted)\n\n` : "";
    parts.push(`<conversation>\n${note}${earlier.kept.join("\n\n")}\n</conversation>`);
  }
  if (taskText !== "") parts.push(`<task>\n${taskText}\n</task>`);
  if (done.kept.length > 0) {
    const note = done.omitted > 0 ? `(${done.omitted} earlier steps omitted)\n\n` : "";
    parts.push(`<progress>\n${note}${done.kept.join("\n\n")}\n</progress>`);
    parts.push(
      "Continue the task from the progress above: use the tool results, call more tools if needed, or give your final answer.",
    );
  }
  return parts.join("\n\n");
}
