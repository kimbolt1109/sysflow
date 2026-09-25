import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import React from "react";
import {
  Header,
  HelpOverlay,
  QueuePane,
  ShortcutsBar,
  SideBar,
  StatusBar,
} from "@/api/tui/SessionChrome.js";

describe("tui SessionChrome", () => {
  it("lists council agents with lead and muted markers", () => {
    const out = renderToString(
      <SideBar
        mode="council"
        agents={[
          { name: "a", lead: true, muted: false, stopped: false },
          { name: "b", lead: false, muted: true, stopped: false },
        ]}
      />,
    );

    expect(out).toContain("council · 2 agents");
    expect(out).toContain("◆ a");
    expect(out).toContain("b (muted)");
  });

  it("renders header, status, queue, help, and shortcuts", () => {
    expect(renderToString(<Header left="solo" right="abc" alert="YOLO" />)).toMatch(
      /◆ sys\s+solo\s+abc\s+YOLO/,
    );
    const status = renderToString(<StatusBar left="left side" right="right side" />, {
      columns: 60,
    });
    expect(status).toContain("left side");
    expect(status).toContain("right side");
    expect(status.split("\n")).toHaveLength(1);
    expect(renderToString(<ShortcutsBar />)).toContain("Shift+Tab");
    expect(renderToString(<QueuePane queue={["one", "two"]} />)).toContain("queued (2)");
    expect(renderToString(<QueuePane queue={[]} />)).toBe("");
    expect(renderToString(<HelpOverlay />)).toContain("shortcuts");
  });
});
