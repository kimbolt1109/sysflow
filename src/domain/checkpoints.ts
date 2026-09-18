export interface Checkpoint {
  id: string;
  at: string;
  label: string;
  files: Record<string, string | null>;
}

export function takeCheckpoint(
  id: string,
  label: string,
  entries: Array<{ path: string; content: string | null }>,
): Checkpoint {
  const files: Record<string, string | null> = {};
  for (const entry of entries) files[entry.path] = entry.content;
  return { id, at: new Date().toISOString(), label, files };
}

export interface RestorePlan {
  write: Array<{ path: string; content: string }>;
  remove: string[];
}

export function planRestore(checkpoint: Checkpoint): RestorePlan {
  const plan: RestorePlan = { write: [], remove: [] };
  for (const [path, content] of Object.entries(checkpoint.files)) {
    if (content === null) plan.remove.push(path);
    else plan.write.push({ path, content });
  }
  plan.remove.sort();
  plan.write.sort((a, b) => (a.path < b.path ? -1 : 1));
  return plan;
}

export function describeCheckpoint(checkpoint: Checkpoint): string {
  const count = Object.keys(checkpoint.files).length;
  return `${checkpoint.id.slice(0, 8)} · ${checkpoint.at} · ${checkpoint.label} · ${count} files`;
}
