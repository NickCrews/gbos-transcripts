#!/usr/bin/env bash
# setup.sh — Initial project setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== GBOS Setup ==="

# Create data directories
mkdir -p "$REPO_ROOT/data/audio"
mkdir -p "$REPO_ROOT/data/transcripts"
echo "Created data/ directories."

# Python pipeline
echo ""
echo "--- Python pipeline (uv) ---"
cd "$REPO_ROOT/pipeline"
uv sync
echo "Pipeline dependencies installed."

# TypeScript API
echo ""
echo "--- TypeScript API (pnpm) ---"
cd "$REPO_ROOT/api"
if command -v pnpm &>/dev/null; then
    pnpm install
elif command -v npm &>/dev/null; then
    npm install
else
    echo "ERROR: pnpm or npm required."
    exit 1
fi
echo "API dependencies installed."

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Process all meetings:  cd pipeline && uv run python -m gbos_pipeline.update"
echo "  2. Start API:             cd api && pnpm dev"
echo "  3. Search:                curl 'http://localhost:3000/api/v1/search?q=trail&mode=hybrid'"
