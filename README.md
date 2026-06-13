# MKV → MP3

A small web app that extracts the audio track (MP3) from video files — `.mkv`,
`.mp4`, `.mov`, `.avi`, `.webm`, and anything else ffmpeg can read. Drop one or
many files in, get MP3s out.

**Privacy first.** By default the conversion runs **entirely in the browser**
with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — the file never
leaves the user's machine. Very large files (several GB, which the browser can't
hold in memory) can be sent to an optional **server** that converts them and
**deletes the upload immediately** — nothing is ever stored in the cloud.

> 🇪🇸 Versión en español: [README.es.md](README.es.md)

## How it works (modes)

| Mode | Where it converts | Privacy | Size limit |
|------|-------------------|---------|------------|
| **Auto** (default) | Browser; server only if the file exceeds the threshold (800 MB by default) | High | Any |
| **Browser** | 100% local with ffmpeg.wasm | Maximum — nothing is uploaded | Bounded by browser RAM (~1–2 GB) |
| **Server** | Your backend with native ffmpeg | File transits the server and is deleted right after | Up to `MAX_UPLOAD_BYTES` (8 GB default) |

The user picks the mode; in **Auto** the size threshold is configurable in the UI.

## Tech stack & how each piece is used

### Frontend — Angular 20
- **Standalone components + signals** (no NgModules, no Zone-heavy patterns). All
  state — the job queue, progress, selected mode, server availability — lives in
  signals on a single `ConverterService`.
- **`@angular/build` (esbuild)** for the build, with a dev proxy (`proxy.conf.json`)
  forwarding `/api` to the backend during development.
- The UI is a drag-&-drop dropzone + per-file progress list (`src/app/app.*`),
  styled with plain SCSS and CSS custom properties (dark theme).

### In-browser conversion — ffmpeg.wasm
- Uses **`@ffmpeg/ffmpeg` + `@ffmpeg/util`** with the **single-threaded ESM core**
  (`@ffmpeg/core/dist/esm`). Single-threaded means **no `SharedArrayBuffer`**, so
  the app needs **no COOP/COEP cross-origin-isolation headers** — it works from
  plain static hosting.
- The core (`ffmpeg-core.js` + `.wasm`) and the web worker are served from our
  **own origin** under `public/ffmpeg/` (no CDN call → better privacy, works
  offline). `scripts/copy-ffmpeg-core.mjs` (run on `postinstall`/`prebuild`)
  copies the ESM core and **bundles ffmpeg's worker** into a single self-contained
  file with esbuild.
- The conversion itself is the standard `-vn -c:a libmp3lame -q:a 2` (audio-only,
  VBR ~190 kbps), run via `ffmpeg.exec(...)` inside the worker.

> **Two gotchas this project solves** (the reason the worker/core handling looks
> the way it does):
> 1. The Angular/esbuild app build does **not** bundle ffmpeg's internal
>    `new Worker(new URL('./worker.js', import.meta.url))` — it would 404 at
>    runtime. We ship our own bundled worker and pass it via `classWorkerURL`.
> 2. ffmpeg's worker runs as a **module worker**, so it loads the core with
>    dynamic `import()` and needs the **ESM** build (which has a `default`
>    export). Serving the UMD core fails with *"failed to import ffmpeg-core.js"*.

### Backend — Node + Express (`server/`)
- A tiny **ephemeral** conversion API. `POST /api/convert` streams the multipart
  upload with **`busboy`** to a uniquely-named temp file (ffmpeg needs a seekable
  input for MKV), spawns native **ffmpeg**, and **pipes ffmpeg's stdout straight
  to the response** — the MP3 is never written to disk.
- The temp upload is removed on success, cancel, or error (`finally`), and the
  client disconnecting kills ffmpeg and cleans up. No file contents are logged.
- `GET /api/health` lets the frontend detect whether the server mode is available.

### Deployment (`deploy/`)
- **Caddy** snippet (`Caddyfile.example`): serves the built static frontend and
  `reverse_proxy`es `/api` to the Node service, with long read/write timeouts for
  multi-GB uploads. `.wasm` is served as `application/wasm` automatically.
- **systemd** unit (`mkv2mp3-api.service`) with `PrivateTmp=true` so temp files
  are isolated and wiped on restart, plus light hardening.

## Project structure

```
.                       Angular 20 frontend (workspace root)
├─ src/app/app.*        UI: dropzone, mode selector, per-file progress list
├─ src/app/conversion/  ffmpeg-client.service (wasm), server.service (API),
│                       converter.service (job queue/orchestrator), models, config
├─ public/ffmpeg/       ffmpeg core + worker (generated from node_modules)
├─ scripts/             copy-ffmpeg-core.mjs (asset prep), e2e-client-check.mjs
├─ server/              ephemeral Node + Express conversion API (native ffmpeg)
└─ deploy/              Caddyfile.example + systemd service
```

## Development

Requirements: **Node ≥ 22.12** and **ffmpeg** on the `PATH` (for the server mode).

```bash
# Frontend — http://localhost:4200 (proxies /api -> :3000)
npm install
npm start

# Backend — in another terminal
cd server
npm install
npm start            # http://localhost:3000
```

Auto/Browser modes work without the backend running. Start `server/` only to
exercise the server mode.

## Production

1. **Build the frontend:**
   ```bash
   npm run build        # outputs dist/mkv-to-mp3/browser
   ```
2. **Deploy** `dist/mkv-to-mp3/browser/` as static files (e.g. `/var/www/mkv-to-mp3`)
   and `server/` (e.g. `/opt/mkv-to-mp3/server`, with `npm install --omit=dev`).
3. **Run the API as a service:** copy `deploy/mkv2mp3-api.service` to
   `/etc/systemd/system/`, adjust user/paths, then
   `sudo systemctl enable --now mkv2mp3-api`.
4. **Caddy:** add the block from `deploy/Caddyfile.example` to your Caddyfile.

📦 **Step-by-step guide** for deploying on a server that already runs Caddy
(e.g. next to a Foundry VTT instance, on its own subdomain, no conflicts):
[deploy/DEPLOY.md](deploy/DEPLOY.md).

If you only want the fully-private browser mode, you can host **just the static
build** anywhere — no server required.

### Server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API port |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary |
| `MAX_UPLOAD_BYTES` | `8589934592` (8 GB) | Max upload size |
| `STATIC_DIR` | (empty) | Point it at the build and the Node server also serves the frontend (single origin, no Caddy needed) |

## Server-side privacy guarantees

- The upload is written to a randomly-named temp file **only** because ffmpeg
  needs a seekable input to read MKV.
- The MP3 is streamed directly from ffmpeg's stdout to the response — it is
  **never** written to disk.
- The temp file is deleted on completion, cancellation, or failure (`finally`).
- No file contents are logged.

## How it was verified

- **Server path:** end-to-end via HTTP upload → valid MP3 confirmed with
  `ffprobe`, and the temp upload confirmed deleted afterwards.
- **Browser path:** `scripts/e2e-client-check.mjs` (Playwright driving the system
  Chrome) uploads a test MKV, forces Browser mode, runs the real wasm conversion,
  downloads the result and validates it's a real MP3 — with zero console errors.

## License

MIT
