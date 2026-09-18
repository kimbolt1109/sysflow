import { describe, expect, it } from "vitest";
import { parseScores } from "@/infrastructure/driverAgent";

describe("driverAgent", () => {
  it("parses JSON score maps", () => {
    expect(parseScores('{"a": {"score": 8, "note": "good"}}')).toEqual({
      a: { score: 8, note: "good" },
    });
  });

  it("returns empty for non-JSON replies", () => {
    expect(parseScores("looks fine to me")).toEqual({});
  });
});
