export interface Frontmatter {
  fields: Record<string, string | string[]>;
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const fields: Record<string, string | string[]> = {};
  if (!text.startsWith("---")) return { fields, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { fields, body: text };
  const head = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\n/, "");
  let current: string | undefined;
  for (const raw of head.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*-\s+/.test(line) && current !== undefined) {
      const item = line
        .replace(/^\s*-\s+/, "")
        .trim()
        .replace(/^["']|["']$/g, "");
      const prev = fields[current];
      if (Array.isArray(prev)) prev.push(item);
      else if (typeof prev === "string") fields[current] = [prev, item];
      else fields[current] = [item];
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (match === null) {
      current = undefined;
      continue;
    }
    const key = (match[1] as string).trim();
    const value = (match[2] as string).trim().replace(/^["']|["']$/g, "");
    current = key;
    if (value !== "") fields[key] = value;
    else if (fields[key] === undefined) fields[key] = [];
  }
  return { fields, body };
}

export function fieldAsString(fields: Record<string, string | string[]>, key: string): string {
  const value = fields[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return "";
}

export function fieldAsList(fields: Record<string, string | string[]>, key: string): string[] {
  const value = fields[key];
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  if (Array.isArray(value)) return value;
  return [];
}

export function fieldAsBoolean(
  fields: Record<string, string | string[]>,
  key: string,
  fallback: boolean,
): boolean {
  const value = fields[key];
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "true" || text === "yes" || text === "1") return true;
  if (text === "false" || text === "no" || text === "0") return false;
  return fallback;
}
