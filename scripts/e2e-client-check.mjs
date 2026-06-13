// One-off verification: drives the real app in Chrome, forces BROWSER mode,
// uploads a tiny MKV, runs the conversion (exercising ffmpeg.wasm + worker),
// captures the downloaded MP3 and reports its path so ffprobe can validate it.
// Not part of the app; safe to delete.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:4200/';
const MKV = 'C:\\Users\\irene\\AppData\\Local\\Temp\\test.mkv';
const OUT = 'C:\\Users\\irene\\AppData\\Local\\Temp\\client-out.mp3';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (m) => {
  logs.push(`[${m.type()}] ${m.text()}`);
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push(`REQ FAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Navegador/ }).click();
await page.locator('input[type=file]').setInputFiles(MKV);
await page.getByRole('button', { name: /Convertir todo/ }).click();

let status = 'timeout';
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const txt = await page.locator('.job-meta').first().innerText();
  if (/Listo/.test(txt)) { status = 'done'; break; }
  if (/Error/.test(txt)) { status = 'error'; break; }
  await page.waitForTimeout(500);
}

let savedTo = null;
if (status === 'done') {
  const dl = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Descargar MP3/ }).click(),
  ]).then(([d]) => d);
  await dl.saveAs(OUT);
  savedTo = OUT;
}

let jobError = null;
if (status === 'error') {
  jobError = await page.locator('.job-error').first().innerText().catch(() => '(no .job-error text)');
}

console.log(JSON.stringify({ status, jobError, errors, logs, savedTo }, null, 2));
await browser.close();
process.exit(status === 'done' && errors.length === 0 ? 0 : 1);
