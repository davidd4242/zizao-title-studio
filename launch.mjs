import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { start } from './server/index.mjs';

const url = 'http://127.0.0.1:4178';
const noBrowser = process.argv.includes('--no-browser');
async function openBrowser() {
  if (noBrowser) return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', error => console.error(`Open this address in your browser: ${url}\n${error.message}`));
  child.unref();
}
async function existingStudio() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.text()).includes('字造 · 封面标题工作室');
  } catch { return false; }
}
try {
  if (await existingStudio()) {
    console.log(`Title Studio is already running: ${url}`);
    await openBrowser();
  } else {
    await access(fileURLToPath(new URL('./dist/index.html', import.meta.url)));
    const server = await start();
    console.log(`Title Studio: ${url}\nKeep this window open while editing. Press Ctrl+C to stop.`);
    await openBrowser();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  }
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? 'Port 4178 is occupied by another application. Close that application and try again.'
    : `Startup failed: ${error.message}\nIn this folder run: npm install && npm run build`);
  process.exitCode = 1;
}
