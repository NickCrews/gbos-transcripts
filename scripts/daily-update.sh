#!/usr/bin/env bash
# daily-update.sh — Cron wrapper for the GBOS pipeline update
#
# Cron entry (runs at 3am daily):
#   0 3 * * * /path/to/gbos/scripts/daily-update.sh >> /path/to/gbos/logs/update.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PIPELINE_DIR="$REPO_ROOT/pipeline"
LOG_DIR="$REPO_ROOT/logs"

mkdir -p "$LOG_DIR"

echo "=== GBOS Daily Update $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

cd "$PIPELINE_DIR"
uv run python -m gbos_pipeline.update "$@"

echo "=== Done $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
