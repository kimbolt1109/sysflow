import { createHash } from "node:crypto";

export function projectHash(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

export function sessionFileName(sessionId: string): string {
  return `${sessionId}.jsonl`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function sessionPreview(records: unknown[]): string {
  if (records.length === 0) return "(empty)";
  let first = "";
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const r = record as Record<string, unknown>;
    if ((r.type === "user" || r.type === "headless-start") && typeof r.text === "string") {
      first = r.text;
      break;
    }
    if (r.type === "headless-start" && typeof r.prompt === "string") {
      first = r.prompt;
      break;
    }
    if (typeof r.text === "string" && first === "") {
      first = r.text;
    }
  }
  const preview = first === "" ? "(no text)" : first.slice(0, 60);
  return `${records.length} msgs · ${preview}`;
}
