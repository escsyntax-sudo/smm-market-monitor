import numpy as np
import pytest

from smm_engine.analytics import Bar, IndicatorConfig, analyze


def build_bars(closes, start=1_700_000_000_000, step=60_000):
    bars = []
    for index, close in enumerate(closes):
        bars.append(
            Bar(
                open_time=start + index * step,
                open=close - 0.4,
                high=close + 0.8,
                low=close - 0.9,
                close=close,
                volume=1000 + index,
            )
        )
    return bars


def test_analyze_uptrend_reports_indicators_and_forecast():
    closes = [100 + index * 0.5 + np.sin(index / 3) for index in range(80)]
    result = analyze("BTC-USD", build_bars(closes), IndicatorConfig(forecast_window=30))

    assert result["symbol"] == "BTC-USD"
    assert result["last_close"] == pytest.approx(closes[-1])
    assert result["latest"]["rsi"] > 50
    assert result["latest"]["sma_fast"] > result["latest"]["sma_slow"]
    assert result["forecast"]["direction"] == "up"
    assert result["forecast"]["r_squared"] > 0.5
    assert len(result["forecast"]["values"]) == 5
    assert result["as_of"] == build_bars(closes)[-1].open_time

    names = {series["name"] for series in result["series"]}
    assert {"rsi", "close", "sma_fast", "sma_slow", "bollinger"} <= names
    kinds = {signal["kind"] for signal in result["signals"]}
    assert "forecast_up" in kinds


def test_analyze_downtrend_flags_forecast_down():
    closes = [200 - index * 0.6 for index in range(60)]
    result = analyze("ETH-USD", build_bars(closes), IndicatorConfig())
    assert result["forecast"]["direction"] == "down"
    assert any(signal["kind"] == "forecast_down" for signal in result["signals"])


def test_short_series_does_not_crash_indicator_math():
    result = analyze("SOL-USD", build_bars([10.0, 10.5, 10.2, 10.8]), IndicatorConfig())
    if "rsi" in result["latest"]:
        assert 0 <= result["latest"]["rsi"] <= 100
    assert result["forecast"]["direction"] in {"up", "down", "flat"}


def test_invalid_candles_are_rejected():
    with pytest.raises(ValueError):
        analyze("BTC-USD", build_bars([100.0]), IndicatorConfig())

    broken = build_bars([100.0, 101.0, 102.0])
    broken[1] = Bar(broken[1].open_time, 101.0, 99.0, 100.0, 101.0, 10.0)
    with pytest.raises(ValueError):
        analyze("BTC-USD", broken, IndicatorConfig())

    empty_symbol = build_bars([100.0, 101.0])
    with pytest.raises(ValueError):
        analyze("", empty_symbol, IndicatorConfig())
