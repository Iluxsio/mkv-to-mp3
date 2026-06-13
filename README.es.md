# MKV → MP3

Web app para extraer el audio (MP3) de vídeos `.mkv` (y `.mp4`, `.mov`, `.avi`,
`.webm`…). Sube uno o varios archivos y descárgalos convertidos.

**Privacidad primero.** Por defecto la conversión ocurre **en el navegador** con
[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm): el archivo nunca sale
del equipo del usuario. Los archivos muy grandes (varios GB, que el navegador no
aguanta en memoria) pueden ir al **servidor**, que los convierte y **borra el
original al instante** — nada se queda en la nube.

## Cómo funciona (modos)

| Modo | Dónde convierte | Privacidad | Tamaño |
|------|-----------------|------------|--------|
| **Automático** (por defecto) | Navegador; servidor solo si supera el umbral (800 MB por defecto) | Alta | Cualquiera |
| **Navegador** | 100% en local con ffmpeg.wasm | Máxima — no sube nada | Limitado por la RAM del navegador (~1–2 GB) |
| **Servidor** | Tu backend con ffmpeg nativo | El archivo pasa por el servidor y se borra al terminar | Hasta `MAX_UPLOAD_BYTES` (8 GB por defecto) |

El núcleo de ffmpeg es **single-thread**, así que el modo navegador **no**
necesita cabeceras de aislamiento (COOP/COEP).

## Desarrollo

Requisitos: **Node ≥ 22.12** y **ffmpeg** en el PATH (para el servidor).

```bash
# Frontend (http://localhost:4200, con proxy /api -> :3000)
npm install
npm start

# Backend (en otra terminal)
cd server
npm install
npm start            # http://localhost:3000
```

En "Automático"/"Navegador" funciona sin el backend. Para probar el modo
servidor, arranca también `server/`.

## Producción

1. `npm run build` → genera `dist/mkv-to-mp3/browser`.
2. Sube el estático y `server/` al servidor.
3. API como servicio: `deploy/mkv2mp3-api.service` (systemd, `PrivateTmp=true`).
4. Caddy: añade `deploy/Caddyfile.example` (sirve estático + `reverse_proxy /api`).

(Versión en inglés más detallada en [README.md](README.md).)
