import type { Config } from "@/config";
import type { Driver } from "@/domain/drivers";
import { matchRouting } from "@/domain/routing";
import { LocalTools } from "@/infrastructure/localTools";
import { MockDriver } from "@/infrastructure/mockDriver";
import { AnthropicDriver } from "@/infrastructure/nativeAnthropic";
import { SessionStore } from "@/infrastructure/sessionStore";
import { createLogger, type Logger } from "@/lib/logger";

export interface FlowApp {
  config: Config;
  logger: Logger;
  driver: Driver;
  tools: LocalTools;
  sessions: SessionStore;
}

function nativeDriverFor(config: Config, fetchFn?: typeof fetch): Driver | undefined {
  const provider = config.defaultModel.split("/")[0] ?? "";
  if (provider === "anthropic" && config.auth.anthropic !== undefined) {
    return new AnthropicDriver({
      apiKey: config.auth.anthropic,
      model: config.defaultModel,
      fetchFn,
    });
  }
  return undefined;
}

export function createApp(
  config: Config,
  overrides: { driver?: Driver; fetchFn?: typeof fetch } = {},
): FlowApp {
  const logger = createLogger(config.logLevel);
  const rule = matchRouting(config.routing, config.defaultModel);
  const driver =
    overrides.driver ??
    nativeDriverFor(config, overrides.fetchFn) ??
    new MockDriver(
      rule.driver === "native"
        ? config.defaultModel
        : `${config.defaultModel} (mock: no key, M6 adds CLI passthrough)`,
    );
  const tools = new LocalTools(config.projectDir);
  const sessions = new SessionStore(config.dataDir, config.projectDir);
  logger.debug("app created", { model: config.defaultModel, driver: driver.id });
  return { config, logger, driver, tools, sessions };
}
