import { describe, expect, it } from "vitest";
import { parseSubagentMd, subagentListing } from "@/domain/subagents";

describe("subagents", () => {
  it("parses agent frontmatter and prompt", () => {
    const def = parseSubagentMd(
      "---\nname: reviewer\ndescription: Reviews\ntools: Read, Grep\nmodel: x\n---\nBe strict.\n",
      "proj/reviewer",
    );

    expect(def.name).toBe("reviewer");
    expect(def.tools).toEqual(["Read", "Grep"]);
    expect(def.model).toBe("x");
    expect(def.driver).toBeUndefined();
    expect(def.prompt).toBe("Be strict.");
  });

  it("rejects agents without a name", () => {
    expect(() => parseSubagentMd("no frontmatter", "s")).toThrow('missing frontmatter "name"');
  });

  it("lists agents", () => {
    expect(subagentListing([])).toContain("no subagents");
  });
});
