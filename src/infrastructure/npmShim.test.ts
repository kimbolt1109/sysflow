import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { npmShimTarget, parseCmdShim } from "@/infrastructure/npmShim.js";

const EXE_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
  "",
].join("\r\n");

const NODE_SHIM = [
  "@ECHO off",
  "SETLOCAL",
  "CALL :find_dp0",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  ")",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*',
  "",
].join("\r\n");

describe("npmShim", () => {
  it("resolves an exe shim to the binary it wraps", () => {
    expect(parseCmdShim(EXE_SHIM, "C:\\npm")).toEqual({
      file: join("C:\\npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
      prefix: [],
    });
  });

  it("resolves a node-script shim to node plus the script", () => {
    expect(parseCmdShim(NODE_SHIM, "C:\\npm", "C:\\node\\node.exe")).toEqual({
      file: "C:\\node\\node.exe",
      prefix: [join("C:\\npm", "node_modules", "pkg", "cli.js")],
    });
  });

  it("ignores files that are not npm shims", () => {
    expect(parseCmdShim("@echo off\r\necho hi\r\n", "C:\\npm")).toBeUndefined();
  });

  it("finds the target from a .ps1 path via its sibling .cmd", () => {
    const dir = mkdtempSync(join(tmpdir(), "shim-"));
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "cli.js"), "");
    writeFileSync(join(dir, "tool.cmd"), NODE_SHIM);
    writeFileSync(join(dir, "tool.ps1"), "# ps shim");

    const target = npmShimTarget(join(dir, "tool.ps1"));

    expect(target?.prefix).toEqual([join(dir, "node_modules", "pkg", "cli.js")]);
    expect(npmShimTarget(join(dir, "missing.cmd"))).toBeUndefined();
    expect(npmShimTarget(join(dir, "tool.exe"))).toBeUndefined();
  });
});
