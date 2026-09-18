export interface Theme {
  name: string;
  agentColors: string[];
  truecolor: boolean;
}

export const THEMES: Theme[] = [
  { name: "default", agentColors: ["36", "35", "32", "33", "34", "31"], truecolor: false },
  { name: "dark", agentColors: ["96", "95", "92", "93", "94", "91"], truecolor: true },
  { name: "light", agentColors: ["36", "35", "32", "33", "34", "31"], truecolor: false },
  { name: "high-contrast", agentColors: ["97", "93", "92", "96", "95", "91"], truecolor: true },
];

export function themeByName(name: string): Theme | undefined {
  return THEMES.find((t) => t.name === name);
}

export function detectTheme(env: NodeJS.ProcessEnv): { theme: Theme; color: boolean } {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return { theme: THEMES[0] as Theme, color: false };
  }
  const wantsTruecolor = env.COLORTERM === "truecolor" || env.COLORTERM === "24bit";
  const name = env.FLOW_THEME ?? (wantsTruecolor ? "dark" : "default");
  return { theme: themeByName(name) ?? (THEMES[0] as Theme), color: true };
}

export function badgeWith(theme: Theme, color: boolean, name: string, index: number): string {
  if (!color) return `[${name}]`;
  const code = theme.agentColors[index % theme.agentColors.length] ?? "37";
  return `\x1b[${code}m[${name}]\x1b[0m`;
}
