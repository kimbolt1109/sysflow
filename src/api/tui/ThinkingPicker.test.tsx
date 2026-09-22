import { describe, expect, it, vi } from "vitest";
import { renderToString } from "ink";
import React from "react";
import { ThinkingPicker } from "@/api/tui/ThinkingPicker.js";

describe("tui ThinkingPicker", () => {
  it("renders every thinking level", () => {
    const out = renderToString(
      <ThinkingPicker defaultLevel="medium" onDone={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(out).toContain("Thinking level");
    for (const level of ["low", "medium", "high", "xhigh"]) {
      expect(out).toContain(level);
    }
  });
});
