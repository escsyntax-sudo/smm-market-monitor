from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MAX_SERIES_POINTS = 300


@dataclass(frozen=True)
class Bar:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class IndicatorConfig:
    rsi_period: int = 14
    bollinger_period: int = 20
    bollinger_stddev: float = 2.0
    fast_ma: int = 9
    slow_ma: int = 21
    forecast_window: int = 30
    forecast_horizon: int = 5

    def validated(self) -> "IndicatorConfig":
        fast = min(max(self.fast_ma, 2), 200)
        slow = min(max(self.slow_ma, fast + 1), 500)
        window = min(max(self.forecast_window, 3), 500)
        return IndicatorConfig(
            rsi_period=min(max(self.rsi_period, 2), 100),
            bollinger_period=min(max(self.bollinger_period, 2), 200),
            bollinger_stddev=min(max(self.bollinger_stddev, 0.1), 10.0),
            fast_ma=fast,
            slow_ma=slow,
            forecast_window=window,
            forecast_horizon=min(max(self.forecast_horizon, 1), 100),
        )


def sma(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(values), np.nan)
    if len(values) < period:
        return out
    cumulative = np.cumsum(values, dtype=float)
    out[period - 1] = cumulative[period - 1] / period
    if len(values) > period:
        out[period:] = (cumulative[period:] - cumulative[:-period]) / period
    return out


def ema(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(values), np.nan)
    if len(values) < period:
        return out
    alpha = 2.0 / (period + 1.0)
    out[period - 1] = values[:period].mean()
    for index in range(period, len(values)):
        out[index] = alpha * values[index] + (1.0 - alpha) * out[index - 1]
    return out


def rsi(values: np.ndarray, period: int = 14) -> np.ndarray:
    out = np.full(len(values), np.nan)
    if len(values) <= period:
        return out
    delta = np.diff(values)
    gains = np.clip(delta, 0.0, None)
    losses = np.clip(-delta, 0.0, None)

    average_gain = gains[:period].mean()
    average_loss = losses[:period].mean()
    out[period] = _rsi_value(average_gain, average_loss)

    for index in range(period + 1, len(values)):
        average_gain = (average_gain * (period - 1) + gains[index - 1]) / period
        average_loss = (average_loss * (period - 1) + losses[index - 1]) / period
        out[index] = _rsi_value(average_gain, average_loss)
    return out


def _rsi_value(average_gain: float, average_loss: float) -> float:
    if average_loss == 0.0:
        return 100.0 if average_gain > 0.0 else 50.0
    return 100.0 - 100.0 / (1.0 + average_gain / average_loss)


def bollinger(
    values: np.ndarray,
    period: int = 20,
    num_std: float = 2.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    middle = sma(values, period)
    deviation = np.full(len(values), np.nan)
    if len(values) >= period:
        windows = np.lib.stride_tricks.sliding_window_view(values, period)
        deviation[period - 1 :] = windows.std(axis=1)
    return middle, middle + num_std * deviation, middle - num_std * deviation


def linear_forecast(
    values: np.ndarray,
    window: int,
    horizon: int,
) -> dict:
    window = max(3, min(window, len(values)))
    sample = values[-window:]
    x = np.arange(window, dtype=float)
    slope, intercept = np.polyfit(x, sample, 1)
    fitted = slope * x + intercept
    residual = float(((sample - fitted) ** 2).sum())
    total = float(((sample - sample.mean()) ** 2).sum())
    r_squared = 1.0 - residual / total if total > 0 else 1.0

    future_x = np.arange(window, window + horizon, dtype=float)
    predictions = slope * future_x + intercept

    relative = abs(slope) / max(abs(float(sample[-1])), 1e-9)
    if relative < 0.0002:
        direction = "flat"
    elif slope > 0:
        direction = "up"
    else:
        direction = "down"

    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "r_squared": float(max(0.0, min(1.0, r_squared))),
        "values": [float(item) for item in predictions],
        "direction": direction,
        "window": window,
    }


def _series(times: list[int], values: np.ndarray, limit: int) -> list[dict]:
    points = []
    start = max(0, len(values) - limit)
    for index in range(start, len(values)):
        value = values[index]
        if np.isfinite(value):
            points.append({"open_time": times[index], "value": float(value)})
    return points


def _signal(
    symbol: str,
    bar: Bar,
    kind: str,
    severity: str,
    message: str,
    value: float,
) -> dict:
    return {
        "symbol": symbol,
        "open_time": bar.open_time,
        "kind": kind,
        "severity": severity,
        "message": message,
        "value": float(value),
    }


def evaluate_signals(
    symbol: str,
    bars: list[Bar],
    closes: np.ndarray,
    rsi_values: np.ndarray,
    middle: np.ndarray,
    upper: np.ndarray,
    lower: np.ndarray,
    fast: np.ndarray,
    slow: np.ndarray,
    forecast: dict,
) -> list[dict]:
    if len(bars) < 2:
        return []
    index = len(bars) - 1
    previous = index - 1
    bar = bars[index]
    signals: list[dict] = []

    def defined(*series: np.ndarray) -> bool:
        return all(np.isfinite(item[previous]) and np.isfinite(item[index]) for item in series)

    if defined(rsi_values):
        if rsi_values[previous] >= 30 > rsi_values[index]:
            signals.append(
                _signal(symbol, bar, "rsi_oversold", "warning", "RSI crossed below 30", rsi_values[index])
            )
        elif rsi_values[previous] <= 70 < rsi_values[index]:
            signals.append(
                _signal(symbol, bar, "rsi_overbought", "warning", "RSI crossed above 70", rsi_values[index])
            )

    if defined(upper):
        if closes[previous] <= upper[previous] and closes[index] > upper[index]:
            signals.append(
                _signal(symbol, bar, "bollinger_breakout_up", "info", "Close moved above the upper band", closes[index])
            )
        elif closes[previous] >= lower[previous] and closes[index] < lower[index]:
            signals.append(
                _signal(symbol, bar, "bollinger_breakdown", "warning", "Close moved below the lower band", closes[index])
            )

    if defined(fast, slow):
        if fast[previous] <= slow[previous] and fast[index] > slow[index]:
            signals.append(
                _signal(symbol, bar, "ma_cross_bull", "info", "Fast moving average crossed above the slow average", fast[index])
            )
        elif fast[previous] >= slow[previous] and fast[index] < slow[index]:
            signals.append(
                _signal(symbol, bar, "ma_cross_bear", "warning", "Fast moving average crossed below the slow average", fast[index])
            )

    if forecast["r_squared"] >= 0.6 and forecast["direction"] != "flat":
        severity = "info" if forecast["direction"] == "up" else "warning"
        signals.append(
            _signal(
                symbol,
                bar,
                f"forecast_{forecast['direction']}",
                severity,
                f"Regression forecast points {forecast['direction']} (R2 {forecast['r_squared']:.2f})",
                forecast["slope"],
            )
        )

    return signals


def validate_bars(bars: list[Bar], max_candles: int) -> list[Bar]:
    if len(bars) < 2:
        raise ValueError("at least two candles are required")
    if len(bars) > max_candles:
        raise ValueError(f"candle count exceeds the limit of {max_candles}")
    ordered = sorted(bars, key=lambda bar: bar.open_time)
    seen_times: set[int] = set()
    unique: list[Bar] = []
    for bar in ordered:
        if bar.open_time in seen_times:
            continue
        seen_times.add(bar.open_time)
        values = (bar.open, bar.high, bar.low, bar.close, bar.volume)
        if not all(np.isfinite(value) for value in values):
            raise ValueError("candle values must be finite")
        if bar.low <= 0 or bar.high < bar.low:
            raise ValueError("candle range is invalid")
        if bar.high < max(bar.open, bar.close) or bar.low > min(bar.open, bar.close):
            raise ValueError("candle prices fall outside the high and low")
        if bar.volume < 0:
            raise ValueError("volume cannot be negative")
        unique.append(bar)
    if len(unique) < 2:
        raise ValueError("at least two distinct candles are required")
    return unique


def analyze(
    symbol: str,
    bars: list[Bar],
    config: IndicatorConfig,
    max_candles: int = 5000,
    max_series_points: int = MAX_SERIES_POINTS,
) -> dict:
    if not symbol or len(symbol) > 32:
        raise ValueError("symbol must be between 1 and 32 characters")
    bars = validate_bars(bars, max_candles)
    config = config.validated()

    closes = np.array([bar.close for bar in bars], dtype=float)
    times = [bar.open_time for bar in bars]

    rsi_values = rsi(closes, config.rsi_period)
    fast = sma(closes, config.fast_ma)
    slow = sma(closes, config.slow_ma)
    middle, upper, lower = bollinger(closes, config.bollinger_period, config.bollinger_stddev)
    forecast = linear_forecast(closes, config.forecast_window, config.forecast_horizon)

    index = len(bars) - 1
    latest: dict[str, float] = {}
    for name, series in (
        ("rsi", rsi_values),
        ("bb_middle", middle),
        ("bb_upper", upper),
        ("bb_lower", lower),
        ("sma_fast", fast),
        ("sma_slow", slow),
    ):
        if np.isfinite(series[index]):
            latest[name] = float(series[index])
    latest["forecast_slope"] = forecast["slope"]
    latest["forecast_r2"] = forecast["r_squared"]

    series = [
        {
            "name": "rsi",
            "points": _series(times, rsi_values, max_series_points),
        },
        {
            "name": "close",
            "points": _series(times, closes, max_series_points),
        },
        {
            "name": "sma_fast",
            "points": _series(times, fast, max_series_points),
        },
        {
            "name": "sma_slow",
            "points": _series(times, slow, max_series_points),
        },
        {
            "name": "bollinger",
            "points": _series(times, middle, max_series_points),
            "upper": _series(times, upper, max_series_points),
            "lower": _series(times, lower, max_series_points),
        },
    ]

    signals = evaluate_signals(
        symbol, bars, closes, rsi_values, middle, upper, lower, fast, slow, forecast
    )

    return {
        "symbol": symbol,
        "as_of": bars[index].open_time,
        "last_close": float(closes[index]),
        "latest": latest,
        "series": series,
        "forecast": forecast,
        "signals": signals,
    }
