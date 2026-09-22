import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadImageParts } from "@/infrastructure/imageFiles.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("imageFiles", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-img-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads png files as base64 parts", () => {
    const path = join(dir, "shot.png");
    writeFileSync(path, PNG);

    const parts = loadImageParts([path]);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.mime).toBe("image/png");
    expect(parts[0]?.base64).toBe(PNG.toString("base64"));
  });

  it("skips missing files and caps the count", () => {
    const paths = Array.from({ length: 7 }, (_, i) => {
      const path = join(dir, `s${i}.png`);
      writeFileSync(path, PNG);
      return path;
    });

    expect(loadImageParts([join(dir, "missing.png")])).toEqual([]);
    expect(loadImageParts(undefined)).toEqual([]);
    expect(loadImageParts(paths)).toHaveLength(5);
  });
});
