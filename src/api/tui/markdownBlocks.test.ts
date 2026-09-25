import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "@/api/tui/markdownBlocks.js";

describe("markdownBlocks", () => {
  it("splits bold and inline code, leaving underscores and single stars alone", () => {
    expect(parseInline("run **all** of `npm test` on src/*_x.ts")).toEqual([
      { text: "run " },
      { text: "all", bold: true },
      { text: " of " },
      { text: "npm test", code: true },
      { text: " on src/*_x.ts" },
    ]);
  });

  it("styles code nested inside bold", () => {
    expect(parseInline("**`loadConfig`** and **use `x` now**")).toEqual([
      { text: "loadConfig", code: true, bold: true },
      { text: " and " },
      { text: "use ", bold: true },
      { text: "x", code: true, bold: true },
      { text: " now", bold: true },
    ]);
  });

  it("recognizes headings, bullets, quotes, rules, and code fences", () => {
    const blocks = parseMarkdown(
      "# Title\n\n- one\n  - nested\n1. first\n> note\n---\n```ts\nconst a = 1;\n```\ntail",
    );

    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "blank",
      "bullet",
      "bullet",
      "bullet",
      "quote",
      "rule",
      "code",
      "text",
    ]);
    expect(blocks[3]).toMatchObject({ kind: "bullet", indent: 1, marker: "•" });
    expect(blocks[4]).toMatchObject({ kind: "bullet", marker: "1." });
    expect(blocks[7]).toEqual({ kind: "code", lang: "ts", lines: ["const a = 1;"] });
  });

  it("renders an unclosed fence as code while it streams", () => {
    expect(parseMarkdown("```py\nprint(1)")).toEqual([
      { kind: "code", lang: "py", lines: ["print(1)"] },
    ]);
  });

  it("collapses blank runs and trims trailing blanks", () => {
    expect(parseMarkdown("a\n\n\n\nb\n\n").map((b) => b.kind)).toEqual(["text", "blank", "text"]);
  });
});
