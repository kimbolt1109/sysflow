import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import type { Config } from "@/config";
import { healthRouter } from "@/api/routes/health";
import { itemsRouter } from "@/api/routes/items";
import { ItemService } from "@/domain/items";
import { InMemoryItemsRepo } from "@/infrastructure/itemsRepo";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export interface App {
  app: Express;
  logger: Logger;
}

export function createApp(config: Config): App {
  const logger = createLogger(config.logLevel);
  const repo = new InMemoryItemsRepo();
  const service = new ItemService(repo);

  const app = express();
  app.use(express.json());
  app.use(healthRouter());
  app.use(itemsRouter(service));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "route not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error("unhandled error", {
      detail: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal server error" });
  });

  return { app, logger };
}
