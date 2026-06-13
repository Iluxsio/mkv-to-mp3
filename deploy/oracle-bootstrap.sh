#!/usr/bin/env bash
# OS-level prep for a fresh Oracle Cloud Ubuntu instance dedicated to mkv-to-mp3.
# Installs ffmpeg + Node.js + Caddy and opens the local firewall for 80/443.
# Idempotent: safe to re-run. Does NOT deploy the app (that comes after scp).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> Opening local firewall (iptables) for 80/443"
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save || true

echo "==> apt update + base packages (ffmpeg, curl, keyrings)"
sudo apt-get update -y
sudo apt-get install -y ffmpeg curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "==> Installing Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "==> Creating app directories under /opt/mkv-to-mp3"
sudo mkdir -p /opt/mkv-to-mp3/web /opt/mkv-to-mp3/server
sudo chown -R "$USER":"$USER" /opt/mkv-to-mp3

echo "==> Versions"
node --version
ffmpeg -version | head -1
caddy version
echo "==> Bootstrap done."
