import { describe, expect, it } from "vitest";
import { badgeWith, detectTheme, themeByName, THEMES } from "@/api/theming";

describe("theming", () => {
  it("ships presets", () => {
    expect(THEMES.map((t) => t.name)).toContain("high-contrast");
    expect(themeByName("nope")).toBeUndefined();
  });

  it("detects truecolor and NO_COLOR", () => {
    expect(detectTheme({ COLORTERM: "truecolor" }).theme.name).toBe("dark");
    expect(detectTheme({ NO_COLOR: "1" }).color).toBe(false);
    expect(detectTheme({}).theme.name).toBe("default");
  });

  it("renders badges per theme", () => {
    const theme = themeByName("default");
    if (theme === undefined) throw new Error("missing default theme");

    expect(badgeWith(theme, true, "a", 0)).toContain("[a]");
    expect(badgeWith(theme, false, "a", 0)).toBe("[a]");
  });
});
