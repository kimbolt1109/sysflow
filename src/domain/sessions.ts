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
