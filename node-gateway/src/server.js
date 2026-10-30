import { config } from "./config.js";
import { buildApp } from "./app.js";
import { createAnalyticsClient } from "./lib/analytics-client.js";
import { CandleStore } from "./lib/candles.js";
import { Hub } from "./lib/hub.js";
import { AlertLog } from "./lib/alerts.js";
import { AnalysisPipeline } from "./lib/pipeline.js";
import { DemoFeed } from "./feed/demo-feed.js";

async function main() {
  const analytics = createAnalyticsClient({
    address: config.engineUrl,
    protoPath: config.protoPath,
  });
  const store = new CandleStore({ maxCandles: config.maxCandles, intervalMs: config.demoCandleMs });
  const hub = new Hub();
  const alerts = new AlertLog(config.alertBuffer);
  const pipeline = new AnalysisPipeline({
    analytics,
    store,
    hub,
    alerts,
    logger: { warn: (...args) => console.warn(...args), info: (...args) => console.info(...args) },
    maxCandles: config.maxCandles,
  });

  const app = await buildApp({
    config,
    store,
    hub,
    alerts,
    analytics,
    pipeline,
  });
  pipeline.logger = app.log;

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ engine: config.engineUrl }, "smm gateway listening");

  let feed = null;
  if (config.demoFeed) {
    feed = new DemoFeed({
      symbols: config.demoSymbols,
      tickMs: config.demoTickMs,
      logger: app.log,
      onTick: (symbol, tick) => pipeline.onTick(symbol, tick),
    });
    feed.start();
  }

  const shutdown = async (signal) => {
    app.log.info({ signal }, "shutting down");
    feed?.stop();
    await app.close();
    analytics.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
