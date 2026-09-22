import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
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
});
