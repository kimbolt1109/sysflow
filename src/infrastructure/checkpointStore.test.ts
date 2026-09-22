import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Checkpoint } from "@/domain/checkpoints.js";
import { LocalTools } from "@/infrastructure/localTools.js";
import {
  checkpointDir,
  listCheckpoints,
  restoreCheckpoint,
  saveCheckpoint,
  snapshotCheckpoint,
} from "@/infrastructure/checkpointStore.js";

describe("checkpointStore", () => {
  let dir = "";
  let tools: LocalTools;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flow-ckpt-"));
    tools = new LocalTools(join(dir, "proj"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("snapshots and restores workspace files", async () => {
    await tools.write("a.txt", "v1");

    const checkpoint = await snapshotCheckpoint(randomUUID(), tools, "before");
    const cdir = checkpointDir(join(dir, "data"), join(dir, "proj"), "s1");
    saveCheckpoint(cdir, checkpoint);

    await tools.write("a.txt", "v2");
    await tools.write("b.txt", "new");

    const listed = listCheckpoints(cdir);
    expect(listed).toHaveLength(1);
    const first = listed[0] as Checkpoint | undefined;
    if (first === undefined) throw new Error("expected a checkpoint");
    const touched = await restoreCheckpoint(tools, first);

    expect((await tools.read("a.txt")).output).toBe("v1");
    expect(touched).toContain("a.txt");
  });
});
