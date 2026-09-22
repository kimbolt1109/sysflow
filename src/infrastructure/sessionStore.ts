import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { projectHash } from "@/domain/sessions.js";

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

  fork(sessionId: string): string {
    const source = this.path(sessionId);
    if (!existsSync(source)) throw new Error(`unknown session "${sessionId}"`);
    const next = randomUUID();
    mkdirSync(this.dir(), { recursive: true });
    copyFileSync(source, this.path(next));
    return next;
  }

  rename(sessionId: string, name: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`invalid session name "${name}" (letters, digits, -, _)`);
    }
    const source = this.path(sessionId);
    if (!existsSync(source)) throw new Error(`unknown session "${sessionId}"`);
    if (existsSync(this.path(name))) throw new Error(`session "${name}" already exists`);
    renameSync(source, this.path(name));
    return name;
  }
}
