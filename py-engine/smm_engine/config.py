from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    max_workers: int
    max_candles: int
    max_series_points: int


def load_settings() -> Settings:
    return Settings(
        host=os.environ.get("SMM_ENGINE_HOST", "0.0.0.0"),
        port=_int("SMM_ENGINE_PORT", 50051),
        max_workers=max(1, _int("SMM_ENGINE_WORKERS", 4)),
        max_candles=max(50, _int("SMM_MAX_CANDLES", 5000)),
        max_series_points=max(30, _int("SMM_MAX_SERIES_POINTS", 300)),
    )
