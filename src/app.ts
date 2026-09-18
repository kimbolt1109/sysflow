import type { Config } from "@/config";
import type { Driver } from "@/domain/drivers";
import { matchRouting } from "@/domain/routing";
import type { ToolCheck } from "@/infrastructure/agentLoop";
import { DriverAgent } from "@/infrastructure/driverAgent";
import { LocalTools } from "@/infrastructure/localTools";
import { MockDriver } from "@/infrastructure/mockDriver";
import { AnthropicDriver } from "@/infrastructure/nativeAnthropic";
import { GoogleDriver } from "@/infrastructure/nativeGoogle";
import {
  createOllamaDriver,
  createOpenaiDriver,
  createOpenrouterDriver,
} from "@/infrastructure/openaiCompat";
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
  if (provider === "openai" && config.auth.openai !== undefined) {
    return createOpenaiDriver(config.defaultModel, config.auth.openai, fetchFn);
  }
  if (provider === "google" && config.auth.google !== undefined) {
    return new GoogleDriver({ apiKey: config.auth.google, model: config.defaultModel, fetchFn });
  }
  if (provider === "openrouter" && config.auth.openrouter !== undefined) {
    return createOpenrouterDriver(config.defaultModel, config.auth.openrouter, fetchFn);
  }
  if (provider === "ollama") {
    return createOllamaDriver(config.defaultModel, config.ollamaBaseUrl, fetchFn);
  }
  return undefined;
}

export function createDriverFor(config: Config, modelId: string, fetchFn?: typeof fetch): Driver {
  const scoped: Config = { ...config, defaultModel: modelId };
  return (
    nativeDriverFor(scoped, fetchFn) ??
    new MockDriver(`${modelId} (mock: no key, M6 adds CLI passthrough)`)
  );
}

export function createDriverAgents(
  app: FlowApp,
  modelIds: string[],
  check: ToolCheck,
): DriverAgent[] {
  return modelIds.map(
    (id) => new DriverAgent(id, createDriverFor(app.config, id), app.tools, check),
  );
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
