import { Injectable, signal } from '@angular/core';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { apiUrl } from './config';

/**
 * Runs the MKV -> MP3 conversion entirely in the browser using ffmpeg.wasm
 * (single-threaded core, so no SharedArrayBuffer / COOP-COEP requirement).
 * The file never leaves the user's machine.
 */
@Injectable({ providedIn: 'root' })
export class FfmpegClientService {
  private ffmpeg: FFmpeg | null = null;
  private loadPromise: Promise<void> | null = null;

  readonly loaded = signal(false);
  readonly loading = signal(false);

  /** Loads the wasm core once (lazily). Safe to call repeatedly. */
  async ensureLoaded(): Promise<FFmpeg> {
    if (this.ffmpeg && this.loaded()) return this.ffmpeg;
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    await this.loadPromise;
    return this.ffmpeg!;
  }

  private async doLoad(): Promise<void> {
    this.loading.set(true);
    try {
      const ffmpeg = new FFmpeg();
      const coreURL = await toBlobURL(apiUrl('ffmpeg/ffmpeg-core.js'), 'text/javascript');
      const wasmURL = await toBlobURL(apiUrl('ffmpeg/ffmpeg-core.wasm'), 'application/wasm');
      // We ship our own bundled worker (see scripts/copy-ffmpeg-core.mjs) because
      // the app bundler leaves ffmpeg's internal worker reference unresolved.
      const classWorkerURL = apiUrl('ffmpeg/worker.js');
      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
      this.ffmpeg = ffmpeg;
      this.loaded.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Converts a single file to an MP3 blob. `onProgress` receives 0..1.
   * Input/output are written to ffmpeg's in-memory FS and deleted afterwards.
   */
  async convert(file: File, onProgress: (ratio: number) => void): Promise<Blob> {
    const ffmpeg = await this.ensureLoaded();
    const inputName = `in-${crypto.randomUUID()}.mkv`;
    const outputName = `out-${crypto.randomUUID()}.mp3`;

    const onProg = (e: { progress: number }) =>
      onProgress(Math.min(Math.max(e.progress, 0), 1));
    ffmpeg.on('progress', onProg);

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      await ffmpeg.exec(['-i', inputName, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputName]);
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      onProgress(1);
      // Copy into a fresh ArrayBuffer so the blob owns its bytes.
      return new Blob([data.slice().buffer], { type: 'audio/mpeg' });
    } finally {
      ffmpeg.off('progress', onProg);
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});
    }
  }
}
