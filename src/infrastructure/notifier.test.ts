import { describe, expect, it, vi } from "vitest";
import { notify } from "@/infrastructure/notifier";

describe("notifier", () => {
  it("never throws and shells out best-effort", () => {
    const run = vi.fn(() => ({ ok: false }));

    expect(() => notify("title", "body", { run })).not.toThrow();
    expect(run).toHaveBeenCalled();
  });
});
