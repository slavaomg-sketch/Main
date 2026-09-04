#!/usr/bin/env bash
# Runs typecheck + headless tests. Usage: tools/run-tests.sh [filter]
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/analyze.py | tail -1
lune run tests/run.luau "${1:-}"
