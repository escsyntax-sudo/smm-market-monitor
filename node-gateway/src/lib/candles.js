export class CandleStore {
  constructor({ maxCandles = 600, intervalMs = 60_000 } = {}) {
    this.maxCandles = maxCandles;
    this.intervalMs = intervalMs;
    this.symbols = new Map();
  }

  series(symbol) {
    return this.symbols.get(symbol) ?? [];
  }

  last(symbol) {
    const series = this.series(symbol);
    return series[series.length - 1] ?? null;
  }

  list() {
    return [...this.symbols.entries()].map(([symbol, candles]) => ({
      symbol,
      lastClose: candles[candles.length - 1]?.close ?? null,
      candles: candles.length,
      updatedAt: candles[candles.length - 1]?.openTime ?? null,
    }));
  }

  applyTick(symbol, { price, volume = 0, timestamp = Date.now() }) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("price must be a positive number");
    }
    const openTime = Math.floor(timestamp / this.intervalMs) * this.intervalMs;
    const series = this.symbols.get(symbol) ?? [];
    const current = series[series.length - 1];

    if (!current || openTime > current.openTime) {
      const candle = {
        openTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: Math.max(0, Number(volume) || 0),
      };
      series.push(candle);
      this._trim(series);
      this.symbols.set(symbol, series);
      return { candle, previous: current ?? null, started: true };
    }

    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
    current.volume += Math.max(0, Number(volume) || 0);
    return { candle: current, previous: null, started: false };
  }

  applyCandle(symbol, candle) {
    if (!Number.isFinite(candle.close) || candle.close <= 0) {
      throw new Error("candle close must be a positive number");
    }
    if (
      candle.high < candle.low ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close)
    ) {
      throw new Error("candle prices fall outside the high and low");
    }
    const series = this.symbols.get(symbol) ?? [];
    const existing = series.findIndex((item) => item.openTime === candle.openTime);
    if (existing >= 0) {
      series[existing] = { ...series[existing], ...candle };
    } else {
      series.push({ ...candle });
      series.sort((a, b) => a.openTime - b.openTime);
    }
    this._trim(series);
    this.symbols.set(symbol, series);
    return series.find((item) => item.openTime === candle.openTime);
  }

  _trim(series) {
    if (series.length > this.maxCandles) {
      series.splice(0, series.length - this.maxCandles);
    }
  }
}
