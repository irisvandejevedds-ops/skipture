#!/usr/bin/env bash
# Copy the app to /opt/skipture/app (root-owned, world-readable) and restart the service.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/app"
sudo rm -rf /opt/skipture/app.new && sudo mkdir -p /opt/skipture/app.new
sudo cp -r "$SRC/skipture" /opt/skipture/app.new/skipture
sudo find /opt/skipture/app.new -name __pycache__ -type d -prune -exec rm -rf {} +
sudo chmod -R a+rX /opt/skipture/app.new
sudo rm -rf /opt/skipture/app.old
[ -d /opt/skipture/app ] && sudo mv /opt/skipture/app /opt/skipture/app.old
sudo mv /opt/skipture/app.new /opt/skipture/app
sudo systemctl restart skipture-web
echo "deployed; service restarted"
