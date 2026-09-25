import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { render, renderToString } from "ink";
import React from "react";
import { PromptInput } from "@/api/tui/PromptInput.js";
import type { SlashEntry } from "@/api/tui/slashMenu.js";

const catalog: SlashEntry[] = [
  { command: "/model", hint: "show the active model", group: "builtin" },
  { command: "/models", hint: "list known models", group: "builtin" },
];

describe("PromptInput", () => {
  it("shows the placeholder when empty", () => {
    const out = renderToString(
      <PromptInput
        history={[]}
        catalog={catalog}
        placeholder="type here"
        onSubmit={() => {}}
        onToggleHelp={() => {}}
      />,
    );

    expect(out).toContain("type here");
  });

  it("renders the initial value", () => {
    const out = renderToString(
      <PromptInput
        history={[]}
        catalog={catalog}
        initialValue="hello"
        onSubmit={() => {}}
        onToggleHelp={() => {}}
      />,
    );

    expect(out).toContain("hello");
  });

  it("opens the slash menu for a leading slash", () => {
    const out = renderToString(
      <PromptInput
        history={[]}
        catalog={catalog}
        initialValue="/mo"
        onSubmit={() => {}}
        onToggleHelp={() => {}}
      />,
    );

    expect(out).toContain("/model");
    expect(out).toContain("[builtin]");
    expect(out).toContain("Tab accept");
  });

  it("stays quiet for plain text", () => {
    const out = renderToString(
      <PromptInput
        history={[]}
        catalog={catalog}
        initialValue="hello"
        onSubmit={() => {}}
        onToggleHelp={() => {}}
      />,
    );

    expect(out).not.toContain("[builtin]");
  });

  it("accepts pasted multi-character input and submits it", async () => {
    const frames: string[] = [];
    const submitted: string[] = [];
    const stdout = Object.assign(new EventEmitter(), {
      columns: 80,
      rows: 20,
      isTTY: true,
      write: (s: string) => {
        frames.push(s);
        return true;
      },
    });
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    Object.assign(stdin, { setRawMode: () => stdin, ref: () => stdin, unref: () => stdin });
    const ink = render(
      <PromptInput
        history={[]}
        catalog={catalog}
        onSubmit={(v) => submitted.push(v)}
        onToggleHelp={() => {}}
      />,
      {
        stdout: stdout as never,
        stdin: stdin as never,
        debug: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 100));
    await tick();
    stdin.write("fix the login bug");
    await tick();
    expect(frames[frames.length - 1]).toContain("fix the login bug");
    stdin.write("\r");
    await tick();
    ink.unmount();

    expect(submitted).toEqual(["fix the login bug"]);
  });
});
