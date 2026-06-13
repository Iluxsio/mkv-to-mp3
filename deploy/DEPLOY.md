# Deploying alongside an existing Caddy (e.g. a Foundry VTT server)

This guide deploys the app on the **same Oracle Cloud Ubuntu box** that already
runs another service behind Caddy, **without any conflict**:

- It uses a **separate subdomain**, so Caddy routes it with its own site block.
- The Node API listens on **localhost:3000 only** (never exposed), so it can't
  clash with Foundry's port and needs **no new cloud/OS firewall rule** — Caddy
  already owns 80/443.

Paths used below (change if you like):

| What | Path |
|------|------|
| Built frontend (static) | `/opt/mkv-to-mp3/web` |
| Node API | `/opt/mkv-to-mp3/server` |
| Subdomain | `mkv.luxhauntedrealm.com` |

---

## 1. DNS (IONOS)

Add an **A record** for the subdomain pointing to the **same public IP** as your
existing server:

```
Type: A    Host: mkv    Value: <your server public IP>    TTL: 1h
```

(Use the same IP your Foundry subdomain resolves to.) Wait for it to propagate:

```bash
dig +short mkv.luxhauntedrealm.com   # should print your server IP
```

## 2. Server prerequisites

SSH in and make sure Node (≥ 20) and ffmpeg are installed:

```bash
node --version            # need >= 20; install if missing
ffmpeg -version | head -1 # install if missing:  sudo apt update && sudo apt install -y ffmpeg
```

If Node is missing:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Pick the API port (default `3000`) and confirm it's free (Foundry uses 30000, so
no clash, but check anyway):
```bash
sudo ss -ltnp | grep ':3000' || echo "port 3000 is free"
```

## 3. Build locally and upload

On your machine:

```bash
npm run build      # produces dist/mkv-to-mp3/browser
```

Copy the static build and the server folder to the box:

```bash
ssh ubuntu@SERVER 'sudo mkdir -p /opt/mkv-to-mp3 && sudo chown -R $USER /opt/mkv-to-mp3'

# Static frontend  ->  /opt/mkv-to-mp3/web
scp -r dist/mkv-to-mp3/browser/*  ubuntu@SERVER:/opt/mkv-to-mp3/web/

# API source  ->  /opt/mkv-to-mp3/server
scp -r server/*  ubuntu@SERVER:/opt/mkv-to-mp3/server/
```

Install the API's production deps on the server:

```bash
ssh ubuntu@SERVER
cd /opt/mkv-to-mp3/server
npm install --omit=dev
```

## 4. Run the API as a systemd service

Upload the unit file and install it:

```bash
# from your machine:
scp deploy/mkv2mp3-api.service ubuntu@SERVER:/tmp/

# on the server:
sudo mv /tmp/mkv2mp3-api.service /etc/systemd/system/
sudoedit /etc/systemd/system/mkv2mp3-api.service   # check User, paths, STATIC_DIR
sudo systemctl daemon-reload
sudo systemctl enable --now mkv2mp3-api
sudo systemctl status mkv2mp3-api --no-pager
curl -s localhost:3000/api/health   # -> {"ok":true,...}
```

The service has `STATIC_DIR=/opt/mkv-to-mp3/web`, so Node serves the frontend
**and** the `/api` on the same origin.

## 5. Add the Caddy site block

Append the block from `Caddyfile.example` to your existing Caddyfile (usually
`/etc/caddy/Caddyfile`) — as a **new, separate block**, leaving the Foundry block
untouched:

```caddy
mkv.luxhauntedrealm.com {
	encode zstd gzip
	reverse_proxy localhost:3000 {
		transport http {
			read_timeout 30m
			write_timeout 30m
		}
	}
}
```

Validate and reload (reload does **not** drop existing connections / Foundry):

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will automatically obtain a TLS certificate for the new subdomain.

## 6. Test

Open `https://mkv.luxhauntedrealm.com`. Health check:

```bash
curl -s https://mkv.luxhauntedrealm.com/api/health
```

## Updating later

```bash
npm run build
scp -r dist/mkv-to-mp3/browser/*  ubuntu@SERVER:/opt/mkv-to-mp3/web/
# (only if server/ changed:)
scp -r server/*  ubuntu@SERVER:/opt/mkv-to-mp3/server/ && \
  ssh ubuntu@SERVER 'cd /opt/mkv-to-mp3/server && npm install --omit=dev && sudo systemctl restart mkv2mp3-api'
```

## Notes

- **No firewall change needed.** The API is bound to localhost; only Caddy
  (already open on 443) is reachable from outside.
- **Big uploads.** `MAX_UPLOAD_BYTES` (8 GB default) and the Caddy timeouts
  govern large files. Increase both if you need more.
- **Disk during conversion.** A server-side conversion briefly stores the upload
  in `/tmp` (isolated via `PrivateTmp`) and deletes it immediately after. Make
  sure the box has enough free space for the largest file you expect.
