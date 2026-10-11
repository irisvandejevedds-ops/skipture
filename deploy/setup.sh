#!/usr/bin/env bash
# One-time server setup for Skipture: system user, data dir, venv, systemd unit, tailnet exposure (https port 8445 -> 127.0.0.1:8102).
set -euo pipefail
: "${SKIPTURE_TS_LOGINS:?set SKIPTURE_TS_LOGINS to your Tailscale login email, e.g. you@example.com}"
id skipture >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/skipture --shell /usr/sbin/nologin skipture
sudo install -d -m 700 -o skipture -g skipture /var/lib/skipture
sudo install -d -m 755 /opt/skipture /etc/skipture
if [ ! -d /opt/skipture/venv ]; then
  sudo python3 -m venv /opt/skipture/venv
  sudo /opt/skipture/venv/bin/pip install --quiet fastapi "uvicorn[standard]" jinja2 python-multipart argon2-cffi
fi
sudo tee /etc/skipture/skipture.env >/dev/null <<EOF
SKIPTURE_DATA_DIR=/var/lib/skipture
SKIPTURE_TZ=America/Toronto
SKIPTURE_REQUIRE_TS_HEADER=1
SKIPTURE_TS_LOGINS=${SKIPTURE_TS_LOGINS}
EOF
sudo tee /etc/systemd/system/skipture-web.service >/dev/null <<'EOF'
[Unit]
Description=Skipture web (FastAPI on loopback)
After=network.target

[Service]
User=skipture
Group=skipture
EnvironmentFile=/etc/skipture/skipture.env
Environment=PYTHONDONTWRITEBYTECODE=1
WorkingDirectory=/opt/skipture/app
ExecStart=/opt/skipture/venv/bin/uvicorn skipture.main:get_app --factory --host 127.0.0.1 --port 8102 --no-server-header --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/skipture
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
MemoryMax=400M

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
echo "setup done; now run deploy/deploy.sh, then: sudo systemctl enable --now skipture-web && sudo tailscale serve --bg --https=8445 http://127.0.0.1:8102"
