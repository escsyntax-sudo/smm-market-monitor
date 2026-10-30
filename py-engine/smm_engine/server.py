from __future__ import annotations

import logging
import threading
from concurrent import futures

import grpc

from smm.v1 import market_pb2, market_pb2_grpc

from . import __version__
from .analytics import Bar, IndicatorConfig, analyze, validate_bars
from .config import Settings, load_settings

logger = logging.getLogger("smm_engine")


class MarketAnalyticsServicer(market_pb2_grpc.MarketAnalyticsServicer):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._analyzed = 0
        self._lock = threading.Lock()

    def Analyze(self, request, context):  # noqa: N802 - gRPC method name
        symbol = request.symbol.strip()
        try:
            bars = [
                Bar(
                    open_time=candle.open_time,
                    open=candle.open,
                    high=candle.high,
                    low=candle.low,
                    close=candle.close,
                    volume=candle.volume,
                )
                for candle in request.candles
            ]
            bars = validate_bars(bars, self.settings.max_candles)
            config = _config_from_request(request.config)
            result = analyze(
                symbol,
                bars,
                config,
                max_candles=self.settings.max_candles,
                max_series_points=self.settings.max_series_points,
            )
        except ValueError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            return market_pb2.AnalyzeResponse()

        with self._lock:
            self._analyzed += 1

        return _response_from_result(result, include_series=request.include_series)

    def Health(self, request, context):  # noqa: N802 - gRPC method name
        with self._lock:
            analyzed = self._analyzed
        return market_pb2.HealthResponse(
            status="ok",
            version=__version__,
            analyzed=analyzed,
        )


def _config_from_request(config) -> IndicatorConfig:
    defaults = IndicatorConfig()
    return IndicatorConfig(
        rsi_period=config.rsi_period or defaults.rsi_period,
        bollinger_period=config.bollinger_period or defaults.bollinger_period,
        bollinger_stddev=config.bollinger_stddev or defaults.bollinger_stddev,
        fast_ma=config.fast_ma or defaults.fast_ma,
        slow_ma=config.slow_ma or defaults.slow_ma,
        forecast_window=config.forecast_window or defaults.forecast_window,
        forecast_horizon=config.forecast_horizon or defaults.forecast_horizon,
    )


def _points(source: list[dict]):
    return [
        market_pb2.SeriesPoint(open_time=point["open_time"], value=point["value"])
        for point in source
    ]


def _response_from_result(result: dict, include_series: bool) -> market_pb2.AnalyzeResponse:
    response = market_pb2.AnalyzeResponse(
        symbol=result["symbol"],
        as_of=result["as_of"],
        last_close=result["last_close"],
    )
    response.latest.update(result["latest"])

    forecast = result["forecast"]
    response.forecast.CopyFrom(
        market_pb2.Forecast(
            slope=forecast["slope"],
            intercept=forecast["intercept"],
            r_squared=forecast["r_squared"],
            values=forecast["values"],
            direction=forecast["direction"],
            window=forecast["window"],
        )
    )

    if include_series:
        for item in result["series"]:
            series = response.series.add(name=item["name"])
            series.points.extend(_points(item["points"]))
            if "upper" in item:
                series.upper.extend(_points(item["upper"]))
            if "lower" in item:
                series.lower.extend(_points(item["lower"]))

    for signal in result["signals"]:
        response.signals.add(
            symbol=signal["symbol"],
            open_time=signal["open_time"],
            kind=signal["kind"],
            severity=signal["severity"],
            message=signal["message"],
            value=signal["value"],
        )
    return response


def create_server(
    settings: Settings | None = None,
    bind: str | None = None,
) -> tuple[grpc.Server, int]:
    settings = settings or load_settings()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=settings.max_workers))
    market_pb2_grpc.add_MarketAnalyticsServicer_to_server(
        MarketAnalyticsServicer(settings), server
    )
    port = server.add_insecure_port(bind or f"{settings.host}:{settings.port}")
    if port == 0:
        raise RuntimeError("failed to bind the analytics gRPC server")
    return server, port


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    settings = load_settings()
    server, port = create_server(settings)
    server.start()
    logger.info("analytics engine listening on port %d", port)
    server.wait_for_termination()


if __name__ == "__main__":
    main()
