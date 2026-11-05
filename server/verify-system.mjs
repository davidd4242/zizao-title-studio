import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { start } from './index.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const dataDir = await mkdtemp(path.join(directory, '.font-probe-'));
let server;
const close = async () => {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
  await server.fontService.close();
  server = null;
};
try {
  let begin = performance.now();
  server = await start({ port: 0, dataDir });
  const listenMs = performance.now() - begin;
  let base = `http://127.0.0.1:${server.address().port}`;
  begin = performance.now();
  const loading = fetch(`${base}/api/fonts`);
  const responsivenessBegin = performance.now();
  const duringScan = await fetch(`${base}/api/does-not-exist`);
  const duringScanMs = performance.now() - responsivenessBegin;
  assert.equal(duringScan.status, 404);
  const response = await loading;
  assert.equal(response.status, 200);
  const catalog = await response.json();
  const coldCatalogMs = performance.now() - begin;
  assert.ok(catalog.fonts.length > 0);
  const defaultFont = catalog.fonts.find(font => font.id === catalog.defaultFontId);
  assert.ok(defaultFont.hasChinese);
  const selected = [defaultFont, catalog.fonts.find(font => font.postscriptName === 'MicrosoftYaHei')].filter(Boolean);
  const outlineReports = [];
  for (const font of selected) {
    const outlineStart = performance.now();
    const result = await fetch(`${base}/api/outline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fontId: font.id, text: '封面标题\n中文 A', fontSize: 160, letterSpacing: 4, lineHeight: 1.2, align: 'center', layout: 'horizontal' }) });
    const data = await result.json();
    assert.equal(result.status, 200, JSON.stringify(data));
    assert.ok(data.glyphs.some(glyph => glyph.commands.length));
    outlineReports.push({ font: font.fullName, ms: Math.round(performance.now() - outlineStart), glyphs: data.glyphs.length, commands: data.glyphs.reduce((count, glyph) => count + glyph.commands.length, 0), missing: data.missing });
  }
  const coldStats = await server.fontService.request('stats');
  const externalRegistryFonts = catalog.fonts.filter(font => !catalog.directories.some(root => {
    const relative = path.relative(root, font.source);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }));
  await close();
  server = await start({ port: 0, dataDir });
  base = `http://127.0.0.1:${server.address().port}`;
  begin = performance.now();
  const warmResponse = await fetch(`${base}/api/fonts`);
  assert.equal(warmResponse.status, 200);
  const warmCatalog = await warmResponse.json();
  const warmCatalogMs = performance.now() - begin;
  assert.equal(warmCatalog.fonts.length, catalog.fonts.length);
  const warmStats = await server.fontService.request('stats');
  assert.equal(warmStats.filesParsed, 0);
  console.log(JSON.stringify({ listenMs: Math.round(listenMs), duringScanMs: Math.round(duringScanMs), coldCatalogMs: Math.round(coldCatalogMs), warmCatalogMs: Math.round(warmCatalogMs), fonts: catalog.fonts.length, chineseFonts: catalog.fonts.filter(font => font.hasChinese).length, defaultFont: defaultFont.fullName, externalRegistryFonts: externalRegistryFonts.length, errors: catalog.errors, coldStats, warmStats, outlines: outlineReports }, null, 2));
} finally {
  await close();
  const canonical = await realpath(dataDir);
  assert.ok(canonical.startsWith(path.join(directory, '.font-probe-')));
  await rm(canonical, { recursive: true, force: true });
}
