import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, isHookEvent, parseHookDecision } from "@/domain/hooks";

describe("hooks", () => {
  it("covers the spec event set", () => {
    for (const event of [
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "SessionStart",
      "SessionEnd",
      "PreCompact",
      "Notification",
      "Stop",
      "AgentStop",
      "AgentMessage",
      "AgentHandoff",
    ]) {
      expect(HOOK_EVENTS).toContain(event);
    }
  });

  it("blocks on exit code 2 with stderr as reason", () => {
    expect(parseHookDecision("", 2, "nope")).toEqual({ decision: "block", reason: "nope" });
    expect(parseHookDecision("", 0, "")).toEqual({ decision: "proceed" });
  });

  it("honors stdout JSON decisions", () => {
    expect(parseHookDecision('{"decision": "block", "reason": "r"}', 0, "")).toEqual({
      decision: "block",
      reason: "r",
    });
    expect(parseHookDecision('{"decision": "approve"}', 0, "")).toEqual({ decision: "proceed" });
    expect(parseHookDecision("plain output", 0, "")).toEqual({ decision: "proceed" });
  });

  it("validates event names", () => {
    expect(isHookEvent("Stop")).toBe(true);
    expect(isHookEvent("Bogus")).toBe(false);
  });
});
