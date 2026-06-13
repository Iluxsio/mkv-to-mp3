'use strict';

/**
 * Ephemeral MKV -> MP3 conversion API.
 *
 * Privacy model: the upload is streamed to a uniquely-named temp file purely
 * because ffmpeg needs a seekable input for MKV. As soon as ffmpeg finishes
 * (or the request aborts/errors) the temp file is deleted. The MP3 is streamed
 * straight from ffmpeg's stdout to the response and is never written to disk.
 * Nothing about the file contents is logged.
 */

const express = require('express');
const Busboy = require('busboy');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024 * 1024); // 8 GB
// Optional: directory with the built Angular app to serve (single-origin prod).
const STATIC_DIR = process.env.STATIC_DIR || '';

const app = express();
app.disable('x-powered-by');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, maxBytes: MAX_BYTES });
});

app.post('/api/convert', (req, res) => {
  let bb;
  try {
    bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES } });
  } catch {
    return res.status(400).json({ error: 'Petición inválida' });
  }

  const tmpPath = path.join(os.tmpdir(), `mkv2mp3-${crypto.randomBytes(10).toString('hex')}.tmp`);
  let outName = 'audio';
  let gotFile = false;
  let tooBig = false;
  let finished = false;

  const cleanup = () => {
    fs.unlink(tmpPath, () => {});
  };
  const fail = (code, message) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!res.headersSent) res.status(code).json({ error: message });
    else res.destroy();
  };

  bb.on('file', (_field, stream, info) => {
    gotFile = true;
    const original = (info && info.filename) || 'audio';
    outName = path.basename(original).replace(/\.[^.]+$/, '') || 'audio';

    const ws = fs.createWriteStream(tmpPath);
    stream.on('limit', () => {
      tooBig = true;
      ws.destroy();
      stream.resume();
    });
    stream.on('error', () => fail(500, 'Error al recibir el archivo'));
    ws.on('error', () => fail(500, 'Error al guardar el archivo temporal'));
    ws.on('close', () => {
      if (tooBig) return fail(413, 'El archivo supera el tamaño máximo permitido');
      startConversion();
    });
    stream.pipe(ws);
  });

  bb.on('error', () => fail(500, 'Error procesando la subida'));
  bb.on('close', () => {
    if (!gotFile) fail(400, 'No se recibió ningún archivo');
  });

  req.on('aborted', () => fail(499, 'Cliente canceló'));
  req.pipe(bb);

  function startConversion() {
    const ff = spawn(FFMPEG, [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', tmpPath,
      '-vn',
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      '-f', 'mp3',
      'pipe:1',
    ]);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${outName}.mp3"; filename*=UTF-8''${encodeURIComponent(outName)}.mp3`,
    );

    ff.stdout.pipe(res);
    ff.stderr.resume(); // drain but don't log contents

    ff.on('error', () => fail(500, 'No se pudo iniciar ffmpeg'));
    ff.on('close', (code) => {
      cleanup();
      if (finished) return;
      finished = true;
      if (code === 0) res.end();
      else if (!res.headersSent) res.status(500).json({ error: 'La conversión falló' });
      else res.destroy();
    });

    // If the client disconnects, kill ffmpeg and remove the temp file.
    res.on('close', () => {
      if (!finished) {
        finished = true;
        try { ff.kill('SIGKILL'); } catch {}
        cleanup();
      }
    });
  }
});

// Optionally serve the built frontend from the same origin.
if (STATIC_DIR && fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (_req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
  console.log(`Serving static frontend from ${STATIC_DIR}`);
}

app.listen(PORT, () => {
  console.log(`mkv-to-mp3 server listening on http://localhost:${PORT}`);
  console.log(`Max upload: ${(MAX_BYTES / 1024 / 1024 / 1024).toFixed(1)} GB · ffmpeg: ${FFMPEG}`);
});
