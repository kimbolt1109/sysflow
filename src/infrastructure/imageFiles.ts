import { readFileSync } from "node:fs";

export interface ImagePart {
  mime: string;
  base64: string;
}

const MAX_IMAGES = 5;

function mimeFor(path: string): string {
  if (path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (path.toLowerCase().endsWith(".webp")) return "image/webp";
  if (path.toLowerCase().endsWith(".gif")) return "image/gif";
  return "image/png";
}

export function loadImageParts(paths: string[] | undefined): ImagePart[] {
  if (paths === undefined || paths.length === 0) return [];
  const out: ImagePart[] = [];
  for (const path of paths.slice(0, MAX_IMAGES)) {
    try {
      out.push({ mime: mimeFor(path), base64: readFileSync(path).toString("base64") });
    } catch {
      continue;
    }
  }
  return out;
}
