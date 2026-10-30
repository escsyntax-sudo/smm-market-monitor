import grpc
import pytest

from smm.v1 import market_pb2, market_pb2_grpc
from smm_engine.config import Settings
from smm_engine.server import create_server


@pytest.fixture()
def analytics_stub():
    settings = Settings(
        host="127.0.0.1",
        port=0,
        max_workers=2,
        max_candles=1000,
        max_series_points=50,
    )
    server, port = create_server(settings, bind="127.0.0.1:0")
    server.start()
    channel = grpc.insecure_channel(f"127.0.0.1:{port}")
    stub = market_pb2_grpc.MarketAnalyticsStub(channel)
    try:
        yield stub
    finally:
        channel.close()
        server.stop(0)


def request_with_candles(count=40):
    request = market_pb2.AnalyzeRequest(symbol="BTC-USD", include_series=True)
    for index in range(count):
        close = 100.0 + index
        request.candles.add(
            open_time=1_700_000_000_000 + index * 60_000,
            open=close - 0.5,
            high=close + 1.0,
            low=close - 1.0,
            close=close,
            volume=10.0 + index,
        )
    return request


def test_analyze_round_trip(analytics_stub):
    response = analytics_stub.Analyze(request_with_candles(), timeout=5)
    assert response.symbol == "BTC-USD"
    assert response.last_close == 139.0
    assert response.forecast.direction == "up"
    assert response.latest["sma_fast"] > response.latest["sma_slow"]
    names = {series.name for series in response.series}
    assert "bollinger" in names
    assert len(response.series) == 5
    assert any(signal.kind == "forecast_up" for signal in response.signals)


def test_analyze_without_series(analytics_stub):
    request = request_with_candles(30)
    request.include_series = False
    response = analytics_stub.Analyze(request, timeout=5)
    assert len(response.series) == 0
    assert response.latest["rsi"] > 50


def test_invalid_request_returns_invalid_argument(analytics_stub):
    request = market_pb2.AnalyzeRequest(symbol="BTC-USD")
    request.candles.add(open_time=1, open=1, high=2, low=0.5, close=1.5, volume=1)
    with pytest.raises(grpc.RpcError) as error:
        analytics_stub.Analyze(request, timeout=5)
    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_health_reports_version_and_counter(analytics_stub):
    analytics_stub.Analyze(request_with_candles(), timeout=5)
    health = analytics_stub.Health(market_pb2.HealthRequest(), timeout=5)
    assert health.status == "ok"
    assert health.version == "0.1.0"
    assert health.analyzed >= 1
