import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(root, 'assets/fonts');
const reportDir = path.join(root, 'verification/bundled-fonts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const workers = new Set();
let sandbox, manifest, client, catalog;
function worker(dataDir, options = {}) {
  const instance = new Worker(new URL('../server/font-worker.mjs', import.meta.url), {
    workerData: { dataDir, includeSystemFonts: false, scanRegistry: false, fontDirectories: [], ...options }, execArgv: [],
  });
  const pending = new Map();
  let sequence = 0;
  instance.on('message', ({ id, result, error }) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (error) request.reject(new Error(`${error.status}: ${error.message}; ${error.detail}`));
    else request.resolve(result);
  });
  const rejectAll = error => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  instance.on('error', rejectAll);
  instance.on('exit', code => rejectAll(new Error(`font worker exited: ${code}`)));
  const result = {
    request(operation, value) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`font worker timeout: ${operation}`)); }, 120000);
        pending.set(id, { resolve, reject, timer });
        instance.postMessage({ id, operation, value });
      });
    },
    async close() { workers.delete(result); await instance.terminate(); },
  };
  workers.add(result);
  return result;
}
function outline(fontId, text, layout = 'horizontal') {
  return { fontId, text, fontSize: 120, letterSpacing: 0, lineHeight: 1.2, align: 'left', layout };
}
function validateGeometry(result) {
  assert.deepEqual(result.missing, []);
  assert.ok(result.width > 0 && Number.isFinite(result.width));
  assert.ok(result.height > 0 && Number.isFinite(result.height));
  assert.ok(result.glyphs.some(glyph => glyph.commands.length > 0));
  for (const glyph of result.glyphs) {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(glyph[key]), key);
    for (const command of glyph.commands) {
      assert.ok(['M', 'L', 'Q', 'C', 'Z'].includes(command.type));
      for (const [key, value] of Object.entries(command)) if (key !== 'type') assert.ok(Number.isFinite(value), `${key}: ${value}`);
    }
  }
}
const ids = fonts => Object.fromEntries(fonts.map(font => [font.family, font.id]));

before(async () => {
  await mkdir(reportDir, { recursive: true });
  sandbox = await mkdtemp(path.join(reportDir, '.test-'));
  manifest = JSON.parse(await readFile(path.join(bundleDir, 'manifest.json'), 'utf8'));
  client = worker(path.join(sandbox, 'fresh-data'));
  catalog = await client.request('catalog');
});
after(async () => {
  await Promise.all([...workers].map(item => item.close()));
  if (sandbox) {
    assert.ok(sandbox.startsWith(path.join(reportDir, '.test-')));
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('complete original font files retain pinned source, hashes, per-family licenses and measured languages', async () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.source.commit, /^[a-f0-9]{40}$/);
  assert.ok(manifest.fonts.length >= 50);
  assert.equal(new Set(manifest.fonts.map(font => font.family)).size, manifest.fonts.length);
  assert.equal(new Set(manifest.fonts.map(font => font.identity)).size, manifest.fonts.length);
  assert.ok(manifest.fonts.filter(font => font.languages.some(language => language.startsWith('zh-'))).length >= 12);
  assert.ok(manifest.fonts.filter(font => font.languages.includes('zh-Hans')).length >= 5);
  assert.ok(manifest.fonts.filter(font => font.languages.includes('zh-Hant')).length >= 5);
  assert.ok(manifest.fonts.filter(font => font.languages.includes('en') && !font.languages.some(language => language.startsWith('zh-'))).length >= 30);
  assert.ok(manifest.fonts.reduce((sum, font) => sum + font.size, 0) < 200 * 1024 * 1024);
  for (const font of manifest.fonts) {
    assert.ok(font.sourceUrl.startsWith(`${manifest.source.repository}/blob/${manifest.source.commit}/`));
    assert.ok(font.downloadUrl.includes(`/${manifest.source.commit}/`));
    assert.match(font.file, /\.(ttf|otf|woff2)$/i);
    const [bytes, license, metadata] = await Promise.all([readFile(path.join(bundleDir, font.file)), readFile(path.join(bundleDir, font.licenseFile)), readFile(path.join(bundleDir, font.metadataFile))]);
    assert.equal(hash(bytes), font.sha256, font.family);
    assert.equal(bytes.length, font.size, font.family);
    assert.equal(hash(license), font.licenseSha256, font.family);
    assert.equal(hash(metadata), font.metadataSha256, font.family);
    assert.match(metadata.toString('utf8'), /copyright:/);
    assert.ok(['OFL-1.1', 'Apache-2.0'].includes(font.license));
    if (font.license === 'OFL-1.1') {
      assert.match(license.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
      assert.match(license.toString('utf8'), /PERMISSION & CONDITIONS[\s\S]*TERMINATION[\s\S]*DISCLAIMER/);
    } else {
      assert.match(license.toString('utf8'), /Version 2\.0, January 2004/);
      assert.match(license.toString('utf8'), /4\. Redistribution[\s\S]*END OF TERMS AND CONDITIONS[\s\S]*APPENDIX/);
    }
    const face = fontkit.create(bytes);
    assert.equal(face.postscriptName, font.postscriptName, font.family);
    assert.equal(face.familyName, font.fontFamily, font.family);
    const measured = Object.entries(manifest.coverageSamples).filter(([, text]) => [...text].every(char => face.hasGlyphForCodePoint(char.codePointAt(0)))).map(([language]) => language);
    assert.deepEqual(font.languages, measured, font.family);
    for (const language of font.languages) for (const char of manifest.coverageSamples[language]) assert.ok(face.hasGlyphForCodePoint(char.codePointAt(0)), `${font.family}: ${char}`);
  }
});

test('fresh isolated worker exposes bundled records and Chinese fallback without system fonts', () => {
  assert.deepEqual(catalog.errors, []);
  assert.equal(catalog.fonts.length, manifest.fonts.length);
  const defaults = catalog.fonts.find(font => font.id === catalog.defaultFontId);
  assert.equal(defaults.family, 'Noto Sans SC');
  assert.ok(defaults.languages.includes('zh-Hans'));
  for (const font of catalog.fonts) {
    const source = manifest.fonts.find(entry => entry.family === font.family);
    assert.ok(source, font.family);
    assert.equal(font.bundled, true);
    assert.equal(font.license, source.license);
    assert.deepEqual(font.languages, source.languages);
    assert.equal(font.hasChinese, source.languages.some(language => language.startsWith('zh-')), font.family);
    assert.equal(font.source, path.join(bundleDir, source.file));
  }
  for (const font of catalog.fonts.filter(item => !item.languages.some(language => language.startsWith('zh-')))) assert.equal(font.hasChinese, false, font.family);
});

test('every advertised language outlines without missing glyphs in both layouts', async () => {
  const results = [];
  for (const font of catalog.fonts) {
    const runs = [];
    for (const language of font.languages) {
      for (const layout of ['horizontal', 'vertical']) {
        const text = manifest.coverageSamples[language];
        const result = await client.request('outline', outline(font.id, text, layout));
        validateGeometry(result);
        runs.push({ language, layout, codepoints: [...text].length, glyphs: result.glyphs.length, commands: result.glyphs.reduce((sum, glyph) => sum + glyph.commands.length, 0), missing: result.missing });
      }
    }
    assert.ok(runs.length > 0, `${font.family}: no tested language`);
    results.push({ family: font.family, id: font.id, runs });
  }
  await writeFile(path.join(reportDir, 'worker-outline-report.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString(), includeSystemFonts: false, freshConfiguration: true, fonts: results }, null, 2)}\n`);
});

test('restarting the worker reuses metadata cache and preserves all bundled IDs', async () => {
  const restarted = worker(path.join(sandbox, 'fresh-data'));
  try {
    const again = await restarted.request('catalog');
    assert.deepEqual(again.errors, []);
    assert.deepEqual(ids(again.fonts), ids(catalog.fonts));
    const stats = await restarted.request('stats');
    assert.equal(stats.filesParsed, 0);
    assert.equal(stats.metadataCacheHits, manifest.fonts.length);
  } finally { await restarted.close(); }
});

test('portable relocation keeps saved IDs with both existing and fresh cache directories', async () => {
  const relocatedDir = path.join(sandbox, 'different-extraction/assets/fonts');
  await cp(bundleDir, relocatedDir, { recursive: true });
  for (const dataDir of [path.join(sandbox, 'fresh-data'), path.join(sandbox, 'relocated-new-data')]) {
    const relocated = worker(dataDir, { bundledFontsDir: relocatedDir });
    try {
      const moved = await relocated.request('catalog');
      assert.deepEqual(moved.errors, []);
      assert.deepEqual(ids(moved.fonts), ids(catalog.fonts));
      assert.ok(moved.fonts.every(font => font.source.startsWith(relocatedDir)));
      validateGeometry(await relocated.request('outline', outline(catalog.defaultFontId, manifest.coverageSamples['zh-Hans'])));
    } finally { await relocated.close(); }
  }
});

test('includeBundledFonts false keeps directory fixtures isolated and skips a missing bundle', async () => {
  const disabled = worker(path.join(sandbox, 'disabled-data'), { includeBundledFonts: false, bundledFontsDir: path.join(sandbox, 'absent-bundle') });
  try {
    const result = await disabled.request('catalog');
    assert.deepEqual(result.fonts, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.defaultFontId, '');
  } finally { await disabled.close(); }
});

test('modified font bytes are reported rather than registered as a valid bundled face', async () => {
  const font = manifest.fonts.find(entry => entry.family === 'Anton');
  const tamperedDir = path.join(sandbox, 'tampered');
  await mkdir(path.dirname(path.join(tamperedDir, font.file)), { recursive: true });
  const bytes = await readFile(path.join(bundleDir, font.file));
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path.join(tamperedDir, font.file), bytes);
  await writeFile(path.join(tamperedDir, 'manifest.json'), JSON.stringify({ ...manifest, fonts: [font] }));
  const tampered = worker(path.join(sandbox, 'tampered-data'), { bundledFontsDir: tamperedDir });
  try {
    const result = await tampered.request('catalog');
    assert.deepEqual(result.fonts, []);
    assert.ok(result.errors.some(error => error.includes('SHA-256')));
  } finally { await tampered.close(); }
});
