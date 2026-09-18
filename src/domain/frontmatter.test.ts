import { describe, expect, it } from "vitest";
import { fieldAsList, fieldAsString, parseFrontmatter } from "@/domain/frontmatter";

describe("frontmatter", () => {
  it("parses scalar and list fields plus body", () => {
    const parsed = parseFrontmatter(
      "---\nname: review\ndescription: Reviews code\nallowed-tools:\n  - Read\n  - Grep\n---\n# Body here\n",
    );

    expect(parsed.fields.name).toBe("review");
    expect(fieldAsString(parsed.fields, "description")).toBe("Reviews code");
    expect(fieldAsList(parsed.fields, "allowed-tools")).toEqual(["Read", "Grep"]);
    expect(parsed.body).toBe("# Body here\n");
  });

  it("returns the whole text as body without frontmatter", () => {
    const parsed = parseFrontmatter("# plain");

    expect(parsed.fields).toEqual({});
    expect(parsed.body).toBe("# plain");
  });
});
