import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchMeasured } from '../scripts/package-startup-driver.mjs';
import { fileHash, inspectRuntime, inventory, manifestSummary } from '../scripts/package-startup-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const final = args.includes('--final');
assert.ok(!final || args.includes('--final-startup-build-ready'), 'Final measurement requires --final-startup-build-ready');
const unpacked = path.resolve(option('--unpacked') || path.join(root, 'release/win-unpacked'));
const portable = path.resolve(option('--portable') || path.join(root, 'release/字造.exe'));
const version = option('--version'); assert.ok(version, 'Pass an explicit --version');
const name = option('--executable-name') || (final ? '字造.exe' : 'Zizao.exe');
assert.equal(path.basename(name), name);
const out = path.join(root, 'verification/startup-speed', `${final ? 'final' : 'baseline'}-${Date.now()}`);
await mkdir(out, { recursive: true });
const checks = [], runs = [];
const report = { ok: false, phase: final ? 'final' : 'baseline', version, createdAt: new Date().toISOString(), out, input: { unpacked, portable }, checks, runs, limitations: ['Same debugger attachment and hidden-window conditions for each measurement; these are usable-editor times, not native first-paint times.', 'First means a fresh application profile, not an OS cold-cache benchmark. File verification and copying read all application bytes before timing.', 'Second launch reuses that package mode\'s profile and font cache. Four runs are observations, not a statistical distribution.'] };
const check = (label, value = true) => { assert.ok(value, label); checks.push(label); console.log(`PASS ${label}`); };
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(path|node_path|node_options|electron_run_as_node)$/i.test(key)) delete env[key];
const windows = process.env.SystemRoot || 'C:/Windows';
env.Path = `${windows}/System32;${windows};${windows}/System32/WindowsPowerShell/v1.0`;
let desktop;
try {
  const original = await inspectRuntime(unpacked, name, version);
  const portableSha = await fileHash(portable);
  report.input.runtime = { package: original.package, executable: original.executable, summary: original.summary };
  report.input.portableSha256 = portableSha;
  await writeFile(path.join(out, 'source-manifest.json'), JSON.stringify(original.files, null, 2));
  check('Input runtime manifest includes executable, local service, app assets and 55 verified bundled fonts');
  const runtimeFolder = path.join(out, 'directory');
  await cp(unpacked, runtimeFolder, { recursive: true, force: false, errorOnExist: true });
  const portableFolder = path.join(out, 'portable'); await mkdir(portableFolder);
  const copiedPortable = path.join(portableFolder, '字造.exe');
  await copyFile(portable, copiedPortable);
  assert.deepEqual(await inventory(runtimeFolder), original.files);
  assert.equal(await fileHash(copiedPortable), portableSha);
  check('Both copied inputs retain every original byte');
  for (const [mode, pass] of [['directory', 1], ['portable', 1], ['directory', 2], ['portable', 2]]) {
    const folder = path.join(out, `${mode}-${pass}`); await mkdir(folder);
    const profile = path.join(out, `profile-${mode}`);
    const executable = mode === 'directory' ? path.join(runtimeFolder, name) : copiedPortable;
    console.log(`MEASURE ${mode} pass=${pass}`);
    desktop = await launchMeasured({ executablePath: executable, env, out: folder, args: ['--smoke-test', `--user-data-dir=${profile}`, '--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE [::1]'], timeout: 150000 });
    const { page, startedAt, attachedAt } = desktop;
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('zizao://studio/', { timeout: 60000 });
    await page.waitForFunction(() => { const marker = document.querySelector('[data-testid="state-marker"]'); return marker?.dataset.loading === 'false' && marker.dataset.dirty === 'false' && !marker.dataset.busy; }, null, { timeout: 90000 });
    const readyAt = Date.now();
    const runtime = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, appRoot: app.getAppPath(), executable: process.execPath, profile: app.getPath('userData'), path: process.env.Path, electron: process.versions.electron, node: process.versions.node, observedAt: Date.now(), processUptimeSeconds: process.uptime(), creationTime: typeof process.getCreationTime === 'function' ? process.getCreationTime() : null }));
    assert.equal(runtime.version, version);
    assert.equal(runtime.profile, profile);
    assert.ok(runtime.packaged && !/nodejs|node_modules/i.test(runtime.path));
    const actual = await inventory(path.dirname(runtime.executable));
    assert.deepEqual(actual, original.files, `${mode} pass ${pass} runs exactly the compared runtime`);
    const identity = manifestSummary(actual);
    const catalog = await page.evaluate(() => fetch('/api/fonts').then(response => response.json()));
    assert.ok(catalog.fonts.length > 100); assert.equal(catalog.fonts.filter(font => font.bundled).length, 55);
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('cover-type-studio-v1')).layers.some(layer => layer.glyphs?.some(glyph => glyph.commands.length > 0)); } catch { return false; } }, null, { timeout: 10000 });
    const pngPath = path.join(folder, 'startup-title.png');
    await desktop.evaluate(({ session }, destination) => {
      globalThis.__startupDownload = { state: 'waiting', destination };
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(destination);
        const record = globalThis.__startupDownload;
        record.state = 'started';
        item.once('done', (_doneEvent, state) => { record.state = state; record.path = item.getSavePath(); record.bytes = item.getReceivedBytes(); });
      });
    }, pngPath);
    const exportStarted = Date.now();
    await page.getByRole('button', { name: '导出标题', exact: true }).click();
    await page.getByLabel('输出精度', { exact: true }).selectOption('1');
    await page.getByTestId('download-png').click();
    let download;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      download = await desktop.evaluate(() => globalThis.__startupDownload);
      if (download?.state === 'completed') break;
      assert.ok(!['cancelled', 'interrupted'].includes(download?.state), JSON.stringify(download));
      await page.waitForTimeout(50);
    }
    assert.equal(download?.state, 'completed'); assert.equal(path.normalize(download.path), path.normalize(pngPath));
    const png = await readFile(pngPath); assert.equal(png.length, download.bytes);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let clear = 0, painted = 0;
    for (let index = 3; index < data.length; index += info.channels) { if (data[index] === 0) clear++; if (data[index] > 200) painted++; }
    assert.ok(clear > 1000 && painted > 1000 && info.width > 100);
    const exportMs = Date.now() - exportStarted;
    assert.deepEqual(errors, []);
    const closeAt = Date.now(); await desktop.close(); desktop = undefined;
    const run = { mode, pass, freshProfile: pass === 1, startedAt, attachedMs: attachedAt - startedAt, readyMs: readyAt - startedAt, electronStartMs: runtime.creationTime ? runtime.creationTime - startedAt : null, readyAfterElectronMs: runtime.creationTime ? readyAt - runtime.creationTime : null, exportMs, cleanExitMs: Date.now() - closeAt, runtime, manifestSha256: identity.sha256, fontCount: catalog.fonts.length, fontNotices: catalog.errors, png: { path: pngPath, size: png.length, sha256: await fileHash(pngPath), width: info.width, height: info.height, transparent: clear, painted }, rendererErrors: errors };
    runs.push(run); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    check(`${mode} pass ${pass}: same bytes, real font worker, ready editor, transparent PNG and clean exit`);
    console.log(JSON.stringify({ mode, pass, attachedMs: run.attachedMs, readyMs: run.readyMs, electronStartMs: run.electronStartMs, exportMs }));
  }
  assert.deepEqual(await inventory(runtimeFolder), original.files);
  assert.equal(await fileHash(copiedPortable), portableSha);
  check('Both installed test runtimes remain unchanged after two launches');
  report.comparison = [1, 2].map(pass => { const direct = runs.find(run => run.mode === 'directory' && run.pass === pass), packed = runs.find(run => run.mode === 'portable' && run.pass === pass); return { pass, directoryReadyMs: direct.readyMs, portableReadyMs: packed.readyMs, differenceMs: packed.readyMs - direct.readyMs, directoryLaunchToElectronMs: direct.electronStartMs, portableLaunchToElectronMs: packed.electronStartMs }; });
  report.ok = true;
} catch (error) { report.error = error.stack || String(error); console.error(report.error); process.exitCode = 1; }
finally {
  if (desktop) { try { await desktop.close(); } catch (error) { report.cleanupError = String(error); report.ok = false; process.exitCode = 1; } }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: checks.length, comparison: report.comparison, report: path.join(out, 'report.json') }));
}
