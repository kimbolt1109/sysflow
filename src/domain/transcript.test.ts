import { describe, expect, it } from "vitest";
import {
  capTranscript,
  estimateWrappedLines,
  findMatches,
  formatElapsed,
  queuePreview,
  sanitizeTranscriptText,
  scrollStep,
  sliceByRows,
  transcriptRowCounts,
  viewportSlice,
} from "@/domain/transcript.js";

describe("transcript", () => {
  it("strips ANSI and invisible characters but keeps newlines", () => {
    const out = sanitizeTranscriptText("hi\x1b[31m there\u200B  \nnext\t ");
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("​");
    expect(out).toBe("hi there\nnext");
  });

  it("computes a follow viewport at the bottom", () => {
    const view = viewportSlice(100, 20, 0);
    expect(view).toEqual({ start: 80, end: 100, hiddenAbove: 80, hiddenBelow: 0, follow: true });
  });

  it("clamps scroll offset above and below", () => {
    expect(viewportSlice(10, 20, 0)).toEqual({
      start: 0,
      end: 10,
      hiddenAbove: 0,
      hiddenBelow: 0,
      follow: true,
    });
    expect(viewportSlice(100, 20, 999)).toEqual({
      start: 0,
      end: 20,
      hiddenAbove: 0,
      hiddenBelow: 80,
      follow: false,
    });
  });

  it("steps scroll within bounds", () => {
    expect(scrollStep(0, 10, 100, 20)).toBe(10);
    expect(scrollStep(78, 10, 100, 20)).toBe(80);
    expect(scrollStep(5, -10, 100, 20)).toBe(0);
  });

  it("estimates wrapped lines", () => {
    expect(estimateWrappedLines("abc", 80)).toBe(1);
    expect(estimateWrappedLines(`${"x".repeat(90)}\n${"y".repeat(10)}`, 80)).toBe(3);
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(5000)).toBe("5s");
    expect(formatElapsed(65000)).toBe("1m 5s");
    expect(formatElapsed(120000)).toBe("2m");
  });

  it("previews the queue and caps the transcript", () => {
    expect(queuePreview(["a", "b", "c", "d"], 2)).toEqual({ shown: ["a", "b"], remaining: 2 });
    expect(capTranscript([1, 2, 3, 4], 3)).toEqual({ kept: [2, 3, 4], dropped: 1 });
  });

  it("counts wrapped rows with lead-in for user/assistant entries", () => {
    const counts = transcriptRowCounts(
      [
        { role: "user", text: "hi" },
        { role: "info", text: "ok" },
      ],
      80,
    );
    expect(counts).toEqual([2, 1]);
  });

  it("slices row-measured transcripts with follow and scroll", () => {
    const follow = sliceByRows([2, 1, 1, 3], 4, 0);
    expect(follow).toEqual({
      start: 2,
      end: 4,
      hiddenAboveRows: 3,
      hiddenBelowRows: 0,
      follow: true,
    });
    const scrolled = sliceByRows([2, 1, 1, 3], 4, 3);
    expect(scrolled.follow).toBe(false);
    expect(scrolled.end).toBeLessThan(4);
  });

  it("clamps row offsets and always shows a tall entry", () => {
    const clamped = sliceByRows([1, 1], 4, 999);
    expect(clamped.hiddenBelowRows).toBe(0);
    const tall = sliceByRows([10], 4, 0);
    expect(tall).toEqual({
      start: 0,
      end: 1,
      hiddenAboveRows: 0,
      hiddenBelowRows: 0,
      follow: true,
    });
  });

  it("finds case-insensitive matches", () => {
    const lines = [{ text: "Fix it" }, { text: "done" }, { text: "FIXED already" }];
    expect(findMatches(lines, "fix")).toEqual([0, 2]);
    expect(findMatches(lines, "  ")).toEqual([]);
  });
});
