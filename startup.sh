#!/usr/bin/env bash
set -e

echo "=== TeleGroup Management Bot Startup ==="

if [ -f .env ]; then
  echo "Loading environment from .env..."
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is not set in environment or .env."
  echo "Please set your existing BotFather token and re-run."
  exit 1
fi

echo "Checking python version..."
python3 --version

echo "Starting TeleGroup Bot in 24/7 async mode..."
exec python3 -m bot.main
