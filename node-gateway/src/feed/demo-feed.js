import { createHash } from "node:crypto";

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function basePrice(symbol) {
  const known = { "BTC-USD": 64000, "ETH-USD": 3200, "SOL-USD": 150 };
  if (known[symbol]) {
    return known[symbol];
  }
  const digest = createHash("sha256").update(symbol).digest();
  return 20 + digest.readUInt16BE(0) / 4;
}

export class DemoFeed {
  constructor({ symbols, tickMs, onTick, logger }) {
    this.symbols = symbols;
    this.tickMs = tickMs;
    this.onTick = onTick;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.state = new Map(
      symbols.map((symbol) => {
        const seed = createHash("sha256").update(symbol).digest().readUInt32BE(0);
        return [symbol, { price: basePrice(symbol), random: mulberry32(seed) }];
      }),
    );
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => this.#step(), this.tickMs);
    this.timer.unref?.();
    this.logger.info({ symbols: this.symbols, tickMs: this.tickMs }, "demo feed started");
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async #step() {
    for (const symbol of this.symbols) {
      const state = this.state.get(symbol);
      const drift = 0.00002;
      const volatility = 0.0016;
      const shock = this.#gaussian(state.random);
      state.price = Math.max(0.01, state.price * Math.exp(drift - 0.5 * volatility ** 2 + volatility * shock));
      const volume = Math.round((0.4 + state.random() * 2.4) * 100) / 100;
      try {
        await this.onTick(symbol, {
          price: Math.round(state.price * 100) / 100,
          volume,
          timestamp: Date.now(),
        });
      } catch (error) {
        this.logger.warn({ err: error, symbol }, "demo tick failed");
      }
    }
  }

  #gaussian(random) {
    const u = Math.max(random(), Number.EPSILON);
    const v = Math.max(random(), Number.EPSILON);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
