import { createApp } from "@/app";
import { loadConfig } from "@/config";

function main(): void {
  const config = loadConfig();
  const { app, logger } = createApp(config);
  app.listen(config.port, () => {
    logger.info("server started", { port: config.port });
  });
}

main();
