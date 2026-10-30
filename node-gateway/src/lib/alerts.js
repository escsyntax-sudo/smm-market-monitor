export class AlertLog {
  constructor(limit = 500) {
    this.limit = limit;
    this.items = [];
  }

  add(signal) {
    const duplicate = this.items.some(
      (item) =>
        item.symbol === signal.symbol &&
        item.kind === signal.kind &&
        item.openTime === signal.openTime,
    );
    if (duplicate) {
      return false;
    }
    this.items.unshift({ ...signal, receivedAt: new Date().toISOString() });
    if (this.items.length > this.limit) {
      this.items.length = this.limit;
    }
    return true;
  }

  list({ symbol, limit = 50 } = {}) {
    const filtered = symbol ? this.items.filter((item) => item.symbol === symbol) : this.items;
    return filtered.slice(0, Math.min(Math.max(limit, 1), this.limit));
  }
}
