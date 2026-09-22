import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import React from "react";
import { phaseLine } from "@/api/council.js";
import {
  foldInfoLines,
  Header,
  HelpOverlay,
  QueuePane,
  ShortcutsBar,
  SideBar,
  StatusBar,
  TranscriptView,
} from "@/api/tui/SessionView.js";

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

  it("renders agent badges, skills, and cost", () => {
    const out = renderToString(
      <SideBar
        mode="council"
        agents={[
          { name: "a", lead: true, muted: false, stopped: false },
          { name: "b", lead: false, muted: true, stopped: false },
        ]}
        skills={["review"]}
        sessionId="12345678-aaaa"
        cost={0.0123}
      />,
    );

    expect(out).toContain("council");
    expect(out).toContain("◆ a");
    expect(out).toContain("b (muted)");
    expect(out).toContain("/review");
    expect(out).toContain("12345678");
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

  it("renders error lines and the empty state", () => {
    const err = renderToString(
      <TranscriptView lines={[{ key: 1, role: "error", text: "boom" }]} />,
    );
    expect(err).toContain("boom");

    const empty = renderToString(<TranscriptView lines={[]} />);
    expect(empty).toContain("PgUp");
  });

  it("renders chrome: header, status, queue, help, collapsed sidebar", () => {
    expect(renderToString(<Header left="solo" right="abc" />)).toContain("flow");
    expect(renderToString(<StatusBar left="a" right="b" />)).toContain("a");
    expect(renderToString(<ShortcutsBar />)).toContain("Shift+Tab");
    expect(renderToString(<QueuePane queue={["one", "two"]} />)).toContain("queued (2)");
    expect(renderToString(<HelpOverlay />)).toContain("shortcuts");
    const collapsed = renderToString(
      <SideBar
        mode="solo"
        agents={[{ name: "a", lead: true, muted: false, stopped: false }]}
        skills={[]}
        sessionId="12345678-aaaa"
        cost={0.5}
        collapsed
        queue={["q1"]}
      />,
    );
    expect(collapsed).toContain("⏳1");
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
