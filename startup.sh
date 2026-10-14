#!/usr/bin/env bash
set -e

echo "=== TeleGroup Management Bot & Multi-Bot Squad Startup ==="

if [ -f .env ]; then
  echo "Loading environment from .env..."
  export $(grep -v '^#' .env | xargs)
fi

echo "Checking Node.js version..."
node --version

echo "Starting TeleGroup Bot and 4-Bot Squad in 24/7 mode..."
exec npx tsx server.ts
