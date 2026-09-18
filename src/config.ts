export interface Config {
  port: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.APP_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`APP_PORT must be an integer between 0 and 65535, got "${env.APP_PORT}"`);
  }
  return {
    port,
    logLevel: env.APP_LOG_LEVEL ?? "info",
  };
}
