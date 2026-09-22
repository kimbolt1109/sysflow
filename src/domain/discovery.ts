import type { ModelInfo } from "@/domain/models.js";

export interface DiscoveredModel {
  id: string;
  provider: string;
  label?: string;
  contextWindow?: number;
  inputPricePerM?: number;
  outputPricePerM?: number;
  source: string;
  cliModel?: string;
  free?: boolean;
}

export function mergeModels(registry: ModelInfo[], discovered: DiscoveredModel[]): ModelInfo[] {
  const merged = new Map<string, ModelInfo>();
  for (const model of registry) {
    merged.set(model.id, { ...model });
  }
  for (const found of discovered) {
    const existing = merged.get(found.id);
    if (existing === undefined) {
      merged.set(found.id, {
        id: found.id,
        provider: found.provider,
        label: found.label ?? found.id,
        contextWindow: found.contextWindow ?? 128000,
        inputPricePerM: found.inputPricePerM ?? 0,
        outputPricePerM: found.outputPricePerM ?? 0,
        tags: found.free === true ? [found.source, "free"] : [found.source],
        source: found.source,
        cliModel: found.cliModel,
      });
      continue;
    }
    if (existing.source === undefined) {
      existing.source = "registry";
    }
    if (found.label !== undefined && found.label !== "") {
      existing.label = found.label;
    }
    if (existing.contextWindow <= 0 && found.contextWindow !== undefined) {
      existing.contextWindow = found.contextWindow;
    }
    if (existing.inputPricePerM <= 0 && found.inputPricePerM !== undefined) {
      existing.inputPricePerM = found.inputPricePerM;
    }
    if (existing.outputPricePerM <= 0 && found.outputPricePerM !== undefined) {
      existing.outputPricePerM = found.outputPricePerM;
    }
    if (found.cliModel !== undefined && existing.cliModel === undefined) {
      existing.cliModel = found.cliModel;
    }
    if (found.free === true && !existing.tags.includes("free")) {
      existing.tags = [...existing.tags, "free"];
    }
    if (!existing.tags.includes(found.source)) {
      existing.tags = [...existing.tags, found.source];
    }
  }
  return [...merged.values()];
}
