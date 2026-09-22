import { describe, expect, it } from "vitest";
import {
  acquireFile,
  addCritique,
  averageScore,
  emptyBlackboard,
  logDecision,
  pickLead,
  releaseFile,
  setPhase,
  setPlan,
  summarizeBoard,
} from "@/domain/blackboard.js";

describe("blackboard", () => {
  it("drafts plans and scores critiques", () => {
    const board = emptyBlackboard("ship it");

    setPlan(board, "a", "plan A");
    setPlan(board, "b", "plan B");
    addCritique(board, "a", "b", 8, "solid");
    addCritique(board, "a", "a", 6, "meh");

    expect(averageScore(board, "a")).toBe(7);
    expect(averageScore(board, "b")).toBeUndefined();
    expect(() => addCritique(board, "a", "b", 11, "x")).toThrow("1–10");
  });

  it("picks the highest-scored plan as lead", () => {
    const board = emptyBlackboard("task");
    setPlan(board, "a", "A");
    setPlan(board, "b", "B");
    addCritique(board, "a", "x", 5, "ok");
    addCritique(board, "b", "x", 9, "great");

    expect(pickLead(board)).toBe("b");
    expect(pickLead(board, "a")).toBe("a");
    expect(() => pickLead(emptyBlackboard("t"))).toThrow("no plans");
  });

  it("locks files per owner with queue-or-ask semantics", () => {
    const board = emptyBlackboard("task");

    expect(acquireFile(board, "a.ts", "a")).toBe(true);
    expect(acquireFile(board, "a.ts", "b")).toBe(false);
    expect(acquireFile(board, "a.ts", "a")).toBe(true);
    releaseFile(board, "a.ts", "b");
    expect(acquireFile(board, "a.ts", "b")).toBe(false);
    releaseFile(board, "a.ts", "a");
    expect(acquireFile(board, "a.ts", "b")).toBe(true);
  });

  it("tracks phases, decisions, and renders a bounded summary", () => {
    const board = emptyBlackboard("task", ["fast"]);
    setPhase(board, "DEBATE");
    logDecision(board, "chose B");

    const summary = summarizeBoard(board, 50);

    expect(board.phase).toBe("DEBATE");
    expect(summary).toContain("task: task");
    expect(summary).toContain("summarized");
  });
});
