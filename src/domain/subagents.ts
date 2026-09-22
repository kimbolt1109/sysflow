import { fieldAsList, fieldAsString, parseFrontmatter } from "@/domain/frontmatter.js";

export interface SubagentDef {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  driver?: string;
  prompt: string;
  source: string;
}

export function parseSubagentMd(text: string, source: string): SubagentDef {
  const { fields, body } = parseFrontmatter(text);
  const name = fieldAsString(fields, "name");
  if (name === "") throw new Error(`subagent ${source} is missing frontmatter "name"`);
  const model = fieldAsString(fields, "model");
  const driver = fieldAsString(fields, "driver");
  return {
    name,
    description: fieldAsString(fields, "description"),
    tools: fieldAsList(fields, "tools"),
    model: model === "" ? undefined : model,
    driver: driver === "" ? undefined : driver,
    prompt: body.trim(),
    source,
  };
}

export function subagentListing(defs: SubagentDef[]): string {
  if (defs.length === 0) return "(no subagents defined)";
  return defs.map((d) => `- ${d.name}: ${d.description || "(no description)"}`).join("\n");
}
