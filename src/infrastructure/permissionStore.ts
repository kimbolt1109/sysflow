import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRule, type PermissionRule } from "@/domain/permissions.js";

interface PermissionFile {
  permissions?: { allow?: unknown; deny?: unknown; ask?: unknown };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function loadFile(path: string): PermissionRule[] {
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`invalid JSON in ${path}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`invalid settings in ${path} (want an object)`);
  }
  const perms = (parsed as PermissionFile).permissions ?? {};
  const rules: PermissionRule[] = [];
  for (const text of stringList(perms.allow)) rules.push(parseRule(text, "allow"));
  for (const text of stringList(perms.deny)) rules.push(parseRule(text, "deny"));
  for (const text of stringList(perms.ask)) rules.push(parseRule(text, "ask"));
  return rules;
}

export function settingsLocalPath(projectDir: string): string {
  return join(projectDir, ".flow", "settings.local.json");
}

export function loadPermissionRules(dataDir: string, projectDir: string): PermissionRule[] {
  return [
    ...loadFile(join(dataDir, "settings.json")),
    ...loadFile(join(projectDir, ".flow", "settings.json")),
    ...loadFile(settingsLocalPath(projectDir)),
  ];
}

export function ruleText(rule: PermissionRule): string {
  return `${rule.tool}(${rule.pattern})`;
}

export function saveRule(projectDir: string, rule: PermissionRule): void {
  const path = settingsLocalPath(projectDir);
  let parsed: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`invalid JSON in ${path}`);
    }
  }
  const perms =
    typeof parsed.permissions === "object" && parsed.permissions !== null
      ? (parsed.permissions as Record<string, unknown>)
      : {};
  const key = rule.decision;
  const list = stringList(perms[key]);
  const text = ruleText(rule);
  if (!list.includes(text)) list.push(text);
  mkdirSync(join(projectDir, ".flow"), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ ...parsed, permissions: { ...perms, [key]: list } }, null, 2)}\n`,
    "utf8",
  );
}

export function saveAlwaysAllow(projectDir: string, rule: PermissionRule): void {
  saveRule(projectDir, { ...rule, decision: "allow" });
}
