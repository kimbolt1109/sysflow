/** Council learning loop: distill past runs into lessons for future agents.
 * Pure functions over session records — no I/O, no config.
 */

export type LessonKind = "verify" | "paused" | "retro";

export interface Lesson {
  kind: LessonKind;
  text: string;
}

function clip(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Collect lessons from per-session record arrays (each chronological).
 * Keeps the most recent `cap` lessons across all sessions. */
export function extractLessons(sessionRecords: unknown[][], cap = 8): Lesson[] {
  const out: Lesson[] = [];
  for (const records of sessionRecords) {
    for (const record of records) {
      if (!isRecord(record) || record.type !== "council-end") continue;
      const verify = Array.isArray(record.verify) ? record.verify : [];
      for (const verdict of verify) {
        if (!isRecord(verdict) || verdict.passed !== false) continue;
        const agent = typeof verdict.agent === "string" ? verdict.agent : "unknown";
        const lens = typeof verdict.lens === "string" ? verdict.lens : "general";
        const notes = typeof verdict.notes === "string" ? verdict.notes : "";
        const score = typeof verdict.score === "number" ? verdict.score : 0;
        const text = clip(`[${agent}/${lens} ${score}%] ${notes}`, 300);
        if (text !== "") out.push({ kind: "verify", text });
      }
      // Domain omits pauseReason on paused results; api/council.ts stores it.
      if (record.paused === true && typeof record.pauseReason === "string") {
        const text = clip(record.pauseReason, 300);
        if (text !== "") out.push({ kind: "paused", text });
      }
      if (isRecord(record.retros)) {
        for (const [name, text] of Object.entries(record.retros)) {
          if (typeof text !== "string") continue;
          const clipped = clip(text, 300);
          if (clipped !== "") out.push({ kind: "retro", text: `[${name}] ${clipped}` });
        }
      }
    }
  }
  return out.slice(Math.max(0, out.length - Math.max(1, Math.floor(cap))));
}

/** Render lessons as an agent context block; "" when there is nothing to teach. */
export function lessonsContext(lessons: Lesson[], maxChars = 2000): string {
  if (lessons.length === 0) return "";
  const lines = lessons.map((l) => `- (${l.kind}) ${l.text}`);
  while (lines.length > 1 && lines.join("\n").length > Math.max(100, maxChars)) {
    lines.shift();
  }
  return `Past council lessons — learn from these, do not repeat the same mistakes:\n${lines.join("\n")}`;
}
