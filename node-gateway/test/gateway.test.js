import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { buildApp } from "../src/app.js";
import { AlertLog } from "../src/lib/alerts.js";
import { CandleStore } from "../src/lib/candles.js";
import { Hub } from "../src/lib/hub.js";
import { AnalysisPipeline } from "../src/lib/pipeline.js";

function fakeAnalytics({ fail = false } = {}) {
  return {
    calls: [],
    async analyze(request) {
      if (fail) {
        const error = new Error("engine unavailable");
        error.code = 14;
        throw error;
      }
      this.calls.push(request);
      const last = request.candles[request.candles.length - 1];
      return {
        symbol: request.symbol,
        asOf: last.openTime,
        lastClose: last.close,
        latest: { rsi: 55.2, sma_fast: last.close, sma_slow: last.close - 1 },
        forecast: {
          slope: 0.4,
          intercept: 1,
          rSquared: 0.81,
          values: [last.close + 0.4],
          direction: "up",
          window: 10,
        },
        signals: [
          {
            symbol: request.symbol,
            openTime: last.openTime,
            kind: "ma_cross_bull",
            severity: "info",
            message: "Fast moving average crossed above the slow average",
            value: last.close,
          },
        ],
        series: request.includeSeries
          ? [{ name: "close", points: [{ openTime: last.openTime, value: last.close }], upper: [], lower: [] }]
          : [],
      };
    },
    async health() {
      if (fail) {
        throw new Error("unreachable");
      }
      return { status: "ok", version: "0.1.0", analyzed: 3 };
    },
  };
}

async function makeApp({ apiKey = "secret", fail = false } = {}) {
  const analytics = fakeAnalytics({ fail });
  const store = new CandleStore({ maxCandles: 50, intervalMs: 60_000 });
  const hub = new Hub();
  const alerts = new AlertLog(20);
  const pipeline = new AnalysisPipeline({
    analytics,
    store,
    hub,
    alerts,
    logger: { warn() {}, info() {} },
    maxCandles: 50,
  });
  const config = {
    apiKey,
    demoFeed: false,
    logLevel: "silent",
    corsOrigin: false,
  };
  const app = await buildApp({
    config,
    store,
    hub,
    alerts,
    analytics,
    pipeline,
    enableRateLimit: false,
    logger: false,
  });
  await app.ready();
  return { app, analytics, store, hub, alerts, pipeline, config };
}

function candle(openTime, close, volume = 10) {
  return {
    openTime,
    open: close - 0.5,
    high: close + 0.8,
    low: close - 0.9,
    close,
    volume,
  };
}

describe("smm gateway", () => {
  it("reports engine health", async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "ok");
    assert.equal(response.json().engine.version, "0.1.0");
    await app.close();
  });

  it("returns 503 when the engine is down", async () => {
    const { app } = await makeApp({ fail: true });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().status, "degraded");
    await app.close();
  });

  it("requires the ingest key when configured", async () => {
    const { app } = await makeApp();
    const denied = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: { symbol: "BTC-USD", price: 64000 },
    });
    assert.equal(denied.statusCode, 401);

    const accepted = await app.inject({
      method: "POST",
      url: "/ingest",
      headers: { "x-api-key": "secret" },
      payload: { symbol: "BTC-USD", price: 64000, volume: 2 },
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json().accepted, "tick");

    const symbols = await app.inject({ method: "GET", url: "/symbols" });
    assert.equal(symbols.json().symbols[0].symbol, "BTC-USD");
    await app.close();
  });

  it("ingests complete candles, analyzes them and deduplicates alerts", async () => {
    const { app, analytics, alerts } = await makeApp();
    const headers = { "x-api-key": "secret" };

    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers,
        payload: { symbol: "ETH-USD", candle: candle(1_700_000_000_000 + index * 60_000, 100 + index) },
      });
      assert.equal(response.statusCode, 202);
    }
    assert.equal(analytics.calls.length, 2);
    assert.equal(alerts.list().length, 2);

    await app.inject({
      method: "POST",
      url: "/ingest",
      headers,
      payload: { symbol: "ETH-USD", candle: candle(1_700_000_120_000, 104) },
    });
    assert.equal(alerts.list().length, 2);

    const snapshot = await app.inject({ method: "GET", url: "/snapshot/eth-usd" });
    assert.equal(snapshot.statusCode, 200);
    assert.equal(snapshot.json().symbol, "ETH-USD");
    assert.equal(snapshot.json().analysis.lastClose, 104);
    assert.equal(snapshot.json().candles.length, 3);
    assert.equal(snapshot.json().alerts.length, 2);
    await app.close();
  });

  it("rejects malformed ingest payloads", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      headers: { "x-api-key": "secret" },
      payload: { symbol: "BTC-USD", candle: { openTime: 1, open: 5, high: 4, low: 1, close: 5 } },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_candle");
    await app.close();
  });

  it("proxies ad hoc analysis and surfaces engine errors", async () => {
    const { app, analytics } = await makeApp();
    const payload = {
      symbol: "SOL-USD",
      candles: [candle(1_700_000_000_000, 20), candle(1_700_000_060_000, 21)],
      includeSeries: true,
    };
    const response = await app.inject({ method: "POST", url: "/analyze", payload });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().forecast.direction, "up");
    assert.equal(analytics.calls[0].includeSeries, true);
    await app.close();

    const failing = await makeApp({ fail: true });
    const failed = await failing.app.inject({ method: "POST", url: "/analyze", payload });
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.json().error, "analytics_unavailable");
    await failing.app.close();
  });
});

describe("candle aggregation", () => {
  it("builds OHLC candles from ticks and trims old bars", () => {
    const store = new CandleStore({ maxCandles: 3, intervalMs: 60_000 });
    store.applyTick("BTC-USD", { price: 100, volume: 1, timestamp: 60_000 });
    store.applyTick("BTC-USD", { price: 105, volume: 2, timestamp: 61_000 });
    store.applyTick("BTC-USD", { price: 95, volume: 3, timestamp: 62_000 });
    const first = store.last("BTC-USD");
    assert.equal(first.open, 100);
    assert.equal(first.high, 105);
    assert.equal(first.low, 95);
    assert.equal(first.close, 95);
    assert.equal(first.volume, 6);

    store.applyTick("BTC-USD", { price: 110, timestamp: 120_000 });
    assert.equal(store.series("BTC-USD").length, 2);

    for (let index = 2; index < 7; index += 1) {
      store.applyTick("BTC-USD", { price: 120 + index, timestamp: 60_000 * (index + 1) });
    }
    assert.equal(store.series("BTC-USD").length, 3);
    assert.equal(store.last("BTC-USD").close, 126);
  });

  it("replaces an existing candle by open time", () => {
    const store = new CandleStore({ maxCandles: 10, intervalMs: 60_000 });
    store.applyCandle("ETH-USD", candle(60_000, 100));
    store.applyCandle("ETH-USD", candle(60_000, 102));
    assert.equal(store.series("ETH-USD").length, 1);
    assert.equal(store.last("ETH-USD").close, 102);
  });
});

describe("websocket hub", () => {
  it("filters symbols per client and drops closed sockets", () => {
    const hub = new Hub();
    const all = { readyState: 1, messages: [], send(payload) { this.messages.push(JSON.parse(payload)); } };
    const filtered = { readyState: 1, messages: [], send(payload) { this.messages.push(JSON.parse(payload)); } };
    const closed = { readyState: 3, send() { throw new Error("should not send"); } };

    hub.add(all);
    hub.add(filtered);
    hub.add(closed);
    hub.subscribe(filtered, ["BTC-USD"]);

    hub.publish({ type: "price", symbol: "BTC-USD", candle: { close: 1 } });
    hub.publish({ type: "price", symbol: "ETH-USD", candle: { close: 2 } });

    assert.equal(all.messages.length, 2);
    assert.equal(filtered.messages.length, 1);
    assert.equal(hub.clients.has(closed), false);
  });
});

describe("alert log", () => {
  it("deduplicates identical signals and respects the limit", () => {
    const alerts = new AlertLog(2);
    const base = { symbol: "BTC-USD", openTime: 1, kind: "rsi_overbought", severity: "warning" };
    assert.equal(alerts.add(base), true);
    assert.equal(alerts.add({ ...base }), false);
    alerts.add({ ...base, openTime: 2 });
    alerts.add({ ...base, openTime: 3 });
    assert.equal(alerts.list().length, 2);
    assert.equal(alerts.list({ symbol: "ETH-USD" }).length, 0);
  });
});
