import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import React from "react";
import { phaseLine } from "@/api/council.js";
import { foldInfoLines, TranscriptView } from "@/api/tui/SessionView.js";

describe("tui SessionView", () => {
  it("renders user, assistant, and info lines", () => {
    const out = renderToString(
      <TranscriptView
        lines={[
          { key: 1, role: "user", text: "fix it" },
          { key: 2, role: "assistant", text: "done" },
          { key: 3, role: "info", text: "—— PLANNING ——" },
        ]}
      />,
    );

    expect(out).toContain("fix it");
    expect(out).toContain("done");
    expect(out).toContain("PLANNING");
  });

  it("renders assistant replies as markdown, not raw markers", () => {
    const out = renderToString(
      <TranscriptView
        lines={[
          { key: 1, role: "assistant", text: "It exports **`loadConfig`**:\n```ts\nx();\n```" },
        ]}
      />,
      { columns: 80 },
    );

    expect(out).toContain("It exports loadConfig:");
    expect(out).toContain("│ x();");
    expect(out).not.toContain("```");
    expect(out).not.toContain("**");
  });

  it("renders tool calls as compact lines with their result", () => {
    const out = renderToString(
      <TranscriptView
        lines={[
          { key: 1, role: "user", text: "read it" },
          { key: 2, role: "tool", text: "read src/config.ts\n255 lines" },
          { key: 3, role: "tool", text: "bash rm -rf x\ndenied by policy: bash" },
        ]}
      />,
      { columns: 80 },
    );

    expect(out).toContain("⏺ read src/config.ts");
    expect(out).toContain("⎿ 255 lines");
    expect(out).toContain("⎿ denied by policy: bash");
  });

  it("folds repeated phase stubs into one agent list", () => {
    const folded = foldInfoLines([
      { key: 1, role: "info", text: `${phaseLine("PLANNING")} fan-out to 2 agents` },
      { key: 2, role: "info", text: `${phaseLine("PLANNING")} [a] drafted an approach` },
      { key: 3, role: "info", text: `${phaseLine("PLANNING")} [b] drafted an approach` },
      { key: 4, role: "info", text: `${phaseLine("DEBATE")} [a] critiqued round 1` },
      { key: 5, role: "user", text: "hi" },
    ]);

    expect(folded).toHaveLength(4);
    expect(folded[0]?.text).toContain("fan-out");
    expect(folded[1]?.text).toContain("drafted an approach");
    expect(folded[1]?.text).toContain("a, b");
    expect(folded[2]?.text).toContain("critiqued round 1");
    expect(folded[3]?.role).toBe("user");
  });

  it("keeps per-agent previews when folding events that carry them", () => {
    const folded = foldInfoLines([
      {
        key: 1,
        role: "info",
        text: `${phaseLine("PLANNING")} [a] drafted an approach: add a cache`,
      },
      {
        key: 2,
        role: "info",
        text: `${phaseLine("PLANNING")} [b] drafted an approach: rewrite it`,
      },
      { key: 3, role: "info", text: `${phaseLine("DEBATE")} [a] critiqued round 1: b=7` },
    ]);

    expect(folded).toHaveLength(2);
    expect(folded[0]?.text).toContain("drafted an approach — a, b");
    expect(folded[0]?.text).toContain("\n  a: add a cache\n  b: rewrite it");
    expect(folded[1]?.text).toContain("critiqued round 1 — a\n  a: b=7");
  });

  it("folds badges with color codes and caps long agent lists", () => {
    const esc = String.fromCharCode(27);
    const lines = Array.from({ length: 8 }, (_, i) => ({
      key: i + 1,
      role: "info" as const,
      text: `${phaseLine("DEBATE")} ${esc}[31m[g${i}]${esc}[0m critiqued round 1`,
    }));

    const folded = foldInfoLines(lines);

    expect(folded).toHaveLength(1);
    expect(folded[0]?.text).toContain("+2 more");
    expect(folded[0]?.text ?? "").not.toContain(esc);
  });

  it("windows the transcript with follow/scroll indicators", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      key: i + 1,
      role: "user" as const,
      text: `m${i + 1}`,
    }));
    const follow = renderToString(<TranscriptView lines={lines} height={4} scrollOffset={0} />);
    expect(follow).toContain("m10");
    expect(follow).toContain("earlier");
    expect(follow).not.toContain("scrolled");

    const scrolled = renderToString(<TranscriptView lines={lines} height={4} scrollOffset={4} />);
    expect(scrolled).toContain("earlier");
    expect(scrolled).toContain("scrolled");
  });

  it("shows the greeting until the conversation starts", () => {
    const empty = renderToString(<TranscriptView lines={[]} />);
    expect(empty).toContain("PgUp");
    expect(empty).toContain("Dove");

    const infoOnly = renderToString(
      <TranscriptView lines={[{ key: 1, role: "error", text: "boom" }]} />,
    );
    expect(infoOnly).toContain("boom");
    expect(infoOnly).toContain("Dove");

    const talking = renderToString(
      <TranscriptView lines={[{ key: 1, role: "user", text: "hi" }]} />,
    );
    expect(talking).not.toContain("Dove");
  });

  it("measures rows with wrapping and always shows a tall entry", () => {
    const out = renderToString(
      <TranscriptView
        lines={[
          { key: 1, role: "user", text: "m1" },
          { key: 2, role: "user", text: "m2" },
          { key: 3, role: "user", text: "m3" },
        ]}
        height={4}
        scrollOffset={0}
        width={80}
      />,
    );
    expect(out).toContain("~2 lines earlier");
    expect(out).toContain("m3");

    const tall = renderToString(
      <TranscriptView
        lines={[{ key: 1, role: "info", text: "x".repeat(200) }]}
        height={2}
        scrollOffset={0}
        width={40}
      />,
    );
    expect(tall).toContain("xxx");
  });

  it("highlights the find needle", () => {
    const out = renderToString(
      <TranscriptView
        lines={[{ key: 1, role: "user", text: "connect to database now" }]}
        highlight="database"
      />,
    );
    expect(out).toContain("database");
  });
});
