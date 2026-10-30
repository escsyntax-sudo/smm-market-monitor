"""Regenerate the committed gRPC stubs from proto/smm/v1/market.proto."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ENGINE_ROOT.parent
PROTO_ROOT = REPO_ROOT / "proto"
PROTO_FILE = PROTO_ROOT / "smm" / "v1" / "market.proto"


def main() -> int:
    if not PROTO_FILE.exists():
        print(f"proto file not found: {PROTO_FILE}", file=sys.stderr)
        return 1
    command = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"-I{PROTO_ROOT}",
        f"--python_out={ENGINE_ROOT}",
        f"--grpc_python_out={ENGINE_ROOT}",
        str(PROTO_FILE),
    ]
    print(" ".join(command))
    return subprocess.call(command, cwd=ENGINE_ROOT)


if __name__ == "__main__":
    raise SystemExit(main())
