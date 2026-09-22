import { describe, expect, it } from "vitest";
import { buildSkillTask, renderTranscriptMarkdown } from "@/api/tui/sessionTurn.js";

describe("sessionTurn", () => {
  it("builds a skill task from body and request", () => {
    const task = buildSkillTask("review", "BODY", "check auth");

    expect(task).toContain("Skill review:");
    expect(task).toContain("BODY");
    expect(task).toContain("check auth");
    expect(buildSkillTask("review", "BODY", "  ")).toContain("(no extra instructions)");
  });

  it("renders the transcript as markdown", () => {
    const md = renderTranscriptMarkdown(
      [
        { role: "user", text: "hi" },
        { role: "assistant", text: "hello" },
        { role: "info", text: "note" },
        { role: "error", text: "boom" },
        { role: "diff", text: "+a" },
      ],
      "sess-1",
      "model-x",
    );

    expect(md).toContain("# Sys transcript");
    expect(md).toContain("## user");
    expect(md).toContain("## assistant");
    expect(md).toContain("**ERROR:** boom");
    expect(md).toContain("```diff");
  });
});
