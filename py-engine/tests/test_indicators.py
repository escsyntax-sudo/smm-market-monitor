import numpy as np

from smm_engine.analytics import (
    IndicatorConfig,
    bollinger,
    ema,
    linear_forecast,
    rsi,
    sma,
)


def test_sma_and_ema():
    values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    simple = sma(values, 3)
    assert np.isnan(simple[0])
    assert simple[2] == 2.0
    assert simple[4] == 4.0

    exponential = ema(values, 3)
    assert exponential[2] == 2.0
    assert np.isclose(exponential[3], 3.0)
    assert np.isclose(exponential[4], 4.0)


def test_rsi_extremes():
    rising = np.arange(1.0, 30.0)
    values = rsi(rising, 14)
    assert np.isnan(values[13])
    assert values[14] == 100.0

    falling = np.arange(30.0, 1.0, -1.0)
    values = rsi(falling, 14)
    assert values[14] == 0.0

    flat = rsi(np.full(20, 5.0), 14)
    assert flat[14] == 50.0

    mixed = rsi(
        np.array(
            [
                44.0, 44.3, 44.1, 43.6, 44.2, 44.8, 45.1, 44.9, 45.6, 46.2,
                45.8, 46.5, 47.1, 46.8, 47.4, 48.0, 47.6, 48.2, 48.9, 49.4,
            ]
        ),
        14,
    )
    assert 0.0 <= mixed[-1] <= 100.0


def test_bollinger_bands_on_flat_series():
    values = np.full(25, 10.0)
    middle, upper, lower = bollinger(values, 20, 2.0)
    assert middle[19] == 10.0
    assert upper[19] == 10.0
    assert lower[19] == 10.0
    assert np.isnan(middle[18])


def test_forecast_on_a_perfect_line():
    values = np.arange(1.0, 31.0)
    result = linear_forecast(values, 20, 5)
    assert np.isclose(result["slope"], 1.0)
    assert np.isclose(result["r_squared"], 1.0)
    assert result["direction"] == "up"
    assert len(result["values"]) == 5
    assert np.isclose(result["values"][0], 31.0)
    assert np.isclose(result["values"][-1], 35.0)


def test_config_validation_clamps_values():
    config = IndicatorConfig(rsi_period=1, bollinger_period=0, fast_ma=50, slow_ma=10, forecast_window=1)
    validated = config.validated()
    assert validated.rsi_period == 2
    assert validated.bollinger_period == 2
    assert validated.slow_ma > validated.fast_ma
    assert validated.forecast_window >= 3
