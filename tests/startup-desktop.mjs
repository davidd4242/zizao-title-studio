import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'verification', 'startup', `run-${Date.now()}`);
await mkdir(out, { recursive: true });
const entry = path.join(out, 'entry.cjs');
const serverUrl = pathToFileURL(path.join(root, 'server', 'index.mjs')).href;
await writeFile(entry, `const { app } = require('electron');
const { registerHooks } = require('node:module');
app.setAppPath(${JSON.stringify(root)});
globalThis.__startupProbe = { entered: 0, released: 0, shown: 0 };
globalThis.__startupGate = new Promise((resolve, reject) => { globalThis.__releaseStartup = () => { globalThis.__startupProbe.released = Date.now(); resolve(); }; globalThis.__failStartup = () => reject(new Error('STARTUP_TEST_INJECTED_FAILURE')); });
app.on('browser-window-created', (_event, win) => { win.on('show', () => { globalThis.__startupProbe.shown = Date.now(); }); });
registerHooks({ load(url, context, nextLoad) { const loaded = nextLoad(url, context); if (url === ${JSON.stringify(serverUrl)}) return { ...loaded, source: 'globalThis.__startupProbe.entered = Date.now(); await globalThis.__startupGate;\\n' + String(loaded.source) }; return loaded; } });
require(${JSON.stringify(path.join(root, 'desktop', 'main.cjs'))});
`);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(node_options|electron_run_as_node)$/i.test(key)) delete env[key];
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`); };
const profile = path.join(out, 'profile');
const args = [entry, `--user-data-dir=${profile}`];
const errors = [];
let desktop;
let page;
const waitFor = async (read, predicate, message, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
};
try {
  desktop = await electron.launch({ executablePath: electronPath, args, env, timeout: 30000 });
  await waitFor(() => desktop.evaluate(() => globalThis.__startupProbe.entered), Boolean, 'Server import gate was not reached');
  const before = await desktop.evaluate(({ app, BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().map(win => ({ visible: win.isVisible(), url: win.webContents.getURL(), preferences: win.webContents.getLastWebPreferences() })),
    profile: app.getPath('userData'), probe: globalThis.__startupProbe,
  }));
  check('Main window is visible while actual server import is still waiting', before.windows.length === 1 && before.windows[0].visible && before.probe.released === 0);
  check('Startup uses the isolated test profile', path.resolve(before.profile) === path.resolve(profile));
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('正在加载中', { exact: true }).waitFor();
  check('Early loading shell has visible text and blurred workbench', await page.evaluate(() => getComputedStyle(document.querySelector('.workbench')).filter.includes('blur') && document.querySelector('[role="status"]')?.textContent.includes('正在加载中')));
  check('Early renderer remains sandboxed and isolated', before.windows[0].preferences.sandbox && before.windows[0].preferences.contextIsolation && !before.windows[0].preferences.nodeIntegration && before.windows[0].preferences.webSecurity);
  check('Early renderer blocks network access', await page.evaluate(() => fetch('https://example.com').then(() => false, () => true)));
  await page.screenshot({ path: path.join(out, 'early-loading.png') });
  const mainId = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  const { spawn } = await import('node:child_process');
  const second = spawn(electronPath, args, { env, stdio: 'ignore', windowsHide: true });
  const secondExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { second.kill(); reject(new Error('Second test instance did not exit')); }, 15000);
    second.once('error', reject);
    second.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  const focused = await waitFor(() => desktop.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return { count: windows.length, id: windows[0]?.id, visible: windows[0]?.isVisible(), minimized: windows[0]?.isMinimized(), focused: windows[0]?.isFocused() };
  }), state => state.visible && !state.minimized, 'Existing startup window was not restored');
  check('Second launch restores the existing window during slow boot', secondExit === 0 && focused.count === 1 && focused.id === mainId && focused.focused);
  await desktop.evaluate(() => globalThis.__releaseStartup());
  await page.waitForURL('zizao://studio/', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="state-marker"]')?.dataset.loading === 'false', null, { timeout: 90000 });
  const after = await desktop.evaluate(({ BrowserWindow }) => ({ id: BrowserWindow.getAllWindows()[0].id, probe: globalThis.__startupProbe }));
  check('Same main window reaches the actual offline application', after.id === mainId && after.probe.released > after.probe.shown);
  const catalog = await page.evaluate(async () => { const response = await fetch('/api/fonts'); return response.json(); });
  check('Real font worker loads after the visible shell', catalog.fonts.length > 100 && !!catalog.defaultFontId);
  check('Application still blocks outside network after startup', await page.evaluate(() => fetch('https://example.com').then(() => false, () => true)));
  await page.screenshot({ path: path.join(out, 'loaded.png') });
  await desktop.close();
  desktop = undefined;

  desktop = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${path.join(out, 'failure-profile')}`], env, timeout: 30000 });
  await waitFor(() => desktop.evaluate(() => globalThis.__startupProbe.entered), Boolean, 'Failure gate was not reached');
  page = await desktop.firstWindow();
  await page.getByText('正在加载中', { exact: true }).waitFor();
  await desktop.evaluate(() => globalThis.__failStartup());
  await page.getByRole('alert').waitFor({ timeout: 15000 });
  check('Failed startup replaces the spinner with an actionable error', await page.evaluate(() => document.body.classList.contains('failed') && document.querySelector('[role="alert"]').textContent.includes('STARTUP_TEST_INJECTED_FAILURE') && getComputedStyle(document.querySelector('.spinner')).display === 'none'));
  const logged = await readFile(path.join(out, 'failure-profile', 'startup-error.log'), 'utf8');
  check('Startup failure is written to the isolated profile log', logged.includes('STARTUP_TEST_INJECTED_FAILURE') && logged.includes('\n'));
  await page.screenshot({ path: path.join(out, 'startup-error.png') });
  await desktop.close();
  desktop = undefined;

  desktop = await electron.launch({ executablePath: electronPath, args: [entry, '--smoke-test', `--user-data-dir=${path.join(out, 'hidden-profile')}`], env, timeout: 30000 });
  await waitFor(() => desktop.evaluate(() => globalThis.__startupProbe.entered), Boolean, 'Hidden startup gate was not reached');
  const hiddenWindows = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.isVisible()));
  check('Smoke-test startup keeps the same shell hidden', hiddenWindows.length === 1 && !hiddenWindows[0]);
  const hiddenProcess = desktop.process();
  await desktop.close();
  desktop = undefined;
  check('Closing during slow startup exits without waiting for the service', hiddenProcess.exitCode === 0);

  const require = createRequire(import.meta.url);
  const config = require(path.join(root, 'desktop', 'builder.cjs'));
  const schema = JSON.parse(await readFile(path.join(root, 'node_modules', 'app-builder-lib', 'scheme.json'), 'utf8'));
  const portable = Object.values(schema.definitions).find(item => item.properties?.splashImage);
  check('Installed builder schema supports the configured portable splash', portable?.properties.splashImage.description.includes('.bmp') && config.portable.splashImage === 'desktop/splash.bmp');
  check('Independent portable extraction directory and offline packaging remain intact', config.portable.unpackDirName === true && config.asar === false && config.publish === null);
  const bmp = await readFile(path.join(root, config.portable.splashImage));
  check('Portable splash is a valid uncompressed 24-bit bitmap', bmp.toString('ascii', 0, 2) === 'BM' && bmp.readUInt32LE(2) === bmp.length && bmp.readUInt16LE(28) === 24 && bmp.readUInt32LE(30) === 0 && bmp.readInt32LE(18) === 640 && bmp.readInt32LE(22) === 360);
  check('Loading shell is included in desktop package', config.files.includes('desktop/loading.html'));
  check('Portable output uses the requested product name', config.win.artifactName === '字造.exe' && config.productName === '字造');
  const shellHtml = await readFile(path.join(root, 'desktop', 'loading.html'), 'utf8');
  check('Startup shell uses the supplied Figma neutral and lilac tokens', shellHtml.includes('#f7f7f5') && shellHtml.includes('#c5b0f4') && shellHtml.includes('#e6e6e6') && !shellHtml.includes('#0d99ff'));
  check('No application renderer errors occurred', errors.length === 0);
  const report = { checks: checks.length, result: 'PASS', before: { visible: before.windows[0].visible, probe: before.probe }, after, fonts: catalog.fonts.length, errors, out };
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (desktop) {
    await desktop.evaluate(() => globalThis.__releaseStartup?.()).catch(() => {});
    await desktop.close().catch(() => {});
  }
}
