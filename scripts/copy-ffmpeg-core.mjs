// Prepares the ffmpeg.wasm assets under public/ffmpeg so everything is served
// from our own origin (no CDN call -> better privacy, works offline):
//   1. Copies the single-threaded core (ffmpeg-core.js + .wasm).
//   2. Bundles @ffmpeg/ffmpeg's web worker into a single self-contained ESM
//      file. The Angular/esbuild app build does NOT bundle this worker (the
//      `new Worker(new URL('./worker.js', import.meta.url))` reference is left
//      as-is), so we ship our own and load it via `classWorkerURL`.
// Runs on postinstall and prebuild.
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ESM core (not UMD): ffmpeg's worker runs as a module worker, so it loads the
// core via dynamic import() and needs the build that has a default export.
const coreSrc = resolve(root, 'node_modules/@ffmpeg/core/dist/esm');
const workerSrc = resolve(root, 'node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js');
const dst = resolve(root, 'public/ffmpeg');

await mkdir(dst, { recursive: true });

for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(resolve(coreSrc, f), resolve(dst, f));
  console.log(`copied ${f} -> public/ffmpeg/${f}`);
}

await build({
  entryPoints: [workerSrc],
  bundle: true,
  format: 'esm',
  outfile: resolve(dst, 'worker.js'),
  logLevel: 'silent',
});
console.log('bundled worker.js -> public/ffmpeg/worker.js');
