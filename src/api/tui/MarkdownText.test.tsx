import { renderToString } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "@/api/tui/MarkdownText.js";

describe("MarkdownText", () => {
  it("drops raw markdown markers from the rendered reply", () => {
    const out = renderToString(
      <MarkdownText
        text={"## Plan\n- read **config** via `loadConfig`\n```ts\nconst a = 1;\n```"}
      />,
      { columns: 80 },
    );

    expect(out).toContain("Plan");
    expect(out).toContain("• read config via loadConfig");
    expect(out).toContain("│ const a = 1;");
    expect(out).not.toContain("**");
    expect(out).not.toContain("```");
    expect(out).not.toContain("##");
  });
});
