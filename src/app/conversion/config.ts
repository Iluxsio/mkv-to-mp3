/** Default size (MB) above which "auto" mode prefers the server over the browser.
 *  ffmpeg.wasm loads the whole file into memory, so very large files
 *  (several GB) are routed to the server to avoid running out of memory. */
export const DEFAULT_SERVER_THRESHOLD_MB = 800;

/** Accepted input extensions (the converter still works with any container
 *  ffmpeg can read; this just drives the file picker / drag&drop hinting). */
export const ACCEPTED_EXTENSIONS = ['.mkv', '.mp4', '.mov', '.avi', '.webm', '.flv', '.m4v'];

export type ConvMode = 'auto' | 'client' | 'server';

/** Resolves a same-origin API url, working both at root and under a sub-path. */
export function apiUrl(pathname: string): string {
  return new URL(pathname.replace(/^\//, ''), document.baseURI).href;
}
