import { describe, expect, it } from "vitest";
import {
  acceptSlashCompletion,
  caretLinePosition,
  clampCursor,
  eraseBackward,
  eraseForward,
  insertText,
  killToLineEnd,
  killToLineStart,
  killWordBackward,
  moveChar,
  moveLineEnd,
  moveLineStart,
  moveLineVertical,
  pastedText,
  type PromptEdit,
} from "@/api/tui/promptState.js";

const edit = (value: string, cursor: number): PromptEdit => ({ value, cursor });

describe("promptState", () => {
  it("normalizes pasted line endings and drops stray control bytes", () => {
    expect(pastedText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(pastedText("x\u0007y\tz\u001b")).toBe("xy\tz");
  });

  it("inserts and clamps the caret", () => {
    expect(insertText(edit("", 0), "hi")).toEqual({ value: "hi", cursor: 2 });
    expect(insertText(edit("ab", 1), "X")).toEqual({ value: "aXb", cursor: 2 });
    expect(insertText(edit("ab", 99), "!")).toEqual({ value: "ab!", cursor: 3 });
    expect(clampCursor("ab", -5)).toBe(0);
  });

  it("erases backward and forward", () => {
    expect(eraseBackward(edit("ab", 1))).toEqual({ value: "b", cursor: 0 });
    expect(eraseBackward(edit("ab", 0))).toEqual({ value: "ab", cursor: 0 });
    expect(eraseForward(edit("ab", 1))).toEqual({ value: "a", cursor: 1 });
    expect(eraseForward(edit("ab", 2))).toEqual({ value: "ab", cursor: 2 });
  });

  it("moves across lines keeping the column", () => {
    const start = edit("abc\nde", 5);
    expect(moveLineVertical(start, -1)).toEqual({ value: "abc\nde", cursor: 1 });
    expect(moveLineVertical(edit("ab\ndef", 1), 1)).toEqual({ value: "ab\ndef", cursor: 4 });
    expect(moveChar(edit("ab", 0), 5)).toEqual({ value: "ab", cursor: 2 });
    expect(moveLineStart(edit("ab\ncd", 5))).toEqual({ value: "ab\ncd", cursor: 3 });
    expect(moveLineEnd(edit("ab\ncd", 3))).toEqual({ value: "ab\ncd", cursor: 5 });
  });

  it("reports caret line position for history handoff", () => {
    expect(caretLinePosition(edit("one", 1))).toBe("only");
    expect(caretLinePosition(edit("a\nb", 0))).toBe("first");
    expect(caretLinePosition(edit("a\nb", 3))).toBe("last");
    expect(caretLinePosition(edit("a\nb\nc", 2))).toBe("middle");
  });

  it("kills to line edges and words", () => {
    expect(killToLineStart(edit("hello", 3))).toEqual({ value: "lo", cursor: 0 });
    expect(killToLineEnd(edit("hello", 3))).toEqual({ value: "hel", cursor: 3 });
    expect(killWordBackward(edit("src/utils/foo.ts", 16))).toEqual({
      value: "",
      cursor: 0,
    });
    expect(killWordBackward(edit("git commit -m", 13))).toEqual({
      value: "git commit ",
      cursor: 11,
    });
  });

  it("accepts slash completions with a trailing space", () => {
    expect(acceptSlashCompletion("/model")).toEqual({ value: "/model ", cursor: 7 });
    expect(acceptSlashCompletion("/agents run scout")).toEqual({
      value: "/agents run scout",
      cursor: 17,
    });
  });
});
