import assert from 'node:assert/strict';
import { launchPortable } from './portable-driver.mjs';
import { copyFile, cp, mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { readPsd } from 'ag-psd';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const verificationRoot = path.join(root, 'verification', 'desktop');
const out = path.join(verificationRoot, `run-${Date.now()}`);
await mkdir(out, { recursive: true });
const inputArgs = process.argv.slice(2);
const unpacked = inputArgs[0] === '--unpacked';
const supplied = inputArgs[unpacked ? 1 : 0];
assert.ok(!unpacked || supplied, '--unpacked requires the path to the directory application EXE');
assert.ok(inputArgs.length <= (unpacked ? 2 : 1), 'Unexpected desktop verification arguments');
const source = supplied ? path.resolve(supplied) : path.join(root, 'release', '字造.exe');
const mode = unpacked ? 'unpacked' : 'portable';
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function inventory(folder, relative = '') {
  const items = [];
  for (const entry of (await readdir(path.join(folder, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Packaged application contains a link: ${name}`);
    if (entry.isDirectory()) items.push(...await inventory(folder, name));
    else {
      assert.ok(entry.isFile(), `Unexpected package entry: ${name}`);
      const file = path.join(folder, name);
      items.push({ path: name, bytes: (await stat(file)).size, sha256: await fileHash(file) });
    }
  }
  return items;
}
const folder = path.join(out, unpacked ? '免安装目录 验证' : '离线 EXE 验证');
const sourceSha256 = await fileHash(source);
let sourceInventory;
let executable;
if (unpacked) {
  const sourceDirectory = path.dirname(source);
  const bundledPackage = JSON.parse(await readFile(path.join(sourceDirectory, 'resources', 'app', 'package.json'), 'utf8'));
  assert.equal(bundledPackage.version, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
  sourceInventory = await inventory(sourceDirectory);
  await cp(sourceDirectory, folder, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(await inventory(folder), sourceInventory, 'Isolated directory copy must retain every packaged byte');
  executable = path.join(folder, path.basename(source));
  await writeFile(path.join(out, 'bundle-manifest.json'), JSON.stringify({ sourceDirectory, files: sourceInventory }, null, 2));
} else {
  await mkdir(folder, { recursive: true });
  executable = path.join(folder, '字造.exe');
  await copyFile(source, executable);
  assert.deepEqual(await readdir(folder), ['字造.exe']);
}
assert.equal(await fileHash(executable), sourceSha256, 'Isolated EXE must equal the delivery source');
const profile = path.join(out, `profile-${Date.now()}`);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(path|node_path|node_options|electron_run_as_node)$/i.test(key)) delete env[key];
env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
const args = ['--smoke-test', `--user-data-dir=${profile}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'];
const checks = [];
const errors = [];
const check = (label, value) => { assert.ok(value, label); checks.push(label); console.log(`PASS ${label}`); };
let desktop;
let page;
const launch = async () => {
  desktop = await launchPortable({ executablePath: executable, args, env, timeout: 90000 });
  page = await desktop.firstWindow({ timeout: 60000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('zizao://studio/');
  await settled();
};
const settled = async () => {
  await page.waitForFunction(() => {
    const marker = document.querySelector('[data-testid="state-marker"]');
    return marker?.dataset.loading === 'false' && marker.dataset.dirty === 'false' && !marker.dataset.busy;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(700);
};
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('cover-type-studio-v1') || 'null'));
const api = (endpoint, payload) => page.evaluate(async ({ endpoint, payload }) => {
  const response = await fetch(endpoint, payload === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value;
}, { endpoint, payload });
async function download(button, name) {
  const destination = path.join(out, name);
  const downloadId = `${Date.now()}-${name}`;
  await desktop.evaluate(({ session }, { destination, downloadId }) => {
    const receipt = { id: downloadId, state: 'waiting', destination };
    globalThis.__download = receipt;
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      receipt.state = 'started';
      receipt.filename = item.getFilename();
      receipt.path = item.getSavePath();
      item.once('done', (_event, state) => {
        receipt.state = state;
        receipt.path = item.getSavePath();
        receipt.received = item.getReceivedBytes();
        receipt.total = item.getTotalBytes();
      });
    });
  }, { destination, downloadId });
  await button.click();
  const deadline = Date.now() + 30000;
  let receipt;
  while (Date.now() < deadline) {
    receipt = await desktop.evaluate(() => globalThis.__download);
    if (receipt?.id === downloadId && !['waiting', 'started'].includes(receipt.state)) {
      assert.equal(receipt.state, 'completed', JSON.stringify(receipt));
      assert.equal(path.normalize(receipt.path), path.normalize(destination), JSON.stringify(receipt));
      const written = await stat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (written) {
        assert.equal(written.size, receipt.received, JSON.stringify(receipt));
        console.log(`DOWNLOAD ${JSON.stringify(receipt)}`);
        return destination;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Download timed out: ${name}; receipt=${JSON.stringify(receipt)}`);
}
try {
  await launch();
  const runtime = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, root: app.getAppPath(), data: app.getPath('userData'), exec: process.execPath, node: process.versions.node, electron: process.versions.electron, path: process.env.Path }));
  const expectedVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  check('The packaged application contains the current release', runtime.version === expectedVersion);
  check('Packaged EXE starts with bundled Electron and Node', runtime.packaged && !!runtime.electron && !runtime.exec.includes('node_modules'));
  check('No system Node directory is present on child PATH', !/nodejs|node_modules/i.test(runtime.path));
  check('Profile and font data live outside the extracted application', runtime.data === profile && !runtime.data.startsWith(runtime.root));
  check('Stable offline origin is used for project persistence', page.url() === 'zizao://studio/');
  const files = await readdir(runtime.root);
  check('Packaged application excludes source tests and private font data', !files.includes('data') && !files.includes('tests') && !files.includes('src') && !files.includes('verification'));
  check('External network requests are blocked', await page.evaluate(() => fetch('https://example.com').then(() => false, () => true)));
  check('Browser version development server is not used', await page.evaluate(() => fetch('http://127.0.0.1:4178').then(() => false, () => true)));
  const catalog = await api('/api/fonts');
  check('Real Windows font catalog loads in packaged worker', catalog.fonts.length > 100);
  const bundled = catalog.fonts.filter(font => font.bundled);
  const bundledManifest = JSON.parse(await readFile(path.join(runtime.root, 'assets', 'fonts', 'manifest.json'), 'utf8'));
  assert.equal(bundled.length, 55);
  for (const font of bundledManifest.fonts) {
    const bytes = await readFile(path.join(runtime.root, 'assets', 'fonts', font.file));
    assert.equal(bytes.length, font.size, font.family);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256, font.family);
    assert.ok((await stat(path.join(runtime.root, 'assets', 'fonts', font.licenseFile))).size > 100);
  }
  check('All 55 bundled font families retain complete bytes hashes and licenses', bundledManifest.fonts.length === 55);
  for (const [language, text] of [['zh-Hans', '中文标题封面'], ['zh-Hant', '中文標題封面'], ['en', 'Cover Title Aa09']]) {
    const font = bundled.find(item => item.languages?.includes(language));
    assert.ok(font, language);
    const outlined = await api('/api/outline', { fontId: font.id, text, fontSize: 90, letterSpacing: 4, lineHeight: 1.2, align: 'left', layout: 'horizontal' });
    assert.deepEqual(outlined.missing, [], language);
    assert.ok(outlined.glyphs.filter(glyph => glyph.commands.length).length >= 6);
  }
  check('Bundled simplified traditional and English fonts produce real outlines offline', true);
  const initial = await project();
  const mainId = initial.layers.at(-1).id;
  check('Default Chinese title contains real glyph curves', initial.layers.at(-1).glyphs.every(glyph => glyph.commands.length > 0));
  check('Default EXE layout mode moves individual glyphs', await page.getByRole('button', { name: '逐字排版', exact: true }).evaluate(button => button.classList.contains('active')));
  const glyphBox = await page.locator('.glyph-target[data-glyph-index="1"]').boundingBox();
  assert.ok(glyphBox);
  await page.mouse.move(glyphBox.x + glyphBox.width / 2, glyphBox.y + glyphBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(glyphBox.x + glyphBox.width / 2 + 25, glyphBox.y + glyphBox.height / 2 + 12, { steps: 6 });
  await page.mouse.up(); await settled();
  const moved = (await project()).layers.at(-1);
  assert.deepEqual(moved.glyphs.flatMap((glyph, i) => JSON.stringify(glyph) === JSON.stringify(initial.layers.at(-1).glyphs[i]) ? [] : [i]), [1]);
  check('A real EXE mouse drag moves only one glyph', moved.x === initial.layers.at(-1).x && moved.y === initial.layers.at(-1).y);
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click(); await settled();
  assert.deepEqual(await project(), initial);
  check('The offline style library exposes 200 presets', (await page.getByTestId('styles-catalog').getByTestId('catalog-total').innerText()).startsWith('200'));
  await page.locator('.rail').getByRole('button', { name: '装饰', exact: true }).click();
  check('The offline decoration library exposes 400 editable stickers', (await page.getByTestId('stickers-catalog').getByTestId('catalog-total').innerText()).startsWith('400'));
  const card = page.locator('.sticker-card').first();
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox(), canvasBox = await page.getByTestId('artboard').boundingBox();
  assert.ok(cardBox && canvasBox);
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.75, canvasBox.y + canvasBox.height * 0.7, { steps: 10 });
  check('Sticker drag displays a follow preview inside EXE', await page.getByTestId('sticker-drag-preview').isVisible());
  await page.mouse.up(); await settled();
  check('Dropping a sticker creates exactly one new layer offline', (await project()).layers.length === initial.layers.length + 1);
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click(); await settled();
  await page.locator('.rail').getByRole('button', { name: '图层', exact: true }).click();
  await page.locator(`[data-layer-drop-id="${mainId}"] .layer-pick`).click();
  await page.getByLabel('标题文字', { exact: true }).fill('离线也能闪闪发光');
  await settled();
  const previous = await project();
  const different = bundled.find(font => font.hasChinese && font.id !== previous.layers.at(-1).fontId && /notosanssc/i.test(font.source));
  assert.ok(different);
  await page.getByLabel('字体来源', { exact: true }).selectOption('bundled');
  await page.getByLabel('搜索字体', { exact: true }).fill(different.fullName);
  await page.getByLabel('选择字体', { exact: true }).selectOption(different.id);
  await settled();
  check('Changing local font updates the actual geometry offline', JSON.stringify((await project()).layers.at(-1).glyphs) !== JSON.stringify(previous.layers.at(-1).glyphs));
  await page.getByRole('button', { name: '渐变预设 极光折射', exact: true }).click();
  await page.locator('.property-section>summary').filter({ hasText: '文字材质' }).click();
  await page.getByRole('button', { name: '应用材质 流心软糖', exact: true }).click();
  await page.getByRole('button', { name: '转为可编辑路径', exact: false }).click();
  await settled();
  check('Gradients materials and editable paths work in EXE', (await project()).layers.at(-1).style.material === 'jelly' && await page.getByTestId('path-node').count() > 30);
  const sourceGlyphs = structuredClone((await project()).layers.at(-1).glyphs);
  await page.locator('.property-section>summary').filter({ hasText: '花体与哥特字形' }).click();
  await page.locator('[data-letterform-id]').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-letterform-id]').count(), 5);
  await page.locator('[data-letterform-id="flourish-swash"]').click(); await settled();
  assert.notDeepEqual((await project()).layers.at(-1).glyphs, sourceGlyphs);
  await page.getByRole('button', { name: '哥特 · 5 款', exact: true }).click();
  await page.locator('[data-letterform-id]').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-letterform-id]').count(), 5);
  await page.locator('[data-letterform-id="gothic-spire"]').click(); await settled();
  assert.equal((await project()).layers.at(-1).letterform.presetId, 'gothic-spire');
  await page.getByRole('button', { name: '恢复原始字形', exact: true }).click(); await settled();
  check('Flower and gothic algorithms change and restore actual outlines offline', JSON.stringify((await project()).layers.at(-1).glyphs) === JSON.stringify(sourceGlyphs));
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.showInactive();
    window.webContents.invalidate();
    return { visible: window.isVisible(), bounds: window.getBounds() };
  });
  await page.screenshot({ path: path.join(out, 'desktop-offline.png') });
  await page.getByRole('button', { name: '导出标题', exact: true }).click();
  await page.getByLabel('输出精度', { exact: true }).selectOption('1');
  const png = await download(page.getByTestId('download-png'), 'offline-title.png');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, painted = 0;
  for (let index = 3; index < data.length; index += 4) { if (data[index] === 0) transparent++; if (data[index] > 200) painted++; }
  check('EXE saves a real transparent PNG', transparent > 10000 && painted > 1000 && info.width > 500);
  const exportedProject = await project();
  await page.getByRole('button', { name: '导出标题', exact: true }).click();
  const psdFile = await download(page.getByTestId('download-psd'), 'offline-title.psd');
  const decodedPsd = readPsd(await readFile(psdFile), { useImageData: true, skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  assert.deepEqual(decodedPsd.children.map(layer => layer.name), exportedProject.layers.map(layer => layer.name));
  check('EXE saves a real layered PSD with correct ordering', decodedPsd.width === info.width && decodedPsd.height === info.height && decodedPsd.children.length === exportedProject.layers.length);
  await page.getByRole('button', { name: '导出标题', exact: true }).click();
  await page.getByLabel('PNG导出方式', { exact: true }).selectOption('layers');
  const archiveFile = await download(page.getByTestId('download-png'), 'offline-layers.zip');
  const entries = Object.entries(unzipSync(await readFile(archiveFile)));
  assert.equal(entries.length, exportedProject.layers.filter(layer => layer.visible).length);
  for (const [name, bytes] of entries) {
    const metadata = await sharp(Buffer.from(bytes)).metadata();
    assert.equal(metadata.width, info.width, name);
    assert.equal(metadata.height, info.height, name);
    assert.equal(metadata.hasAlpha, true, name);
  }
  check('EXE saves one aligned transparent PNG per visible layer', true);
  const saved = await download(page.getByRole('button', { name: '保存工程', exact: true }), 'offline-project.zizao.json');
  check('EXE saves the editable project document', JSON.parse(await readFile(saved, 'utf8')).layers.at(-1).text === '离线也能闪闪发光');
  const font = catalog.fonts.find(item => /arial\.ttf$/i.test(item.source));
  assert.ok(font, 'Arial test font is installed');
  const directory = path.join(out, '字体关联验证');
  await mkdir(directory, { recursive: true });
  await copyFile(font.source, path.join(directory, 'linked-font.ttf'));
  const linked = await api('/api/fonts/directory', { path: directory });
  check('An external font directory is associated in EXE', linked.directories.includes(directory));
  const imported = await api('/api/fonts/import', { name: 'imported-test.ttf', data: (await readFile(font.source)).toString('base64') });
  check('Imported fonts are stored in persistent user data', imported.fonts.some(item => item.source.startsWith(profile) && item.source.includes('imported')));
  const expected = JSON.stringify((await project()).layers);
  await desktop.close(); desktop = undefined;
  await launch();
  check('Project survives a full EXE restart with changing service port', JSON.stringify((await project()).layers) === expected);
  const restored = await api('/api/fonts');
  assert.deepEqual(restored.fonts.filter(font => font.bundled).map(font => font.id).sort(), bundled.map(font => font.id).sort());
  const restoredOutline = await api('/api/outline', { fontId: different.id, text: '重启继续编辑', fontSize: 90, letterSpacing: 4, lineHeight: 1.2, align: 'left', layout: 'horizontal' });
  check(unpacked ? 'Bundled font identities and outlining survive directory application restart' : 'Bundled font identities and outlining survive portable extraction changes', restoredOutline.missing.length === 0 && restoredOutline.glyphs.length === 6);
  check('Font directory and imported files survive EXE restart', restored.directories.includes(directory) && restored.fonts.some(item => item.source.startsWith(profile) && item.source.includes('imported')));
  check('Renderer has no application errors', errors.length === 0);
  await desktop.close(); desktop = undefined;
  assert.equal(await fileHash(source), sourceSha256, 'Source EXE changed during verification');
  if (sourceInventory) assert.deepEqual(await inventory(folder), sourceInventory, 'Application must not modify its installed runtime files');
  const result = { passed: checks.length, checks, errors, mode, sourceSha256, bundle: sourceInventory ? { files: sourceInventory.length, sha256: createHash('sha256').update(JSON.stringify(sourceInventory)).digest('hex'), manifest: path.join(out, 'bundle-manifest.json') } : null, executable: source, artifacts: out, runtime, fontCount: catalog.fonts.length, png: { width: info.width, height: info.height, transparent, painted } };
  await writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(verificationRoot, `${mode}-results.json`), JSON.stringify(result, null, 2));
  console.log(`DESKTOP RESULT: ${checks.length} checks passed; offline=true; fonts=${catalog.fonts.length}; PNG=${info.width}x${info.height}; errors=${errors.length}`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(out, 'desktop-failure.png') }).catch(() => {});
  throw error;
} finally {
  if (desktop) await desktop.close().catch(() => {});
}
