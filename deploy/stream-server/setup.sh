#!/usr/bin/env bash
# Pilot Ops stream server — one-shot setup for a fresh Ubuntu 22.04/24.04 box.
#
# After launching the instance + pointing your hostname at it:
#   git clone https://github.com/ebene-hub/pilotops.git
#   cd pilotops/deploy/stream-server
#   cp .env.example .env && nano .env       # set STREAM_DOMAIN + SUPABASE_SERVICE_ROLE_KEY
#   ./setup.sh
#
# Installs Docker + swap, then builds and starts MediaMTX + stream-gateway + Caddy.
# Safe to re-run (idempotent) — also use it to redeploy after `git pull`.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Pilot Ops stream server setup"

# --- .env must exist and be filled in --------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
  echo "!! No .env yet. Edit it, then re-run:  nano $(pwd)/.env && ./setup.sh"
  exit 1
fi
if grep -qE 'replace-with-your-service-role-key|stream\.example\.com' .env; then
  echo "!! Edit .env first — STREAM_DOMAIN / SUPABASE_SERVICE_ROLE_KEY are still placeholders."
  exit 1
fi

# --- Docker ----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

# --- 1 GB swap (a 1 GB-RAM micro instance OOMs during builds/encoding) ------
if ! sudo swapon --show 2>/dev/null | grep -q /swapfile; then
  echo "==> Adding 1G swap"
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# --- Bring up the stack -----------------------------------------------------
# Use sudo so it works in the same session before the docker group re-login.
echo "==> Building + starting containers"
sudo docker compose up -d --build

echo
echo "==> Status"
sudo docker compose ps
DOMAIN="$(grep -E '^STREAM_DOMAIN=' .env | cut -d= -f2)"
echo
echo "Done. Watch Caddy obtain the TLS cert:"
echo "    sudo docker compose logs -f caddy"
echo "Then verify (after the cert is issued):"
echo "    curl -I https://${DOMAIN}/        # expect HTTP/2 200"
