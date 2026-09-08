#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

exec uvicorn server.app:app --reload --host 127.0.0.1 --port 8000
