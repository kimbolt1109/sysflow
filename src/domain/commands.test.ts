import { describe, expect, it } from "vitest";
import { findCommand, parseSlash, SLASH_COMMANDS, substituteArgs } from "@/domain/commands.js";

const SPEC_COMMANDS = [
  "help",
  "clear",
  "compact",
  "context",
  "model",
  "models",
  "agents",
  "skills",
  "permissions",
  "status",
  "usage",
  "cost",
  "sessions",
  "resume",
  "init",
  "memory",
  "mcp",
  "config",
  "doctor",
  "review",
  "undo",
  "rewind",
  "export",
  "theme",
  "add-dir",
  "vim",
  "exit",
];

const MULTI_AGENT_COMMANDS = [
  "mute",
  "unmute",
  "promote",
  "handoff",
  "mode",
  "round",
  "stop-agent",
];

describe("commands", () => {
  it("covers every spec slash command (§8 plus §6 multi-agent set)", () => {
    const names = new Set(SLASH_COMMANDS.map((c) => c.name));

    for (const name of [...SPEC_COMMANDS, ...MULTI_AGENT_COMMANDS]) {
      expect(names.has(name), `missing /${name}`).toBe(true);
    }
  });

  it("finds commands by name", () => {
    expect(findCommand("help")?.description).toContain("help");
    expect(findCommand("nope")).toBeUndefined();
  });

  it("parses slash input into name plus args", () => {
    expect(parseSlash("/model foo")).toEqual({ name: "model", args: "foo" });
    expect(parseSlash("/clear")).toEqual({ name: "clear", args: "" });
    expect(parseSlash("plain")).toBeUndefined();
  });

  it("substitutes $ARGUMENTS and $N in custom commands", () => {
    expect(substituteArgs("fix $ARGUMENTS now", "a b")).toBe("fix a b now");
    expect(substituteArgs("diff $1 against $2", "x y")).toBe("diff x against y");
  });
});
