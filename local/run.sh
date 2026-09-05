#!/usr/bin/env bash
# Arranque rapido DowntimeOS (macOS / Linux)
cd "$(dirname "$0")"
python3 server/main.py "$@"
