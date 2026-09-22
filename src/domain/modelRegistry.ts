import type { ModelInfo } from "@/domain/models.js";

export function listModels(models: ModelInfo[]): ModelInfo[] {
  return [...models];
}

export function findModel(models: ModelInfo[], id: string): ModelInfo | undefined {
  return models.find((m) => m.id === id);
}

export function modelsByProvider(models: ModelInfo[]): Map<string, ModelInfo[]> {
  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const group = groups.get(m.provider) ?? [];
    group.push(m);
    groups.set(m.provider, group);
  }
  return groups;
}

export function requireModel(models: ModelInfo[], id: string): ModelInfo {
  const found = findModel(models, id);
  if (found === undefined) {
    throw new Error(`unknown model "${id}"`);
  }
  return found;
}
