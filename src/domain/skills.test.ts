import { describe, expect, it } from "vitest";
import { parseSkillMd, skillListing } from "@/domain/skills.js";

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
      userInvocable: true,
      disableModelInvocation: false,
      source: "user/review",
    });
  });

  it("parses invocation gates", () => {
    const skill = parseSkillMd(
      "---\nname: gated\ndescription: G\nuser-invocable: false\ndisable-model-invocation: true\n---\n",
      "s",
    );

    expect(skill.userInvocable).toBe(false);
    expect(skill.disableModelInvocation).toBe(true);
  });

  it("rejects skills without a name", () => {
    expect(() => parseSkillMd("---\ndescription: x\n---\n", "s")).toThrow(
      'missing frontmatter "name"',
    );
  });

  it("lists name plus description for progressive disclosure", () => {
    expect(skillListing([])).toContain("no skills");
    expect(
      skillListing([
        {
          name: "a",
          description: "does A",
          allowedTools: [],
          userInvocable: true,
          disableModelInvocation: false,
          source: "u",
        },
      ]),
    ).toBe("- a: does A");
    expect(
      skillListing([
        {
          name: "b",
          description: "does B",
          allowedTools: [],
          userInvocable: false,
          disableModelInvocation: false,
          source: "u",
        },
      ]),
    ).toContain("not directly runnable");
  });
});
