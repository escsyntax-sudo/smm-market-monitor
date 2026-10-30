import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";

import { marketRoutes } from "./routes/market.js";
import { websocketRoutes } from "./routes/ws.js";

export async function buildApp({
  config,
  store,
  pipeline,
  alerts,
  analytics,
  hub,
  enableRateLimit = true,
  logger = true,
}) {
  const app = Fastify({
    logger: logger ? { level: config.logLevel } : false,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigin });
  if (enableRateLimit) {
    await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  }
  await app.register(websocket);

  app.decorate("hub", hub);
  app.decorate("pipeline", pipeline);
  await app.register(marketRoutes, { config, store, pipeline, alerts, analytics });
  await app.register(websocketRoutes, { hub, store });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        error: "invalid_request",
        details: error.validation.map((item) => ({
          path: item.instancePath || item.params?.missingProperty || "",
          message: item.message,
        })),
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.code ?? "request_failed" });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });

  return app;
}
