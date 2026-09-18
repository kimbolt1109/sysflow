import { describe, expect, it } from "vitest";
import { parseSkillMd, skillListing } from "@/domain/skills";

describe("skills", () => {
  it("parses SKILL.md frontmatter", () => {
    const skill = parseSkillMd(
      "---\nname: review\ndescription: Reviews diffs\nallowed-tools: Read, Grep\n---\nbody",
      "user/review",
    );

    expect(skill).toEqual({
      name: "review",
      description: "Reviews diffs",
      allowedTools: ["Read", "Grep"],
      source: "user/review",
    });
  });

  it("rejects skills without a name", () => {
    expect(() => parseSkillMd("---\ndescription: x\n---\n", "s")).toThrow(
      'missing frontmatter "name"',
    );
  });

  it("lists name plus description for progressive disclosure", () => {
    expect(skillListing([])).toContain("no skills");
    expect(
      skillListing([{ name: "a", description: "does A", allowedTools: [], source: "u" }]),
    ).toBe("- a: does A");
  });
});
