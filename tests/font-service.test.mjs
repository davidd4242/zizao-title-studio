import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { createServer, start } from '../server/index.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const windowsFonts = path.join(process.env.WINDIR || 'C:/Windows', 'Fonts');
const realTtc = path.join(windowsFonts, 'msyhbd.ttc');
const realTtf = path.join(windowsFonts, 'arial.ttf');
let sandbox, dataDir, sourceDir, distDir, server, base, catalog, chinese, latin;
const servers = [];
function raw(method, route, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${route}`, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
async function api(route, body, headers = {}) {
  const res = await raw(body === undefined ? 'GET' : 'POST', route, { headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...res, data: JSON.parse(res.text) };
}
function input(overrides = {}) {
  return { fontId: chinese.id, text: '中文标题', fontSize: 120, letterSpacing: 0, lineHeight: 1.2, align: 'left', layout: 'horizontal', ...overrides };
}
async function outline(overrides = {}) {
  const result = await api('/api/outline', input(overrides));
  assert.equal(result.status, 200, result.text);
  return result.data;
}
function approximately(actual, expected, tolerance = 0.002) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function boundsValid(result) {
  assert.ok(Number.isFinite(result.width) && result.width > 0);
  assert.ok(Number.isFinite(result.height) && result.height > 0);
  for (const glyph of result.glyphs) {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(glyph[key]), key);
    assert.ok(glyph.x >= -0.002 && glyph.y >= -0.002);
    assert.ok(glyph.x + glyph.width <= result.width + 0.002);
    assert.ok(glyph.y + glyph.height <= result.height + 0.002);
    for (const command of glyph.commands) {
      assert.ok(['M', 'L', 'Q', 'C', 'Z'].includes(command.type));
      for (const [key, value] of Object.entries(command)) if (key !== 'type') assert.ok(Number.isFinite(value));
    }
  }
}

before(async () => {
  sandbox = await mkdtemp(path.join(root, '../server/.font-test-'));
  dataDir = path.join(sandbox, 'data');
  sourceDir = path.join(sandbox, 'fonts');
  distDir = path.join(sandbox, 'dist');
  await Promise.all([mkdir(sourceDir), mkdir(distDir)]);
  await Promise.all([
    copyFile(realTtc, path.join(sourceDir, 'msyhbd.ttc')),
    copyFile(realTtf, path.join(sourceDir, 'arial.ttf')),
    writeFile(path.join(sourceDir, 'broken.ttf'), 'broken-font'),
    writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>font service fixture</title>'),
    writeFile(path.join(distDir, 'asset.js'), 'console.log("asset")'),
    writeFile(path.join(sandbox, 'outside.txt'), 'PRIVATE_FIXTURE'),
  ]);
  server = await start({ port: 0, dataDir, staticDir: distDir, fontDirectories: [sourceDir], includeSystemFonts: false, includeBundledFonts: false, scanRegistry: false });
  servers.push(server);
  base = `http://127.0.0.1:${server.address().port}`;
  const result = await api('/api/fonts');
  assert.equal(result.status, 200, result.text);
  catalog = result.data;
  chinese = catalog.fonts.find(font => font.postscriptName === 'MicrosoftYaHei-Bold');
  latin = catalog.fonts.find(font => font.postscriptName === 'ArialMT');
  assert.ok(chinese && latin, 'real TTC and TTF faces must be enumerated');
});
after(async () => {
  for (const instance of servers) {
    if (instance.listening) await new Promise(resolve => instance.close(resolve));
    await instance.fontService.close();
  }
  if (sandbox) {
    assert.ok(path.resolve(sandbox).startsWith(path.resolve(root, '../server/.font-test-')));
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('enumerates both TTC faces, localized Chinese names, default and corrupt-font errors', () => {
  assert.equal(catalog.fonts.filter(font => font.source.endsWith('msyhbd.ttc')).length, 2);
  assert.equal(chinese.family, '微软雅黑');
  assert.equal(chinese.hasChinese, true);
  assert.equal(latin.hasChinese, false);
  assert.equal(catalog.defaultFontId, chinese.id);
  assert.ok(catalog.errors.some(error => error.includes('broken.ttf')));
  assert.ok(catalog.directories.includes(sourceDir));
});

test('returns actual glyph curves in pixels with downward-positive Y and correct bounds', async () => {
  const result = await outline({ text: '文A' });
  const face = fontkit.openSync(realTtc).fonts[0];
  const original = face.glyphForCodePoint('文'.codePointAt(0));
  const glyph = result.glyphs[0];
  const scale = 120 / face.unitsPerEm;
  assert.equal(glyph.char, '文');
  assert.ok(glyph.commands.length > 20);
  assert.ok(glyph.commands.some(command => command.type === 'Q'));
  approximately(glyph.width, (original.bbox.maxX - original.bbox.minX) * scale);
  approximately(glyph.height, (original.bbox.maxY - original.bbox.minY) * scale);
  approximately(glyph.commands[0].x, (original.path.commands[0].args[0] - original.bbox.minX) * scale);
  approximately(glyph.commands[0].y, (original.bbox.maxY - original.path.commands[0].args[1]) * scale);
  boundsValid(result);
});

test('switching font faces changes geometry and both TTC faces can outline', async () => {
  const first = await outline({ text: 'AB' });
  const second = await outline({ fontId: latin.id, text: 'AB' });
  assert.notDeepEqual(first.glyphs[0].commands, second.glyphs[0].commands);
  const secondTtc = catalog.fonts.find(font => font.postscriptName === 'MicrosoftYaHeiUI-Bold');
  const third = await outline({ fontId: secondTtc.id, text: '中文' });
  assert.equal(third.fontId, secondTtc.id);
  boundsValid(third);
});

test('horizontal spacing, newlines, line height, align and font size change geometry', async () => {
  const plain = await outline({ text: '中文' });
  const spaced = await outline({ text: '中文', letterSpacing: 19 });
  approximately(spaced.glyphs[1].x - plain.glyphs[1].x, 19);
  const left = await outline({ text: '中文\n中', lineHeight: 1.5 });
  const centered = await outline({ text: '中文\n中', lineHeight: 1.5, align: 'center' });
  const right = await outline({ text: '中文\n中', lineHeight: 1.5, align: 'right' });
  approximately(left.glyphs[2].y - left.glyphs[0].y, 180);
  assert.ok(centered.glyphs[2].x > left.glyphs[2].x);
  approximately(right.glyphs[2].x - left.glyphs[2].x, 2 * (centered.glyphs[2].x - left.glyphs[2].x));
  const doubled = await outline({ text: '中文', fontSize: 240 });
  approximately(doubled.glyphs[0].width, plain.glyphs[0].width * 2);
  for (const result of [plain, spaced, left, centered, right, doubled]) boundsValid(result);
});

test('vertical text uses right-to-left new columns and vertical alignment', async () => {
  const result = await outline({ text: '中文\n中', layout: 'vertical', letterSpacing: 11, lineHeight: 1.7 });
  assert.ok(result.glyphs[1].y > result.glyphs[0].y);
  approximately((result.glyphs[1].y + result.glyphs[1].height / 2) - (result.glyphs[0].y + result.glyphs[0].height / 2), 131);
  approximately(result.glyphs[0].x - result.glyphs[2].x, 204);
  const centered = await outline({ text: '中文\n中', layout: 'vertical', letterSpacing: 11, lineHeight: 1.7, align: 'center' });
  assert.ok(centered.glyphs[2].y > result.glyphs[2].y);
  boundsValid(result);
  boundsValid(centered);
});

test('combining marks retain GPOS placement in vertical cells and letter spacing stays between graphemes', async () => {
  const plain = await outline({ fontId: latin.id, text: 'x\u0301x' });
  const spaced = await outline({ fontId: latin.id, text: 'x\u0301x', letterSpacing: 19 });
  assert.equal(plain.glyphs.length, 3);
  approximately(spaced.glyphs[1].x - spaced.glyphs[0].x, plain.glyphs[1].x - plain.glyphs[0].x);
  approximately(spaced.glyphs[2].x - plain.glyphs[2].x, 19);
  const vertical = await outline({ fontId: latin.id, text: 'x\u0301x', layout: 'vertical', letterSpacing: 19 });
  approximately(vertical.glyphs[1].x - vertical.glyphs[0].x, plain.glyphs[1].x - plain.glyphs[0].x);
  approximately(vertical.glyphs[1].y - vertical.glyphs[0].y, plain.glyphs[1].y - plain.glyphs[0].y);
  assert.ok(vertical.glyphs[1].y < vertical.glyphs[0].y);
  assert.ok(vertical.glyphs[2].y > vertical.glyphs[0].y);
  boundsValid(spaced);
  boundsValid(vertical);
});

test('spaces, blank lines, emoji and missing characters stay finite and report missing', async () => {
  const result = await outline({ fontId: latin.id, text: 'A 中🦄\n\n B' });
  assert.ok(result.missing.includes('中'));
  assert.ok(result.missing.includes('🦄'));
  assert.equal(result.missing.includes(' '), false);
  assert.ok(result.glyphs.some(glyph => glyph.char === ' ' && glyph.commands.length === 0 && glyph.width > 0));
  assert.ok(result.glyphs.some(glyph => glyph.char === '🦄'));
  boundsValid(result);
  for (const text of ['', '   ', '\n\n', 'jÁg']) boundsValid(await outline({ fontId: latin.id, text, letterSpacing: -20 }));
});

test('associates a directory without copying it and persists the association', async () => {
  const extra = path.join(sandbox, 'extra');
  await mkdir(extra);
  await copyFile(path.join(windowsFonts, 'arialbd.ttf'), path.join(extra, 'arialbd.ttf'));
  const result = await api('/api/fonts/directory', { path: extra });
  assert.equal(result.status, 200, result.text);
  assert.ok(result.data.directories.includes(extra));
  assert.ok(result.data.fonts.some(font => font.source === path.join(extra, 'arialbd.ttf')));
  assert.deepEqual(await readdir(path.join(dataDir, 'imported')), []);
  const config = JSON.parse(await readFile(path.join(dataDir, 'directories.json'), 'utf8'));
  assert.ok(config.directories.includes(extra));
  const same = await api('/api/fonts/directory', { path: extra });
  assert.equal(same.data.directories.filter(value => value === extra).length, 1);
});

test('imports validated base64 into data/imported and survives restart using metadata cache', async () => {
  const bytes = await readFile(realTtf);
  const result = await api('/api/fonts/import', { name: 'imported.ttf', data: bytes.toString('base64') });
  assert.equal(result.status, 200, result.text);
  const imported = result.data.fonts.find(font => font.source.startsWith(path.join(dataDir, 'imported')));
  assert.ok(imported);
  assert.deepEqual(await readFile(imported.source), bytes);
  const second = await start({ port: 0, dataDir, staticDir: distDir, fontDirectories: [sourceDir], includeSystemFonts: false, includeBundledFonts: false, scanRegistry: false });
  servers.push(second);
  const secondCatalog = await (await fetch(`http://127.0.0.1:${second.address().port}/api/fonts`)).json();
  assert.ok(secondCatalog.fonts.some(font => font.id === imported.id));
  assert.ok(secondCatalog.directories.includes(path.join(sandbox, 'extra')));
  const stats = await second.fontService.request('stats');
  assert.equal(stats.filesParsed, 0);
  assert.ok(stats.metadataCacheHits >= 4);
});

test('rejects malformed parameters, missing fonts, invalid imports and oversized requests', async () => {
  for (const changes of [{ fontSize: '120' }, { fontSize: 0 }, { text: 5 }, { text: 'A'.repeat(4097) }, { align: 'justify' }, { layout: 'diagonal' }, { lineHeight: 0 }, { letterSpacing: null }]) {
    const res = await api('/api/outline', input(changes));
    assert.equal(res.status, 400, JSON.stringify(changes));
    assert.equal(typeof res.data.error, 'string');
  }
  assert.equal((await api('/api/outline', input({ fontId: 'missing-font' }))).status, 404);
  assert.equal((await api('/api/fonts/directory', { path: path.join(sandbox, 'missing') })).status, 400);
  assert.equal((await api('/api/fonts/directory', { path: 'relative/path' })).status, 400);
  assert.equal((await api('/api/fonts/import', { name: '../escape.ttf', data: 'AAAA' })).status, 400);
  assert.equal((await api('/api/fonts/import', { name: 'bad.ttf', data: 'not base64!' })).status, 400);
  assert.equal((await api('/api/fonts/import', { name: 'bad.ttf', data: Buffer.from('bad font').toString('base64') })).status, 400);
  assert.equal((await raw('POST', '/api/outline', { headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await raw('POST', '/api/outline', { headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await raw('POST', '/api/outline', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'A'.repeat(70 * 1024) }) })).status, 413);
  assert.equal((await raw('PUT', '/api/fonts')).status, 405);
});

test('blocks external origins, null Origin, DNS-rebinding Host and cross-site requests', async () => {
  for (const headers of [{ Origin: 'https://example.com' }, { Origin: 'null' }, { Host: 'evil.example:4178' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const res = await api('/api/fonts', undefined, headers);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  const local = await api('/api/fonts', undefined, { Origin: 'http://localhost:5173' });
  assert.equal(local.status, 200);
  assert.equal(local.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal((await raw('OPTIONS', '/api/outline', { headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST' } })).status, 204);
  // Without the Photoshop opt-in, even a framed document navigation from another site stays blocked.
  const framed = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' };
  assert.equal((await raw('GET', '/', { headers: framed })).status, 403);
  assert.equal((await raw('GET', '/api/fonts', { headers: framed })).status, 403);
});

test('serves the dist SPA and assets without exposing local files or traversal', async () => {
  assert.equal((await raw('GET', '/')).status, 200);
  assert.match((await raw('GET', '/editor/project')).text, /font service fixture/);
  assert.match((await raw('GET', '/asset.js')).headers['content-type'], /javascript/);
  assert.equal((await raw('HEAD', '/asset.js')).text, '');
  for (const route of ['/../outside.txt', '/%2e%2e/outside.txt', '/%2e%2e%5coutside.txt', '/C:/Windows/Fonts/arial.ttf', '/server/index.mjs', '/data/directories.json', '/fonts/arial.ttf', '/api/unknown']) {
    const res = await raw('GET', route);
    assert.ok(res.status >= 400, `${route}: ${res.status}`);
    assert.equal(res.text.includes('PRIVATE_FIXTURE'), false);
  }
});

test('explicit refresh discovers new font files while ordinary catalog reads use the cache', async () => {
  const destination = path.join(sourceDir, 'arialbi.ttf');
  await copyFile(path.join(windowsFonts, 'arialbi.ttf'), destination);
  const beforeRefresh = await api('/api/fonts');
  assert.equal(beforeRefresh.data.fonts.some(font => font.source === destination), false);
  const refreshed = await api('/api/fonts?refresh=1');
  assert.equal(refreshed.status, 200, refreshed.text);
  assert.ok(refreshed.data.fonts.some(font => font.source === destination));
});

test('createServer returns an unbound Node HTTP server', async () => {
  const instance = createServer({ dataDir: path.join(sandbox, 'other-data'), fontDirectories: [], includeSystemFonts: false, includeBundledFonts: false, scanRegistry: false });
  assert.equal(instance.listening, false);
  assert.equal(typeof instance.listen, 'function');
  await instance.fontService.close();
});
