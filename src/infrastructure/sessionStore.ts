import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectHash } from "@/domain/sessions";

export class SessionStore {
  constructor(
    readonly dataDir: string,
    readonly projectDir: string,
  ) {}

  dir(): string {
    return join(this.dataDir, "projects", projectHash(this.projectDir));
  }

  path(sessionId: string): string {
    return join(this.dir(), `${sessionId}.jsonl`);
  }

  append(sessionId: string, record: unknown): void {
    mkdirSync(this.dir(), { recursive: true });
    appendFileSync(this.path(sessionId), `${JSON.stringify(record)}\n`, "utf8");
  }

  load(sessionId: string): unknown[] {
    const file = this.path(sessionId);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as unknown);
  }

  list(): string[] {
    if (!existsSync(this.dir())) return [];
    return readdirSync(this.dir())
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length))
      .sort();
  }
}
