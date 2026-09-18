export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_WEIGHT;
}

export function createLogger(level: string): Logger {
  const threshold = LEVEL_WEIGHT[isLogLevel(level) ? level : "info"];

  const write = (lvl: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[lvl] < threshold) return;
    const line = JSON.stringify({
      level: lvl,
      time: new Date().toISOString(),
      message,
      ...fields,
    });
    if (lvl === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
