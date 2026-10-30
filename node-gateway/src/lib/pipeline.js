export function normalizeAnalysis(response) {
  return {
    symbol: response.symbol,
    asOf: response.asOf,
    lastClose: response.lastClose,
    latest: response.latest ?? {},
    forecast: response.forecast
      ? {
          slope: response.forecast.slope,
          intercept: response.forecast.intercept,
          rSquared: response.forecast.rSquared,
          values: response.forecast.values ?? [],
          direction: response.forecast.direction,
          window: response.forecast.window,
        }
      : null,
    signals: (response.signals ?? []).map((signal) => ({
      symbol: signal.symbol,
      openTime: signal.openTime,
      kind: signal.kind,
      severity: signal.severity,
      message: signal.message,
      value: signal.value,
    })),
    series: (response.series ?? []).map((series) => ({
      name: series.name,
      points: series.points ?? [],
      upper: series.upper ?? [],
      lower: series.lower ?? [],
    })),
    receivedAt: new Date().toISOString(),
  };
}

export class AnalysisPipeline {
  constructor({ analytics, store, hub, alerts, logger, maxCandles }) {
    this.analytics = analytics;
    this.store = store;
    this.hub = hub;
    this.alerts = alerts;
    this.logger = logger;
    this.maxCandles = maxCandles;
    this.latest = new Map();
    this.inFlight = new Map();
  }

  async onTick(symbol, tick, source = "demo") {
    const { candle, previous } = this.store.applyTick(symbol, tick);
    this.hub.publish({ type: "price", symbol, candle, source });
    if (previous) {
      await this.analyze(symbol).catch((error) => {
        this.logger.warn({ err: error, symbol }, "analysis after candle close failed");
      });
    }
    return candle;
  }

  async ingestCandle(symbol, candle) {
    const stored = this.store.applyCandle(symbol, candle);
    this.hub.publish({ type: "price", symbol, candle: stored, source: "ingest" });
    if (this.store.series(symbol).length >= 2) {
      return this.analyze(symbol);
    }
    return null;
  }

  async analyze(symbol) {
    if (this.inFlight.has(symbol)) {
      return this.inFlight.get(symbol);
    }
    const task = this.#analyzeOnce(symbol).finally(() => {
      this.inFlight.delete(symbol);
    });
    this.inFlight.set(symbol, task);
    return task;
  }

  async #analyzeOnce(symbol) {
    const candles = this.store.series(symbol).slice(-this.maxCandles);
    if (candles.length < 2) {
      return null;
    }
    let response;
    try {
      response = await this.analytics.analyze({ symbol, candles, includeSeries: false });
    } catch (error) {
      this.logger.warn({ err: error, symbol }, "analytics engine call failed");
      this.hub.publish({
        type: "analytics.unavailable",
        symbol,
        message: "analytics engine did not respond",
      });
      throw error;
    }

    const analysis = normalizeAnalysis(response);
    this.latest.set(symbol, { ...analysis, series: [] });
    this.hub.publish({ type: "analysis", symbol, analysis: this.latest.get(symbol) });

    for (const signal of analysis.signals) {
      if (this.alerts.add(signal)) {
        this.hub.publish({ type: "alert", symbol, signal });
      }
    }
    return this.latest.get(symbol);
  }

  snapshot(symbol) {
    return this.latest.get(symbol) ?? null;
  }
}
