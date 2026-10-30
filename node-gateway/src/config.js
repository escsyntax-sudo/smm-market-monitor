import path from "node:path";

function readInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readSymbols(value, fallback) {
  const symbols = String(value ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length > 0 ? symbols : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: readInt(process.env.PORT, 8090),
  host: process.env.HOST ?? "0.0.0.0",
  engineUrl: process.env.SMM_ENGINE_URL ?? "127.0.0.1:50051",
  protoPath: path.resolve(
    process.env.PROTO_PATH ?? "../proto/smm/v1/market.proto",
  ),
  demoFeed: readBool(process.env.DEMO_FEED, true),
  demoTickMs: readInt(process.env.DEMO_TICK_MS, 1000),
  demoCandleMs: readInt(process.env.DEMO_CANDLE_MS, 15000),
  demoSymbols: readSymbols(process.env.DEMO_SYMBOLS, ["BTC-USD", "ETH-USD", "SOL-USD"]),
  apiKey: process.env.SMM_API_KEY?.trim() || null,
  maxCandles: readInt(process.env.MAX_CANDLES, 600),
  alertBuffer: readInt(process.env.ALERT_BUFFER, 500),
  corsOrigin: process.env.CORS_ORIGIN?.trim() ? process.env.CORS_ORIGIN : false,
  logLevel: process.env.LOG_LEVEL ?? "info",
};

if (config.nodeEnv === "production" && !config.apiKey) {
  throw new Error("SMM_API_KEY must be set when NODE_ENV=production");
}
