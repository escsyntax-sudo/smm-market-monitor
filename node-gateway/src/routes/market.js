import { timingSafeEqual } from "node:crypto";

const candleSchema = {
  type: "object",
  required: ["openTime", "open", "high", "low", "close"],
  additionalProperties: false,
  properties: {
    openTime: { type: "integer", minimum: 0 },
    open: { type: "number", exclusiveMinimum: 0 },
    high: { type: "number", exclusiveMinimum: 0 },
    low: { type: "number", exclusiveMinimum: 0 },
    close: { type: "number", exclusiveMinimum: 0 },
    volume: { type: "number", minimum: 0 },
  },
};

const analyzeSchema = {
  type: "object",
  required: ["symbol", "candles"],
  additionalProperties: false,
  properties: {
    symbol: { type: "string", minLength: 1, maxLength: 32 },
    candles: { type: "array", minItems: 2, maxItems: 1000, items: candleSchema },
    includeSeries: { type: "boolean" },
    config: {
      type: "object",
      additionalProperties: false,
      properties: {
        rsiPeriod: { type: "integer", minimum: 2, maximum: 100 },
        bollingerPeriod: { type: "integer", minimum: 2, maximum: 200 },
        bollingerStddev: { type: "number", minimum: 0.1, maximum: 10 },
        fastMa: { type: "integer", minimum: 2, maximum: 200 },
        slowMa: { type: "integer", minimum: 3, maximum: 500 },
        forecastWindow: { type: "integer", minimum: 3, maximum: 500 },
        forecastHorizon: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
};

function secureEquals(provided, expected) {
  const left = Buffer.from(String(provided ?? ""));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function grpcStatus(error) {
  return typeof error?.code === "number" ? error.code : 2;
}

export async function marketRoutes(app, { config, store, pipeline, alerts, analytics }) {
  const requireApiKey = async (request, reply) => {
    if (!config.apiKey) {
      return;
    }
    if (!secureEquals(request.headers["x-api-key"], config.apiKey)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };

  app.get("/symbols", async () => ({ symbols: store.list() }));

  app.get("/snapshot/:symbol", async (request, reply) => {
    const symbol = String(request.params.symbol).toUpperCase();
    const candles = store.series(symbol);
    if (candles.length === 0) {
      return reply.code(404).send({ error: "unknown_symbol" });
    }
    return reply.send({
      symbol,
      source: config.demoFeed ? "demo" : "ingest",
      candles: candles.slice(-120),
      analysis: pipeline.snapshot(symbol),
      alerts: alerts.list({ symbol, limit: 20 }),
    });
  });

  app.get("/alerts", async (request) => {
    const symbol = request.query.symbol ? String(request.query.symbol).toUpperCase() : undefined;
    const limit = Number.parseInt(request.query.limit ?? "50", 10) || 50;
    return { alerts: alerts.list({ symbol, limit }) };
  });

  app.post(
    "/ingest",
    {
      preHandler: requireApiKey,
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const body = request.body ?? {};
      const symbol = String(body.symbol ?? "").trim().toUpperCase();
      if (!symbol || symbol.length > 32) {
        return reply.code(400).send({ error: "invalid_symbol" });
      }

      if (body.candle) {
        const candle = body.candle;
        if (
          !Number.isFinite(candle.openTime) ||
          !Number.isFinite(candle.open) ||
          !Number.isFinite(candle.high) ||
          !Number.isFinite(candle.low) ||
          !Number.isFinite(candle.close) ||
          candle.low <= 0 ||
          candle.high < candle.low ||
          candle.high < Math.max(candle.open, candle.close) ||
          candle.low > Math.min(candle.open, candle.close)
        ) {
          return reply.code(400).send({ error: "invalid_candle" });
        }
        const analysis = await pipeline.ingestCandle(symbol, {
          openTime: candle.openTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: Number(candle.volume) || 0,
        });
        return reply.code(202).send({ symbol, accepted: "candle", analysis });
      }

      if (!Number.isFinite(body.price) || body.price <= 0) {
        return reply.code(400).send({ error: "price_required" });
      }
      const candle = await pipeline.onTick(
        symbol,
        {
          price: body.price,
          volume: Number(body.volume) || 0,
          timestamp: Number.isFinite(body.timestamp) ? body.timestamp : Date.now(),
        },
        "ingest",
      );
      return reply.code(202).send({ symbol, accepted: "tick", candle });
    },
  );

  app.post(
    "/analyze",
    {
      schema: { body: analyzeSchema },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { symbol, candles, includeSeries, config: overrides } = request.body;
      try {
        const response = await analytics.analyze({
          symbol,
          candles,
          includeSeries: includeSeries ?? false,
          config: overrides ?? {},
        });
        return reply.send(response);
      } catch (error) {
        const status = grpcStatus(error);
        if (status === 3) {
          return reply.code(400).send({ error: "invalid_candles", message: error.details });
        }
        request.log.warn({ err: error, symbol }, "analytics call failed");
        return reply.code(502).send({ error: "analytics_unavailable" });
      }
    },
  );

  app.get("/healthz", async (request, reply) => {
    try {
      const engine = await analytics.health(1500);
      return reply.send({ status: "ok", engine, websocketClients: app.hub?.size ?? 0 });
    } catch (error) {
      request.log.warn({ err: error }, "engine health check failed");
      return reply.code(503).send({
        status: "degraded",
        engine: { status: "unreachable" },
      });
    }
  });
}
