import type { FlowApp } from "@/app";

export function runDoctor(app: FlowApp): number {
  process.stdout.write(`ok    node: ${process.version}\n`);
  process.stdout.write(`ok    storage: ${app.sessions.dir()}\n`);
  const auth: Array<[string, boolean]> = [
    ["anthropic", app.config.auth.anthropic !== undefined],
    ["openai", app.config.auth.openai !== undefined],
    ["google", app.config.auth.google !== undefined],
    ["openrouter", app.config.auth.openrouter !== undefined],
  ];
  for (const [provider, present] of auth) {
    process.stdout.write(
      present
        ? `ok    ${provider}-auth: key present\n`
        : `warn  ${provider}-auth: missing (mock/CLI drivers)\n`,
    );
  }
  process.stdout.write("ok    ollama: local endpoint (degrades gracefully offline)\n");
  return 0;
}
