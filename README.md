# SMM Market Monitor

A market monitoring stack with a Node.js gateway and a Python analytics engine. The gateway ingests ticks or completed candles, maintains rolling OHLC bars, exposes REST and WebSocket APIs, and broadcasts indicator updates and alerts. The engine calculates RSI, Bollinger Bands, fast and slow moving averages, and a linear regression forecast over gRPC.

The demo feed is synthetic. It generates deterministic random walks so the stack can be run without a data vendor. Do not treat its prices as live market data.

## Architecture

```text
exchange or collector
        |
        | POST /ingest
        v
Node gateway (Fastify)  <------ WebSocket clients
        |       \
        |        \ REST snapshots, alerts, health
        |         \
        |          +--> in-memory candle store, alert log
        |
        | gRPC Analyze / Health
        v
Python engine (grpcio, numpy)
        |
        +--> RSI, Bollinger Bands, SMA, linear regression
```

Components:

- `node-gateway`: Fastify 5 API, WebSocket hub, tick aggregation, alert deduplication, demo feed.
- `py-engine`: gRPC service around a numeric analytics library. The proto contract lives in `proto/smm/v1/market.proto`.
- `docker-compose.yml`: runs both processes with the engine on a private network.

## Requirements

- Node.js 22 or newer
- Python 3.11 or newer
- Docker Compose is optional

## Run locally

Start the analytics engine:

```bash
cd py-engine
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
python -m smm_engine
```

On macOS or Linux, activate with `source .venv/bin/activate`.

Start the gateway in another terminal:

```bash
cd node-gateway
npm install
set SMM_API_KEY=local-dev-key
npm start
```

PowerShell uses `$env:SMM_API_KEY = "local-dev-key"` instead of `set`.

The gateway listens on `http://127.0.0.1:8090` and the engine on `127.0.0.1:50051`. The synthetic feed publishes one tick per second for `BTC-USD`, `ETH-USD`, and `SOL-USD`, and closes a candle every 15 seconds.

## Run with Docker Compose

```bash
cd smm
copy .env.example .env
docker compose up --build
```

Set a real `SMM_API_KEY` in `.env` before starting. In production mode the gateway refuses to run without it.

## Configuration

Gateway variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8090` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `SMM_ENGINE_URL` | `127.0.0.1:50051` | gRPC engine address |
| `PROTO_PATH` | `../proto/smm/v1/market.proto` | Proto file resolved from the gateway directory |
| `SMM_API_KEY` | unset | Required for `/ingest` when set, mandatory when `NODE_ENV=production` |
| `DEMO_FEED` | `true` | Start the synthetic price feed |
| `DEMO_SYMBOLS` | `BTC-USD,ETH-USD,SOL-USD` | Comma separated demo symbols |
| `DEMO_TICK_MS` | `1000` | Tick interval |
| `DEMO_CANDLE_MS` | `15000` | Candle width used by the store |
| `MAX_CANDLES` | `600` | Bars retained per symbol |
| `ALERT_BUFFER` | `500` | Alerts retained in memory |
| `CORS_ORIGIN` | unset | Allowed browser origin, disabled when empty |
| `LOG_LEVEL` | `info` | Pino log level |

Engine variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `SMM_ENGINE_HOST` | `0.0.0.0` | gRPC bind address |
| `SMM_ENGINE_PORT` | `50051` | gRPC port |
| `SMM_ENGINE_WORKERS` | `4` | Thread pool size |
| `SMM_MAX_CANDLES` | `5000` | Maximum bars accepted per request |
| `SMM_MAX_SERIES_POINTS` | `300` | Maximum points per returned series |

## HTTP API

### `GET /healthz`

Calls the engine health method. Returns `200` when the engine answers, `503` when it does not.

### `GET /symbols`

Lists tracked symbols with their last close, bar count, and latest open time.

### `GET /snapshot/:symbol`

Returns the last 120 bars, the most recent analysis, and up to 20 alerts. The symbol is case insensitive.

### `GET /alerts?symbol=BTC-USD&limit=50`

Returns recent deduplicated alerts. The `symbol` filter is optional.

### `POST /ingest`

Requires `x-api-key` when `SMM_API_KEY` is configured. The body accepts either a completed candle or a single tick.

Tick:

```json
{
  "symbol": "BTC-USD",
  "price": 64120.5,
  "volume": 1.8,
  "timestamp": 1700000000000
}
```

Candle:

```json
{
  "symbol": "BTC-USD",
  "candle": {
    "openTime": 1700000000000,
    "open": 64000,
    "high": 64300,
    "low": 63900,
    "close": 64120.5,
    "volume": 22.4
  }
}
```

Ticks are aggregated into the current candle. Completed candles replace an existing bar with the same `openTime`. Both paths return `202`.

### `POST /analyze`

Runs analysis for an explicit candle set without touching the store. Useful for backtests and one-off calculations.

```json
{
  "symbol": "ETH-USD",
  "candles": [
    { "openTime": 1700000000000, "open": 3200, "high": 3240, "low": 3180, "close": 3230, "volume": 10 },
    { "openTime": 1700000060000, "open": 3230, "high": 3260, "low": 3210, "close": 3222, "volume": 12 }
  ],
  "includeSeries": true,
  "config": {
    "rsiPeriod": 14,
    "bollingerPeriod": 20,
    "bollingerStddev": 2,
    "fastMa": 9,
    "slowMa": 21,
    "forecastWindow": 30,
    "forecastHorizon": 5
  }
}
```

The response includes latest indicator values, a linear regression forecast, signals, and optional series. Engine validation failures return `400`. Engine outages return `502`.

## WebSocket API

Connect to `ws://127.0.0.1:8090/ws`. The server sends `ws.ready` with tracked symbols.

Client messages:

```json
{ "op": "subscribe", "symbols": ["BTC-USD"] }
{ "op": "unsubscribe" }
{ "op": "ping" }
```

Server events:

- `price`: a tick was aggregated into a candle.
- `analysis`: indicators and forecast were recalculated after a bar closed.
- `alert`: a new deduplicated signal was produced.
- `analytics.unavailable`: the engine call failed.
- `pong`, `subscribed`, `error`: protocol responses.

An empty subscription list receives every symbol. A non-empty list filters by symbol.

## Analytics

The engine returns:

- RSI with Wilder smoothing.
- Bollinger middle, upper, and lower bands.
- Fast and slow simple moving averages.
- Linear regression slope, intercept, R squared, direction, and future values.
- Signals for RSI threshold crossings, band breakouts, moving average crosses, and strong regression trends with `R2 >= 0.6`.

Candles are sorted by open time. Duplicate open times keep the first bar. Invalid ranges, non-finite values, negative volume, and oversized payloads are rejected.

## Tests

```bash
cd node-gateway
npm test
```

```bash
cd py-engine
.venv\Scripts\python.exe -m pytest
```

The test suites cover candle aggregation, alert deduplication, WebSocket filtering, REST authentication, engine failures, indicators, forecasts, validation, and the gRPC service. Docker, Redis, and external market feeds are not required for tests.

## Regenerate gRPC stubs

The generated Python modules are committed so the engine starts without `grpcio-tools`. To regenerate after changing the proto:

```bash
cd py-engine
.venv\Scripts\python.exe scripts\generate_proto.py
```

## Operational notes

- Candle state and alerts are in memory. A gateway restart clears them.
- One gateway instance owns its own in-memory state. Running multiple instances requires a shared store and a shared alert log.
- The gateway does not authenticate read endpoints. Put it behind a gateway or reverse proxy if snapshots and WebSockets are private.
- gRPC traffic is plaintext. Keep the engine on a private network or add TLS before exposing it.
- The synthetic feed is for demonstration and testing only.
