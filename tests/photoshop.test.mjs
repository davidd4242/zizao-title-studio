import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { Script } from 'node:vm';
import { startEditor } from '../photoshop/runtime/server.mjs';
import host from '../photoshop/panel/host.cjs';
import { collectDependencies, renderManifest } from '../scripts/package-photoshop.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'a'.repeat(64);
let directory, runtime;
function raw(route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(runtime.origin + route, { headers }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', data => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}
function psd() {
  const bytes = Buffer.alloc(26); bytes.write('8BPS'); bytes.writeUInt16BE(1, 4); bytes.writeUInt16BE(4, 12); bytes.writeUInt32BE(100, 14); bytes.writeUInt32BE(200, 18); bytes.writeUInt16BE(8, 22); bytes.writeUInt16BE(3, 24); return bytes;
}
function message(overrides = {}) {
  return { type: 'zizao:psd', version: 1, token, requestId: 'psd-1', mode: 'new-document', name: '测试标题', base64: psd().toString('base64'), ...overrides };
}
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'zizao-cep-test-'));
  const fonts = path.join(directory, 'fonts'); await mkdir(fonts);
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/fonts/manifest.json'), 'utf8'));
  const font = manifest.fonts.find(item => item.slug === 'bangers');
  assert.ok(font);
  await copyFile(path.join(root, 'assets/fonts', font.file), path.join(fonts, 'bangers.ttf'));
  runtime = await startEditor({ token, editorRoot: root, port: 0, dataDir: path.join(directory, 'data'), fontDirectories: [fonts], includeSystemFonts: false, includeBundledFonts: false, scanRegistry: false });
});
after(async () => {
  if (runtime) await runtime.close();
  if (directory) { assert.ok(directory.startsWith(path.join(os.tmpdir(), 'zizao-cep-test-'))); await rm(directory, { recursive: true, force: true }); }
});
test('font APIs require the instance token, including percent-encoded paths', async () => {
  for (const route of ['/api/fonts', '/%61pi/fonts', '/api%2Ffonts', '/__bridge/health']) {
    assert.equal((await raw(route)).status, 403, route);
    assert.equal((await raw(route, { 'X-Zizao-Token': 'b'.repeat(64) })).status, 403, route);
  }
});
test('correct token enumerates a real bundled font and health identifies standalone Node', async () => {
  const response = await raw('/api/fonts', { 'X-Zizao-Token': token });
  assert.equal(response.status, 200, response.text);
  const catalog = JSON.parse(response.text);
  assert.equal(catalog.fonts.length, 1);
  assert.match(catalog.fonts[0].fullName, /Bangers/);
  const health = await raw('/__bridge/health', { 'X-Zizao-Token': token });
  assert.equal(JSON.parse(health.text).runtime, process.version);
});
test('HTTP Host and Origin must match this exact panel instance', async () => {
  assert.equal((await raw('/api/fonts', { 'X-Zizao-Token': token, Origin: 'http://127.0.0.1:1234' })).status, 403);
  assert.equal((await raw('/api/fonts', { 'X-Zizao-Token': token, Origin: 'https://example.com' })).status, 403);
  assert.equal((await raw('/api/fonts', { 'X-Zizao-Token': token, Host: 'localhost:1234' })).status, 403);
  assert.equal((await raw('/__bridge/health', { 'X-Zizao-Token': token, Origin: runtime.origin })).status, 200);
});
test('PSD accepts validated RGB8 bytes and explicit import modes', () => {
  const checked = host.validateMessage(message(), token);
  assert.equal(checked.name, '测试标题'); assert.equal(checked.mode, 'new-document'); assert.deepEqual(checked.bytes, psd());
  const array = Uint8Array.from(psd()).buffer;
  assert.deepEqual(host.validateMessage(message({ bytes: array, base64: undefined, mode: 'insert-layers' }), token).bytes, psd());
});
test('large PSD base64 payloads validate without regex stack overflow', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  psd().copy(bytes);
  assert.deepEqual(host.validateMessage(message({ base64: bytes.toString('base64') }), token).bytes, bytes);
  for (const value of ['A===', 'AA=A', 'AAAAA', '=AAA']) assert.throws(() => host.validateMessage(message({ base64: value }), token));
});
test('PSD rejects foreign tokens, commands, invalid headers and wrong modes', () => {
  for (const value of [message({ token: 'b'.repeat(64) }), message({ mode: 'evalScript' }), message({ requestId: '../test' }), message({ base64: 'invalid!!!' }), message({ base64: Buffer.from('not a PSD').toString('base64') })]) assert.throws(() => host.validateMessage(value, token));
  const large = psd(); large.writeUInt32BE(30001, 18);
  assert.throws(() => host.validateMessage(message({ base64: large.toString('base64') }), token));
  const cmyk = psd(); cmyk.writeUInt16BE(4, 24);
  assert.throws(() => host.validateMessage(message({ base64: cmyk.toString('base64') }), token));
});
test('JSX arguments quote script delimiters and names cannot become file paths', () => {
  const calls = [];
  const name = 'x");app.activeDocument.close(); //\u2028line';
  const script = new Script(host.jsxCall('C:\\临时\\title.psd', name, 'new-document'));
  script.runInNewContext({ Zizao: { importPsd: (...args) => calls.push(args) } });
  assert.deepEqual(calls, [['C:\\临时\\title.psd', name, 'new-document']]);
  assert.equal(host.safeName('CON'), '字造标题');
  assert.equal(host.safeName('../a:b.psd'), '.._a_b.psd');
  assert.ok(host.safeName('x'.repeat(200)).length <= 100);
});
test('production dependency closure includes real runtime transitive packages', async () => {
  const packages = await collectDependencies(path.join(root, 'package.json'));
  for (const name of ['fontkit', 'restructure', 'brotli', 'unicode-properties', 'react', 'react-dom', 'ag-psd', 'fflate']) assert.ok(packages.some(item => item.name === name), name);
  assert.ok(!packages.some(item => ['electron', 'vite', 'typescript', 'playwright'].includes(item.name)));
});
test('CEP package version follows the root manifest and product name is 字造', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const template = await readFile(path.join(root, 'photoshop/CSXS/manifest.xml'), 'utf8');
  const manifest = renderManifest(template, pkg.version);
  assert.ok(manifest.includes(`ExtensionBundleVersion="${pkg.version}"`));
  assert.ok(manifest.includes(`Id="com.zizao.title-studio.panel" Version="${pkg.version}"`));
  assert.ok(manifest.includes('ExtensionBundleName="字造"'));
  assert.ok(manifest.includes('<Menu>字造</Menu>'));
  assert.ok(!manifest.includes('{{VERSION}}'));
  assert.throws(() => renderManifest(template, '1.2.0\" bad=\"value'));
  assert.throws(() => renderManifest(template.replace('{{VERSION}}', '1.0.0'), pkg.version));
});
test('CEP manifest points to real files and JSX parses before Photoshop evaluation', async () => {
  const manifest = await readFile(path.join(root, 'photoshop/CSXS/manifest.xml'), 'utf8');
  assert.match(manifest, /RequiredRuntime Name="CSXS" Version="12.0"/);
  assert.match(manifest, /\[25\.12,27\.99\]/);
  for (const file of ['panel/index.html', 'panel/panel.js', 'panel/host.cjs', 'jsx/import.jsx', 'runtime/server.mjs']) assert.ok((await readFile(path.join(root, 'photoshop', file))).length > 0);
  new Script(await readFile(path.join(root, 'photoshop/jsx/import.jsx'), 'utf8'));
  const html = await readFile(path.join(root, 'photoshop/panel/index.html'), 'utf8');
  assert.match(html, /iframe[^>]+disable-nodejs/);
});
