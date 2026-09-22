import { readFileSync, statSync } from "node:fs";

export interface ImagePart {
  mime: string;
  base64: string;
}

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const KNOWN_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function mimeFor(path: string): string | undefined {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return undefined;
  return KNOWN_EXTENSIONS[lower.slice(dot)];
}

export function loadImageParts(paths: string[] | undefined): ImagePart[] {
  if (paths === undefined || paths.length === 0) return [];
  const out: ImagePart[] = [];
  for (const path of paths.slice(0, MAX_IMAGES)) {
    try {
      const mime = mimeFor(path);
      if (mime === undefined) continue;
      if (statSync(path).size > MAX_IMAGE_BYTES) continue;
      out.push({ mime, base64: readFileSync(path).toString("base64") });
    } catch {
      continue;
    }
  }
  return out;
}
