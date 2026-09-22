/** Dove — the sys companion character.
 * A terminal-native take on the Trim dove mark (canonical tone #9fbff2):
 * beak left, wing raised, forked tail trailing right.
 */

export const DOVE_NAME = "Dove";

/** Canonical logo tone from the brand SVG. */
export const DOVE_BLUE = "#9fbff2";

export const DOVE_ART: string[] = ["   __", "  /  \\__", "  \\  (o >", "   \\__/__/"];

export const DOVE_TAGLINE = "Calm, precise, and allergic to unverified work.";

export function doveGreeting(): string {
  return `${DOVE_NAME} is ready. Ask anything, or type / for commands. ${DOVE_TAGLINE}`;
}
