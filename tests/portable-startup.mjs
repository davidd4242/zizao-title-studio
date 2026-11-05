import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { launchObservedPortable } from '../scripts/probe-portable-startup-driver.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const execute = promisify(execFile);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const hashFile = async file => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};
if (args.includes('--prepare-only')) {
  const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const checked = await execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'probe-portable-startup-windows.ps1'), '-OutDir', path.join(root, 'verification', 'portable-startup', 'prepare'), '-CheckOnly']);
  console.log(checked.stdout.trim());
  console.log('READY: isolated portable startup harness prepared; final EXE has not been launched.');
} else {
  assert.ok(args.includes('--final-exe-ready') && value('--exe'), 'Pass --final-exe-ready --exe ABSOLUTE_FINAL_EXE only after Lead publishes the final artifact.');
  assert.ok(path.isAbsolute(value('--exe')), '--exe must be an absolute path');
  assert.equal(process.platform, 'win32', 'Native portable startup verification runs on Windows');
  const source = path.resolve(value('--exe'));
  const out = path.join(root, 'verification', 'portable-startup', `run-${Date.now()}`);
  const folder = path.join(out, 'isolated-exe');
  await mkdir(folder, { recursive: true });
  const executable = path.join(folder, '字造.exe'), profile = path.join(out, 'profile');
  await copyFile(source, executable);
  assert.deepEqual(await readdir(folder), ['字造.exe']);
  const sourceHash = await hashFile(source), copyHash = await hashFile(executable);
  assert.equal(copyHash, sourceHash);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(path|node_path|node_options|electron_run_as_node)$/i.test(key)) delete env[key];
  env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
  const checks = [], errors = [];
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`); };
  const report = { source, sourceHash, copiedExecutable: executable, profile, out, checks, errors, result: 'RUNNING' };
  let desktop;
  try {
    desktop = await launchObservedPortable({ executablePath: executable, profile, out, env });
    report.startedAt = desktop.startedAt; report.launcherPid = desktop.launcherPid;
    const page = desktop.page;
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('zizao://studio/', { timeout: 60000 });
    const settled = () => page.waitForFunction(() => {
      const marker = document.querySelector('[data-testid="state-marker"]');
      return marker?.dataset.loading === 'false' && marker.dataset.dirty === 'false' && !marker.dataset.busy;
    }, null, { timeout: 90000 });
    await settled();
    report.readyAt = Date.now();
    const runtime = await desktop.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0], handle = win.getNativeWindowHandle();
      return { version: app.getVersion(), packaged: app.isPackaged, profile: app.getPath('userData'), root: app.getAppPath(), exec: process.execPath, path: process.env.Path, windowId: win.id, hwnd: Number(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()), visible: win.isVisible(), bounds: win.getBounds(), prefs: win.webContents.getLastWebPreferences() };
    });
    report.runtime = runtime;
    const expectedVersion = value('--version') || JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    check('Final portable release starts with its bundled runtime', runtime.packaged && runtime.version === expectedVersion && !runtime.exec.includes('node_modules'));
    check('Only the isolated test profile is used', path.resolve(runtime.profile) === path.resolve(profile) && !runtime.profile.startsWith(runtime.root));
    check('Child PATH contains no system Node installation', !/nodejs|node_modules/i.test(runtime.path));
    check('Real application is visible and remains sandboxed', runtime.visible && runtime.prefs.sandbox && runtime.prefs.contextIsolation && !runtime.prefs.nodeIntegration && runtime.prefs.webSecurity);
    check('Ready workbench removes the loading overlay', await page.getByTestId('startup-overlay').count() === 0 && await page.locator('.app').getAttribute('data-startup') === 'ready');
    check('Outside network access stays blocked', await page.evaluate(() => fetch('https://example.com').then(() => false, () => true)));
    await page.screenshot({ path: path.join(out, 'ready.png') });
    report.observation = await desktop.observation();
    await desktop.stopNative();
    const nativeRows = (await readFile(path.join(desktop.native, 'windows.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    report.native = { events: nativeRows.filter(row => row.kind !== 'capture'), captures: nativeRows.filter(row => row.kind === 'capture') };
    const wrapperFrames = report.native.captures.filter(row => row.pid === desktop.launcherPid && !row.error);
    const electronFrames = report.native.captures.filter(row => row.hwnd === runtime.hwnd && !row.error);
    check('Native monitor captured a visible NSIS launcher window', wrapperFrames.length > 0);
    check('Native monitor captured the subsequent visible Electron window', electronFrames.length > 0);
    const firstNative = nativeRows.find(row => row.kind === 'visible' && row.pid === desktop.launcherPid);
    const firstElectron = nativeRows.find(row => row.kind === 'visible' && row.hwnd === runtime.hwnd);
    check('NSIS feedback appeared before the Electron workbench', firstNative.at < firstElectron.at && firstElectron.at < report.readyAt);
    const loading = report.observation.snapshots.find(row => row.visible && row.document?.text?.includes('正在加载中'));
    report.loadingSnapshot = loading;
    check('Actual packaged renderer displayed its loading text', !!loading?.file && loading.document.blurred);
    check('Loading and ready use the same native window', loading.hwnd === runtime.hwnd && loading.id === runtime.windowId);
    const bmp = await readFile(path.join(root, 'desktop', 'splash.bmp'));
    assert.equal(bmp.toString('ascii', 0, 2), 'BM');
    const templateWidth = bmp.readInt32LE(18), templateHeight = bmp.readInt32LE(22), stride = Math.ceil(templateWidth * 3 / 4) * 4;
    assert.equal(bmp.readUInt16LE(28), 24);
    const template = Buffer.alloc(templateWidth * templateHeight * 3), pixelOffset = bmp.readUInt32LE(10);
    for (let y = 0; y < templateHeight; y++) for (let x = 0; x < templateWidth; x++) {
      const src = pixelOffset + (templateHeight - y - 1) * stride + x * 3, dst = (y * templateWidth + x) * 3;
      template[dst] = bmp[src + 2]; template[dst + 1] = bmp[src + 1]; template[dst + 2] = bmp[src];
    }
    const matches = [], seen = new Set();
    for (const frame of wrapperFrames) {
      const file = path.join(desktop.native, frame.file), hash = await hashFile(file);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const pixels = await sharp(file).removeAlpha().resize(templateWidth, templateHeight, { fit: 'fill' }).raw().toBuffer();
      let squared = 0;
      for (let i = 0; i < pixels.length; i++) squared += (pixels[i] - template[i]) ** 2;
      matches.push({ ...frame, rmse: Math.sqrt(squared / pixels.length) });
    }
    matches.sort((a, b) => a.rmse - b.rmse);
    report.nsisTemplateMatch = matches[0];
    check('Visible native NSIS pixels match the actual startup BMP', matches[0]?.rmse < 5);
    const nonblankElectron = [];
    for (const frame of electronFrames) {
      const stats = await sharp(path.join(desktop.native, frame.file)).stats();
      if (stats.channels.slice(0, 3).some(channel => channel.stdev > 5)) nonblankElectron.push(frame);
    }
    check('Native Electron capture contains painted application pixels', nonblankElectron.length > 0);
    const interesting = [matches[0], matches[Math.min(1, matches.length - 1)], nonblankElectron[0], nonblankElectron[Math.min(5, nonblankElectron.length - 1)]];
    const thumbs = [];
    for (const [index, frame] of interesting.entries()) {
      const file = path.join(desktop.native, frame.file);
      const stats = await sharp(file).stats();
      check(`Native captured pixels are nonblank (${index + 1})`, stats.channels.slice(0, 3).some(channel => channel.stdev > 5));
      thumbs.push({ input: await sharp(file).resize(720, 460, { fit: 'contain', background: '#e6e6e6' }).png().toBuffer(), left: index % 2 * 720, top: Math.floor(index / 2) * 460 });
    }
    await sharp({ create: { width: 1440, height: 920, channels: 3, background: '#e6e6e6' } }).composite(thumbs).png().toFile(path.join(out, 'native-contact-sheet.png'));
    report.timings = { nsisFirstVisibleMs: firstNative.at - desktop.startedAt, electronFirstVisibleMs: firstElectron.at - desktop.startedAt, loadingObservedMs: loading.at - desktop.startedAt, readyMs: report.readyAt - desktop.startedAt };
    const catalog = await page.evaluate(async () => { const response = await fetch('/api/fonts'); if (!response.ok) throw new Error(`Font catalog HTTP ${response.status}`); return response.json(); });
    report.fonts = { count: catalog.fonts.length, bundled: catalog.fonts.filter(font => font.bundled).length, defaultFontId: catalog.defaultFontId, errors: catalog.errors };
    check('Real font catalog and bundled families load in the portable worker', catalog.fonts.length > 100 && report.fonts.bundled === 55 && !!catalog.defaultFontId);
    await page.waitForFunction(() => !!localStorage.getItem('cover-type-studio-v1'));
    const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('cover-type-studio-v1')));
    const beforeSearch = await project();
    const currentFont = await page.getByLabel('选择字体', { exact: true }).inputValue();
    const font = catalog.fonts.find(item => item.hasChinese && item.bundled && item.id !== currentFont);
    assert.ok(font, 'A second real bundled Chinese font is available');
    await page.getByLabel('搜索字体', { exact: true }).fill(font.family);
    check('Chinese font search exposes a matching real family', await page.locator(`.font-select optgroup[label="匹配字体"] option[value="${font.id}"]`).count() === 1);
    await page.getByLabel('搜索字体', { exact: true }).fill('__portable_no_matching_font__');
    check('Empty font search reports no result without replacing the used font', await page.getByTestId('font-empty').isVisible() && await page.getByLabel('选择字体', { exact: true }).isDisabled() && await page.getByLabel('选择字体', { exact: true }).inputValue() === currentFont);
    await page.getByLabel('搜索字体', { exact: true }).press('Escape');
    check('Escape clears only the font search and restores focus', await page.getByLabel('搜索字体', { exact: true }).inputValue() === '' && await page.getByLabel('搜索字体', { exact: true }).evaluate(input => document.activeElement === input));
    assert.deepEqual(await project(), beforeSearch);
    check('Search operations leave project geometry unchanged', true);
    await page.getByLabel('字体来源', { exact: true }).selectOption('bundled');
    await page.getByLabel('搜索字体', { exact: true }).fill(font.fullName);
    await page.getByLabel('选择字体', { exact: true }).selectOption(font.id);
    await settled();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('cover-type-studio-v1')).layers.at(-1).fontId === id, font.id);
    check('Choosing a searched font updates actual outline geometry', JSON.stringify((await project()).layers.at(-1).glyphs) !== JSON.stringify(beforeSearch.layers.at(-1).glyphs));
    await page.screenshot({ path: path.join(out, 'font-search.png') });
    for (const [kind, tab, label, total, query, card] of [['styles', '风格', '搜索风格', 200, '万圣', '.preset-card'], ['stickers', '装饰', '搜索装饰', 400, '星', '.sticker-card']]) {
      await page.locator('.rail').getByRole('button', { name: tab, exact: true }).click();
      const panel = page.getByTestId(`${kind}-catalog`);
      check(`${kind} catalog exposes the complete offline collection`, (await panel.getByTestId('catalog-total').innerText()).startsWith(String(total)));
      await panel.getByLabel(label, { exact: true }).fill(query);
      check(`${kind} Chinese search returns actual visible cards`, await panel.locator(card).count() > 0);
      await panel.getByLabel(label, { exact: true }).fill('__portable_no_matching_asset__');
      check(`${kind} empty search has visible recovery`, await panel.locator('.catalog-empty').isVisible() && await panel.locator(card).count() === 0);
      await panel.getByRole('button', { name: '清除筛选', exact: true }).click();
      check(`${kind} reset returns cards and an empty query`, await panel.getByLabel(label, { exact: true }).inputValue() === '' && await panel.locator(card).count() > 0);
    }
    await page.screenshot({ path: path.join(out, 'search-recovered.png') });
    const savedBeforeFailure = await page.evaluate(() => localStorage.getItem('cover-type-studio-v1'));
    let injected = 0;
    const failOnce = async route => {
      injected++;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'PORTABLE_STARTUP_API_FAILURE' }) });
    };
    await page.route('**/api/fonts', failOnce);
    await page.reload();
    await page.getByRole('alertdialog').waitFor({ timeout: 20000 });
    check('A failed font API produces a visible actionable startup error', injected > 0 && await page.getByRole('alert').innerText().then(text => text.includes('PORTABLE_STARTUP_API_FAILURE')) && await page.getByRole('button', { name: '重新加载', exact: true }).isVisible());
    check('Failed startup preserves the saved project', await page.evaluate(() => localStorage.getItem('cover-type-studio-v1')) === savedBeforeFailure);
    await page.screenshot({ path: path.join(out, 'startup-api-error.png') });
    await page.unroute('**/api/fonts', failOnce);
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await settled();
    check('Retry returns to the same real workbench', await page.getByTestId('startup-overlay').count() === 0 && await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id) === runtime.windowId);
    let releaseRequest;
    const delayed = new Promise(resolve => { releaseRequest = resolve; });
    await page.route('**/api/fonts', async route => { await delayed; await route.continue().catch(() => {}); });
    await page.reload();
    await page.getByTestId('startup-overlay').waitFor();
    await page.screenshot({ path: path.join(out, 'loading-before-exit.png') });
    const closingAt = Date.now();
    const exit = await desktop.close(); desktop = undefined;
    releaseRequest();
    report.exit = { ...exit, elapsedMs: Date.now() - closingAt };
    check('Closing while font loading is pending exits the isolated portable cleanly', exit.code === 0 && report.exit.elapsedMs < 20000);
    check('No application JavaScript errors were observed', errors.length === 0);
    report.result = 'PASS';
    console.log(JSON.stringify({ result: report.result, checks: checks.length, timings: report.timings, fonts: report.fonts, out }, null, 2));
  } catch (error) {
    report.result = 'FAIL'; report.failure = error.stack || String(error);
    console.error(report.failure); process.exitCode = 1;
  } finally {
    if (desktop) {
      report.observation = await desktop.observation().catch(() => report.observation);
      await desktop.close().catch(error => { report.cleanupError = String(error); process.exitCode = 1; });
    }
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`REPORT ${path.join(out, 'report.json')}`);
  }
}
