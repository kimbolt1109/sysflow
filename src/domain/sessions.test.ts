import { describe, expect, it } from "vitest";
import { isUuid, projectHash, sessionFileName, sessionPreview } from "@/domain/sessions.js";

describe("sessions", () => {
  it("hashes project paths deterministically", () => {
    expect(projectHash("C:\\proj")).toBe(projectHash("C:\\proj"));
    expect(projectHash("C:\\a")).not.toBe(projectHash("C:\\b"));
    expect(projectHash("x")).toHaveLength(16);
  });

  it("names session files as jsonl", () => {
    expect(sessionFileName("abc")).toBe("abc.jsonl");
  });

  it("validates uuids", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });

  it("previews sessions", () => {
    expect(sessionPreview([])).toBe("(empty)");
    expect(sessionPreview([{ type: "user", text: "fix the login bug" }])).toBe(
      "1 msgs · fix the login bug",
    );
    expect(sessionPreview([{ type: "headless-start", prompt: "do things", model: "m" }])).toContain(
      "do things",
    );
  });
});
