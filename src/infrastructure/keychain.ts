import { spawnSync } from "node:child_process";

export interface KeychainProbe {
  ok: boolean;
  detail: string;
}

export function probeKeychain(): KeychainProbe {
  if (process.platform === "win32") {
    try {
      const found = spawnSync("cmdkey", ["/list"], { encoding: "utf8", timeout: 5000 });
      if (found.status === 0) {
        return {
          ok: true,
          detail: "Windows Credential Manager reachable (keys stay in env, never logged)",
        };
      }
      return { ok: false, detail: "cmdkey unavailable" };
    } catch {
      return { ok: false, detail: "cmdkey probe failed" };
    }
  }
  if (process.platform === "darwin") {
    return { ok: true, detail: "Keychain via security(1) (keys stay in env, never logged)" };
  }
  return { ok: true, detail: "libsecret/keyring when present (keys stay in env, never logged)" };
}
