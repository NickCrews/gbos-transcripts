#!/usr/bin/env bash
# backfill.sh — Process all historical GBOS meetings
#
# This will download + transcribe + diarize + embed all ~188 meetings.
# Estimated time: several hours depending on hardware.
#
# Usage:
#   ./scripts/backfill.sh [--max-new N]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PIPELINE_DIR="$REPO_ROOT/pipeline"

echo "=== GBOS Backfill $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
echo "Processing all ~188 meetings. This will take a while..."

cd "$PIPELINE_DIR"
uv run python -m gbos_pipeline.update "$@"

echo "=== Backfill complete $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
