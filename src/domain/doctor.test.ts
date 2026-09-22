import { describe, expect, it } from "vitest";
import { renderDoctor } from "@/domain/doctor.js";

describe("doctor", () => {
  it("renders rows and detects failures", () => {
    const ok = renderDoctor([{ name: "node", ok: true, detail: "v24" }]);

    expect(ok.failed).toBe(false);
    expect(ok.text).toContain("ok    node");

    const bad = renderDoctor([
      { name: "node", ok: true, detail: "v24" },
      { name: "auth", ok: false, warn: true, detail: "missing" },
      { name: "storage", ok: false, detail: "unwritable" },
    ]);

    expect(bad.failed).toBe(true);
    expect(bad.text).toContain("warn  auth");
    expect(bad.text).toContain("FAIL  storage");
  });
});
