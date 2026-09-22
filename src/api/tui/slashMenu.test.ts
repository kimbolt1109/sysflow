import { describe, expect, it } from "vitest";
import {
  buildSlashCatalog,
  filterSlash,
  fuzzyScore,
  resolveSlashAlias,
} from "@/api/tui/slashMenu.js";

describe("slashMenu", () => {
  const catalog = buildSlashCatalog({
    skills: [
      {
        name: "review",
        description: "Review code",
        allowedTools: [],
        userInvocable: true,
        disableModelInvocation: false,
        source: "project",
      },
      {
        name: "manual",
        description: "Manual only",
        allowedTools: [],
        userInvocable: false,
        disableModelInvocation: false,
        source: "project",
      },
    ],
    subagents: [
      {
        name: "scout",
        description: "Explore",
        tools: [],
        prompt: "",
        source: "project",
      },
    ],
    customCommands: [{ name: "deploy", template: "deploy $ARGUMENTS", source: "project" }],
  });

  it("builds builtins, skills, subagents, and custom commands", () => {
    const commands = catalog.map((e) => e.command);

    expect(commands).toContain("/help");
    expect(commands).toContain("/review");
    expect(commands).not.toContain("/manual");
    expect(commands).toContain("/agents run scout");
    expect(commands).toContain("/deploy");
    expect(commands).toContain("/plan");
    expect(commands).toContain("/approve");
    expect(commands).toContain("/find");
    expect(commands).toContain("/dump");
    expect(commands).toContain("/triage");
  });

  it("filters on the slash prefix without spaces", () => {
    expect(filterSlash("/mo", catalog).map((e) => e.command)).toContain("/model");
    expect(filterSlash("/rev", catalog).map((e) => e.command)).toContain("/review");
    expect(filterSlash("hello", catalog)).toEqual([]);
    expect(filterSlash("/agents run x", catalog)).toEqual([]);
    expect(filterSlash("/", catalog).length).toBeGreaterThan(5);
  });

  it("matches aliases and fuzzy subsequences", () => {
    expect(filterSlash("/quit", catalog).map((e) => e.command)).toContain("/exit");
    expect(filterSlash("/nw", catalog).map((e) => e.command)).toContain("/clear");
    expect(fuzzyScore("md", "model")).toBeGreaterThanOrEqual(0);
    expect(fuzzyScore("xyz", "model")).toBe(-1);
  });

  it("resolves aliases to canonical commands", () => {
    expect(resolveSlashAlias("/quit")).toBe("/exit");
    expect(resolveSlashAlias("/new")).toBe("/clear");
    expect(resolveSlashAlias("/help")).toBe("/help");
  });
});
