import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer as http } from 'node:http';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readPsd } from 'ag-psd';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'verification', 'psd-1.4');
const zero = { maxAlpha: 0, maxPremultiplied: 0, differentPixels: 0 };
export function assertPsdElements(result) {
  for (const item of result.cases) {
    assert.equal(item.unchanged, true, `${item.id} source mutation`);
    assert.equal(item.estimate.layerCount, item.leaves.length, `${item.id} leaf count`);
    assert.equal(item.estimate.estimatedBytes, item.independentlyEstimatedBytes, `${item.id} leaf memory budget`);
    assert.equal(item.composite.maxAlpha, 0, `${item.id} composite alpha ${JSON.stringify(item.composite)}`);
    assert.ok(item.composite.maxPremultiplied < 1.5, `${item.id} composite white-matte quantization ${JSON.stringify(item.composite)}`);
    assert.deepEqual(item.reconstructed, zero, `${item.id} actual leaf composition vs independent full-viewport reference`);
    assert.deepEqual(item.legacyDifference, item.independentLegacyDifference, `${item.id} exact overlap difference vs legacy`);
    assert.deepEqual(item.elementsVsLayersMerged, item.independentElementsVsLayersMerged, `${item.id} actual elements leaves vs actual layers-mode PSD merged`);
    assert.equal(item.tree.length, item.expectedTree.length, `${item.id} source group count`);
    for (const [index, expected] of item.expectedTree.entries()) {
      const actual = item.tree[index];
      for (const field of ['name', 'hidden', 'locked', 'opacity', 'blendMode']) assert.equal(actual[field], expected[field], `${item.id}/${expected.name}/${field}`);
      if (expected.children) assert.equal(actual.children?.length, expected.children.length, `${item.id}/${expected.name} children`);
      else assert.equal(actual.children, undefined, `${item.id}/${expected.name} image remains one leaf`);
    }
    for (const leaf of item.leaves) {
      assert.deepEqual(leaf.difference, zero, `${item.id}/${leaf.source}/${leaf.name} standalone pixels`);
      assert.equal(leaf.name, leaf.expectedName, `${item.id} leaf name/order`);
      assert.equal(leaf.actual.opacity, 1, `${item.id}/${leaf.name} opacity only once`);
      for (const field of ['left', 'top', 'right', 'bottom']) assert.equal(leaf.actual[field], leaf.expectedBounds[field], `${item.id}/${leaf.name} ${field}`);
      const parent = item.expectedTree.find(group => group.name === leaf.source);
      assert.equal(leaf.actual.locked, parent.locked, `${item.id}/${leaf.name} inherited lock`);
      assert.equal(leaf.actual.hidden, parent.children ? false : parent.hidden, `${item.id}/${leaf.name} visibility inherited from group`);
    }
  }
  assert.deepEqual(result.cases.find(item => item.id === 'disjoint').legacyDifference, zero, 'non-overlapping gradient/depth/stroke retain exact layers-mode pixels');
  assert.deepEqual(result.cases.find(item => item.id === 'disjoint-filter-rounding').legacyDifference, { maxAlpha: 0, maxPremultiplied: 1, differentPixels: 1040 }, 'Chromium filtered SourceGraphic gradient quantization is measured exactly, not treated as zero');
  for (const id of ['overlap-shadow', 'overlap-depth', 'overlap-jelly']) assert.ok(result.cases.find(item => item.id === id).legacyDifference.differentPixels > 0, `${id} measured non-distributivity`);
  assert.deepEqual(result.cases.find(item => item.id === 'overlap-opacity').legacyDifference, zero, 'opacity is applied once to the group');
  const flower = result.cases.find(item => item.id === 'letterform');
  assert.deepEqual(flower.leaves.map(leaf => leaf.glyphIndices), [[0, 1, 3], [2, 4]], 'ornaments and bridge remain attached to their source character');
  assert.equal(flower.estimate.layerCount, 2);
  assert.ok(result.cases.find(item => item.id === 'sample').leaves.filter(leaf => leaf.source === '隐藏锁定路径').every(leaf => leaf.nonzeroAlpha > 0), 'hidden elements retain real pixels');
  assert.equal(result.accepted512.layerCount, 512, '512 hidden leaves accepted by limit');
  for (const invalid of result.invalid) assert.equal(invalid.name, 'RangeError', `${invalid.id} must fail in real exportPsd with RangeError`);
  assert.match(result.invalid.find(row => row.id === 'leaf-limit').error, /513.*512.*拆分图层/, '513-leaf error reports actual count and split guidance');
  assert.match(result.invalid.find(row => row.id === 'leaf-memory').error, /超过 512 MB/, 'leaf memory budget enforced before rasterizing');
  assert.equal(result.memory.layers.layerCount, 1); assert.equal(result.memory.elements.layerCount, 40);
  assert.ok(result.memory.layers.estimatedBytes < 512 * 1024 * 1024 && result.memory.elements.estimatedBytes > 512 * 1024 * 1024, 'same source layer fits layers mode and exceeds elements budget');
  for (const row of result.legacyBytes) { assert.equal(row.exact, true, `${row.id} default bytes equal pre-1.4 export path`); assert.equal(row.explicitExact, true, `${row.id} explicit layers bytes equal pre-1.4 export path`); }
  assert.deepEqual(result.empty, { width: 40, height: 30, children: 1, nonzero: false }, 'empty transparent placeholder');
  assert.equal(result.ui.initial.mode, 'layers'); assert.match(result.ui.initial.text, /PSD 共 2 个叶层/);
  assert.equal(result.ui.switched.mode, 'elements'); assert.match(result.ui.switched.text, /PSD 共 3 个叶层.*预计.*秒/);
  assert.match(result.ui.switched.note, /重叠的投影、厚度和材质效果/); assert.equal(result.ui.selectedFormat, 'psd');
  assert.equal(result.ui.limitUI.disabled, true); assert.match(result.ui.limitUI.text, /513 个叶层/); assert.match(result.ui.limitUI.alert, /拆分图层/);
  assert.equal(result.ui.memoryUI.disabled, true); assert.match(result.ui.memoryUI.alert, /512 MB/);
}

export async function verifyPsdElements({ reproOnly = false, artifacts = false, diagnoseDisjoint = false } = {}) {
  const listener = http();
  const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: path.join(output, 'vite-cache'), esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: { server: listener } }, optimizeDeps: { include: ['ag-psd', 'react', 'react-dom', 'react-dom/client', 'lucide-react'], entries: [] } });
  server.middlewares.use('/__psd-elements', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body></body></html>'); });
  listener.on('request', server.middlewares);
  let browser;
  try {
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const executablePath = process.env.BROWSER_PATH || [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${listener.address().port}/__psd-elements`);
    await page.addScriptTag({ path: path.join(root, 'node_modules/ag-psd/dist/bundle.js') });
    if (diagnoseDisjoint) {
      const disjoint = await page.evaluate(async () => (await import('/scripts/verify-psd-elements-browser.mjs')).probeDisjoint());
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'disjoint-probe.json'), JSON.stringify(disjoint, null, 2));
      return disjoint;
    }
    const result = await page.evaluate(async args => (await import('/scripts/verify-psd-elements-browser.mjs')).runElementChecks(args), { reproOnly, artifacts });
    assert.deepEqual(errors, [], 'browser page errors');
    if (artifacts) {
      await mkdir(output, { recursive: true });
      for (const row of result.overlap) for (const name of ['combined', 'separated']) if (row[name]) { await writeFile(path.join(output, `overlap-${row.id}-${name}.png`), Buffer.from(row[name].split(',')[1], 'base64')); delete row[name]; }
      for (const item of result.cases ?? []) if (item.files) {
        const { files } = item;
        const buffer = Buffer.from(files.psd.split(',')[1], 'base64');
        assert.equal(buffer.subarray(0, 4).toString(), '8BPS'); assert.equal(buffer.readUInt16BE(4), 1);
        const decoded = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, throwForMissingFeatures: true });
        assert.deepEqual(decoded.children.map(layer => layer.name), item.tree.map(layer => layer.name), `${item.id} native PSD record order`);
        await writeFile(path.join(output, `${item.id}.psd`), buffer);
        for (const key of ['reference', 'legacy', 'merged', 'recomposed']) await writeFile(path.join(output, `${item.id}-${key}.png`), Buffer.from(files[key].split(',')[1], 'base64'));
        await writeFile(path.join(output, `${item.id}.title.json`), JSON.stringify(files.project, null, 2));
        await writeFile(path.join(output, `${item.id}-expected.json`), JSON.stringify({ width: item.width, height: item.height, bottomToTop: item.expectedTree, photoshopTopToBottom: item.expectedTree.toReversed().map(group => ({ ...group, ...(group.children ? { children: group.children.toReversed() } : {}) })), leaves: item.leaves.map(({ difference, ...leaf }) => leaf) }, null, 2));
        delete item.files;
      }
      await writeFile(path.join(output, reproOnly ? 'overlap-repro.json' : 'results.json'), JSON.stringify(result, null, 2));
    }
    return result;
  } finally { await browser?.close(); await server.close(); await new Promise(resolve => listener.close(resolve)); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPsdElements({ reproOnly: process.argv.includes('--repro'), artifacts: true, diagnoseDisjoint: process.argv.includes('--disjoint') });
  if (process.argv.includes('--repro') || process.argv.includes('--disjoint')) console.log(JSON.stringify(result, null, 2));
  else {
    assertPsdElements(result);
    for (const item of result.cases) console.log(`PASS ${item.id}: ${item.width}x${item.height}, ${item.leaves.length} leaves; standalone/recomposition alpha=0 RGB=0; composite alpha=${item.composite.maxAlpha} premult=${item.composite.maxPremultiplied.toFixed(6)}; legacy delta=${JSON.stringify(item.legacyDifference)}; ${item.durationMs.toFixed(1)} ms`);
    for (const item of result.cases.filter(item => ['disjoint', 'disjoint-filter-rounding', 'sample', 'sample-crop'].includes(item.id))) console.log(`MODE COMPARISON ${item.id}: elements leaves vs layers PSD merged=${JSON.stringify(item.elementsVsLayersMerged)}; stored merged vs stored merged=${JSON.stringify(item.mergedModesDifference)}`);
    console.log(`PASS original export bytes: ${JSON.stringify(result.legacyBytes)}`);
    console.log(`PASS leaf guards: ${JSON.stringify(result.invalid)}; memory layers=${result.memory.layers.estimatedBytes} elements=${result.memory.elements.estimatedBytes}`);
    console.log(`PASS real React UI: ${JSON.stringify(result.ui)}`);
    console.log(`PASS PSD elements verification; artifacts: ${output}`);
  }
}
