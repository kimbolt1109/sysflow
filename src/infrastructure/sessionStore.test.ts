import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "@/infrastructure/sessionStore.js";

describe("SessionStore", () => {
  let dir = "";
  let store: SessionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-sess-"));
    store = new SessionStore(join(dir, "data"), join(dir, "proj"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends and loads jsonl records in order", () => {
    store.append("s1", { type: "user", text: "hi" });
    store.append("s1", { type: "assistant", text: "hello" });

    expect(store.load("s1")).toEqual([
      { type: "user", text: "hi" },
      { type: "assistant", text: "hello" },
    ]);
  });

  it("returns empty for unknown sessions and lists session ids", () => {
    expect(store.load("missing")).toEqual([]);
    store.append("b", { x: 1 });
    store.append("a", { x: 2 });

    expect(store.list()).toEqual(["a", "b"]);
  });

  it("forks and renames sessions", () => {
    store.append("s1", { type: "user", text: "hi" });

    const forked = store.fork("s1");
    expect(store.load(forked)).toEqual([{ type: "user", text: "hi" }]);
    expect(() => store.fork("missing")).toThrow("unknown session");

    expect(store.rename("s1", "renamed")).toBe("renamed");
    expect(store.list()).toContain("renamed");
    expect(() => store.rename("renamed", "bad name!")).toThrow("invalid session name");
  });

  it("rejects path traversal in session ids", () => {
    expect(() => store.append("../../pwn", { x: 1 })).toThrow("invalid session id");
    expect(() => store.load("../../pwn")).toThrow("invalid session id");
  });

  it("skips torn lines instead of losing history", () => {
    store.append("s1", { type: "user", text: "hi" });
    appendFileSync(join(store.dir(), "s1.jsonl"), '{"torn":\n', "utf8");
    store.append("s1", { type: "assistant", text: "hello" });

    expect(store.load("s1")).toEqual([
      { type: "user", text: "hi" },
      { type: "assistant", text: "hello" },
    ]);
  });
});
