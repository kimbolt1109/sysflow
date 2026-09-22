import {
  fieldAsBoolean,
  fieldAsList,
  fieldAsString,
  parseFrontmatter,
} from "@/domain/frontmatter.js";

export interface SkillDef {
  name: string;
  description: string;
  allowedTools: string[];
  userInvocable: boolean;
  disableModelInvocation: boolean;
  source: string;
}

export function parseSkillMd(text: string, source: string): SkillDef {
  const { fields } = parseFrontmatter(text);
  const name = fieldAsString(fields, "name");
  if (name === "") throw new Error(`skill ${source} is missing frontmatter "name"`);
  return {
    name,
    description: fieldAsString(fields, "description"),
    allowedTools: fieldAsList(fields, "allowed-tools"),
    userInvocable: fieldAsBoolean(fields, "user-invocable", true),
    disableModelInvocation: fieldAsBoolean(fields, "disable-model-invocation", false),
    source,
  };
}

export function skillListing(skills: SkillDef[]): string {
  if (skills.length === 0) return "(no skills installed)";
  return skills
    .map(
      (s) =>
        `- ${s.name}: ${s.description || "(no description)"}${s.userInvocable ? "" : " (not directly runnable)"}`,
    )
    .join("\n");
}
