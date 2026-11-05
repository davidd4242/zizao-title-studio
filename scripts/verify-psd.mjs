import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readPsd } from 'ag-psd';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'verification', 'psd');

export async function verifyPsd({ artifacts = false } = {}) {
  const httpServer = createHttpServer();
  const server = await createServer({
    root, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: 'node_modules/.vite-psd-verification',
    server: { middlewareMode: true, hmr: { server: httpServer } },
    optimizeDeps: { include: ['ag-psd'], entries: [] },
  });
  server.middlewares.use('/__psd-verification', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>PSD 栅格图层验证</title></head><body></body></html>');
  });
  httpServer.on('request', server.middlewares);
  let browser;
  try {
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
    const address = httpServer.address();
    const executablePath = process.env.BROWSER_PATH || [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/__psd-verification`);
    await page.addScriptTag({ path: path.join(root, 'node_modules/ag-psd/dist/bundle.js') });
    const result = await page.evaluate(async () => {
      const { exportPsd, estimatePsdSize } = await import('/src/psd.ts');
      const engine = await import('/src/engine.ts');
      const { BASE_LAYER, DEFAULT_STYLE } = await import('/src/types.ts');
      const flat = { ...DEFAULT_STYLE, fill: '#ed567a', fill2: '#627ee7', gradient: false, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false, material: 'none', opacity: 1 };
      const rect = (x, y, width, height) => [{ type: 'M', x, y }, { type: 'L', x: x + width, y }, { type: 'L', x: x + width, y: y + height }, { type: 'L', x, y: y + height }, { type: 'Z' }];
      const glyph = (width, height, hole = false) => ({ id: 'glyph', char: 'O', x: 0, y: 0, width, height, commands: [...rect(0, 0, width, height), ...(hole ? rect(width / 3, height / 3, width / 3, height / 3) : [])] });
      const layer = (id, changes = {}) => ({ ...BASE_LAYER, id, name: id, kind: 'path', fontId: '', text: '', x: 90, y: 70, width: 100, height: 60, glyphs: [glyph(100, 60)], style: { ...flat }, ...changes });
      const project = (layers, changes = {}) => ({ version: 1, name: 'PSD 真实渲染验证', width: 320, height: 240, layers, background: { src: 'https://reference.invalid/not-exported.png', opacity: 1 }, ...changes });
      const sourceImage = document.createElement('canvas');
      sourceImage.width = 16; sourceImage.height = 12;
      const sourceContext = sourceImage.getContext('2d');
      sourceContext.fillStyle = '#22a28f'; sourceContext.fillRect(0, 0, 16, 12);
      sourceContext.clearRect(5, 3, 5, 5);
      sourceContext.fillStyle = '#e8bb65'; sourceContext.fillRect(0, 0, 6, 2);
      const star = Array.from({ length: 10 }, (_, i) => { const angle = (i * 36 - 90) * Math.PI / 180; const radius = i % 2 ? 23 : 52; return { type: i ? 'L' : 'M', x: 55 + Math.cos(angle) * radius, y: 55 + Math.sin(angle) * radius }; });
      star.push({ type: 'Z' });
      const sample = project([
        layer('bottom', { name: '底层路径 & 透明孔', x: 137.35, y: 116.65, width: 164, height: 112, glyphs: [glyph(164, 112, true)], rotation: 11, style: { ...flat, fill: '#7055be', opacity: 0.64 } }),
        layer('text', { name: '文字样式 / 金属 O', kind: 'text', x: 139.7, y: 102.4, width: 116, height: 74, glyphs: [glyph(116, 74, true)], rotation: -13, scaleX: -0.96, scaleY: 1.17, style: { ...DEFAULT_STYLE, material: 'metal', materialStrength: 0.73, gradientStops: [{ offset: 0, color: '#fff5be' }, { offset: 0.45, color: '#e3a851' }, { offset: 1, color: '#694c29' }], opacity: 0.78 } }),
        layer('star', { name: '贴纸 ★', kind: 'sticker', x: 254, y: 133, width: 110, height: 110, glyphs: [{ ...glyph(110, 110), commands: star }], scaleX: 0.6, scaleY: 0.6, rotation: 17, style: { ...DEFAULT_STYLE, fill: '#ffe596', fill2: '#e9a447' } }),
        layer('image', { kind: 'image', name: '导入图片（透明中心）', x: 249.25, y: 194.75, width: 64, height: 48, glyphs: [], imageSrc: sourceImage.toDataURL(), rotation: -8, style: { ...flat, opacity: 0.57 } }),
        layer('hidden', { name: '隐藏层 · 可回显', x: 65, y: 175, width: 44, height: 36, glyphs: [glyph(44, 36)], visible: false, locked: true, style: { ...flat, fill: '#37c9d6', opacity: 0.72 } }),
        layer('clipped', { name: '画布边缘裁切', x: -5.25, y: 215, width: 62, height: 24, glyphs: [glyph(62, 24)], style: { ...flat, fill: '#43ac79' } }),
        layer('empty', { name: '空图层', glyphs: [] }),
      ]);
      const simple = project([
        layer('red', { name: '底部红色', x: 50, y: 50, width: 40, height: 40, glyphs: [glyph(40, 40)], style: { ...flat, fill: '#ff0000' } }),
        layer('blue', { name: '上部半透明蓝', x: 60, y: 50, width: 40, height: 40, glyphs: [glyph(40, 40)], style: { ...flat, fill: '#0000ff', opacity: 0.5 } }),
        layer('hidden-yellow', { name: '隐藏黄色', visible: false, x: 20, y: 90, width: 20, height: 20, glyphs: [glyph(20, 20)], style: { ...flat, fill: '#ffff00' } }),
      ], { width: 120, height: 120 });
      const cases = [
        { id: 'full', project: sample, options: { scale: 1, crop: false, padding: 0 } },
        { id: 'crop-fractional', project: sample, options: { scale: 1.35, crop: true, padding: 7.25 } },
        { id: 'crop-small', project: sample, options: { scale: 0.31, crop: true, padding: 0 } },
        { id: 'opacity-order', project: simple, options: { scale: 1, crop: false, padding: 0 } },
        { id: 'hidden-only', project: project([simple.layers[2]], { width: 120, height: 120 }), options: { scale: 1.25, crop: true, padding: 15 } },
        { id: 'transparent', project: project([layer('zero-opacity', { style: { ...flat, opacity: 0 } }), layer('empty-layer', { glyphs: [] })], { width: 92, height: 61 }), options: { scale: 1.25, crop: true, padding: 8 } },
        { id: 'outside', project: project([layer('outside', { x: 1000, y: -500 })], { width: 80, height: 60 }), options: { scale: 1, crop: false, padding: 0 } },
      ];
      function canvas(width, height) {
        const value = document.createElement('canvas'); value.width = width; value.height = height; return value;
      }
      function pixelData(value) { return value.getContext('2d').getImageData(0, 0, value.width, value.height); }
      function fromData(data) {
        const value = canvas(data.width, data.height);
        value.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0);
        return value;
      }
      async function decode(blob) {
        const image = await createImageBitmap(blob); const value = canvas(image.width, image.height);
        value.getContext('2d').drawImage(image, 0, 0); image.close(); return value;
      }
      async function svgCanvas(source) {
        const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
        try {
          const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
          const value = canvas(image.naturalWidth, image.naturalHeight); value.getContext('2d', { alpha: true }).drawImage(image, 0, 0); return value;
        } finally { URL.revokeObjectURL(url); }
      }
      function compare(a, b) {
        let maxAlpha = 0, maxPremultiplied = 0, alphaPixels = 0, differentPixels = 0;
        for (let offset = 0; offset < a.length; offset += 4) {
          const alpha = Math.abs(a[offset + 3] - b[offset + 3]);
          maxAlpha = Math.max(maxAlpha, alpha); if (alpha) alphaPixels += 1;
          let different = !!alpha;
          for (let channel = 0; channel < 3; channel += 1) {
            const delta = Math.abs(a[offset + channel] * a[offset + 3] / 255 - b[offset + channel] * b[offset + 3] / 255);
            maxPremultiplied = Math.max(maxPremultiplied, delta); if (delta > 0.01) different = true;
          }
          if (different) differentPixels += 1;
        }
        return { maxAlpha, maxPremultiplied, alphaPixels, differentPixels };
      }
      const alphaStats = data => {
        let transparent = 0, partial = 0, opaque = 0;
        for (let i = 3; i < data.length; i += 4) { if (!data[i]) transparent += 1; else if (data[i] === 255) opaque += 1; else partial += 1; }
        return { transparent, partial, opaque };
      };
      const dataUrl = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      const results = [];
      let preview;
      for (const item of cases) {
        const before = JSON.stringify(item.project);
        const estimate = estimatePsdSize(item.project, item.options);
        const png = await engine.exportPng(item.project, item.options);
        const expected = await decode(png);
        const psdBlob = await exportPsd(item.project, item.options);
        const buffer = await psdBlob.arrayBuffer();
        const psd = window.agPsd.readPsd(buffer, { useImageData: true, skipThumbnail: true, throwForMissingFeatures: true });
        const merged = fromData(psd.imageData);
        const reconstructed = canvas(psd.width, psd.height);
        const visible = reconstructed.getContext('2d');
        // ag-psd preserves PSD record order (bottom to top), as verified by native Photoshop.
        for (const l of psd.children) if (!l.hidden && l.imageData) visible.drawImage(fromData(l.imageData), l.left, l.top);
        const expectedPixels = pixelData(expected).data;
        const root = new DOMParser().parseFromString(engine.projectSvg(item.project, item.options), 'image/svg+xml').documentElement;
        const layers = [];
        for (let index = 0; index < psd.children.length; index += 1) {
          const l = psd.children[index];
          const original = item.project.layers[index];
          const singleRoot = new DOMParser().parseFromString(engine.projectSvg({ ...item.project, layers: [{ ...original, visible: true }] }, { ...item.options, crop: false }), 'image/svg+xml').documentElement;
          for (const attribute of ['width', 'height', 'viewBox', 'preserveAspectRatio']) singleRoot.setAttribute(attribute, root.getAttribute(attribute));
          const reference = await svgCanvas(new XMLSerializer().serializeToString(singleRoot));
          const actual = canvas(psd.width, psd.height);
          if (l.imageData) actual.getContext('2d').drawImage(fromData(l.imageData), l.left, l.top);
          const data = pixelData(actual).data;
          layers.push({ name: l.name, hidden: l.hidden, opacity: l.opacity, locked: Boolean(l.protected?.all), left: l.left, top: l.top, right: l.right, bottom: l.bottom, pixelWidth: l.imageData?.width ?? 0, pixelHeight: l.imageData?.height ?? 0, stats: alphaStats(data), difference: compare(data, pixelData(reference).data) });
        }
        const samplePixel = (x, y) => [...pixelData(reconstructed).data.slice((y * psd.width + x) * 4, (y * psd.width + x) * 4 + 4)];
        results.push({ id: item.id, width: psd.width, height: psd.height, pngWidth: expected.width, pngHeight: expected.height, byteLength: buffer.byteLength, mime: psdBlob.type, channels: psd.channels, bitsPerChannel: psd.bitsPerChannel, estimate, layers, expectedNames: item.project.layers.map(l => l.name), expectedPhotoshopNames: item.project.layers.map(l => l.name).reverse(), expectedHidden: item.project.layers.map(l => !l.visible), expectedLocked: item.project.layers.map(l => l.locked), unchanged: before === JSON.stringify(item.project), mergedDifference: compare(psd.imageData.data, expectedPixels), layerDifference: compare(pixelData(reconstructed).data, expectedPixels), stats: alphaStats(expectedPixels), corners: [[0, 0], [psd.width - 1, 0], [0, psd.height - 1], [psd.width - 1, psd.height - 1]].map(([x, y]) => expectedPixels[(y * psd.width + x) * 4 + 3]), ...(item.id === 'opacity-order' ? { overlap: samplePixel(50, 50), redOnly: samplePixel(35, 50), blueOnly: samplePixel(75, 50) } : {}) });
        if (item.id === 'full') preview = { expected, merged, reconstructed, psd, sample };
        if (item.id === 'full' || item.id === 'opacity-order') {
          results[results.length - 1].files = { psd: await dataUrl(psdBlob), png: await dataUrl(png), merged: merged.toDataURL(), reconstructed: reconstructed.toDataURL() };
        }
      }
      const quantizationSource = new ImageData(256, 256);
      for (let alpha = 0; alpha < 256; alpha += 1) {
        for (let color = 0; color < 256; color += 1) {
          quantizationSource.data.set([color, 255 - color, (color * 73) & 255, alpha], (alpha * 256 + color) * 4);
        }
      }
      const quantizationFile = window.agPsd.readPsd(window.agPsd.writePsd({ width: 256, height: 256, imageData: quantizationSource, children: [{ name: '8-bit RGBA sweep', imageData: quantizationSource }] }, { noBackground: true }), { useImageData: true, skipThumbnail: true });
      const quantization = { pixelCount: 65536, composite: compare(quantizationFile.imageData.data, quantizationSource.data), layerExact: quantizationFile.children[0].imageData.data.every((value, index) => value === quantizationSource.data[index]) };
      const emptyProject = project([], { width: 64, height: 32 });
      const emptyFile = window.agPsd.readPsd(await (await exportPsd(emptyProject, { scale: 1.5, crop: true, padding: 10 })).arrayBuffer(), { useImageData: true, skipThumbnail: true });
      const empty = { width: emptyFile.width, height: emptyFile.height, channels: emptyFile.channels, layerCount: emptyFile.children.length, layerHasPixels: emptyFile.children.some(l => l.imageData?.data.some(value => value !== 0)), stats: alphaStats(emptyFile.imageData.data) };
      const invalid = [];
      for (const [id, p, options] of [
        ['scale-zero', simple, { scale: 0, crop: false, padding: 0 }],
        ['scale-infinite', simple, { scale: Infinity, crop: false, padding: 0 }],
        ['side-limit', { ...simple, width: 30001 }, { scale: 1, crop: false, padding: 0 }],
        ['memory-budget', { ...simple, width: 12000, height: 12000 }, { scale: 1, crop: false, padding: 0 }],
        ['layer-limit', { ...simple, layers: Array.from({ length: 513 }, (_, i) => ({ ...simple.layers[0], id: `many-${i}` })) }, { scale: 1, crop: false, padding: 0 }],
        ['bad-padding', simple, { scale: 1, crop: true, padding: NaN }],
      ]) {
        try { await exportPsd(p, options); invalid.push({ id, error: null }); }
        catch (error) { invalid.push({ id, error: error.message }); }
      }
      const style = document.createElement('style');
      style.textContent = 'body{margin:0;padding:34px;background:#f4f0e9;color:#282b36;font:15px system-ui}h1{font-size:30px;margin:0 0 6px}p{color:#626573;margin:0 0 26px}.row{display:flex;gap:20px;margin-bottom:26px}.preview{background:#fff;border:1px solid #d5d2cd;border-radius:12px;padding:16px}h2{font-size:16px;margin:0 0 12px}canvas{display:block;background:repeating-conic-gradient(#e4e4e4 0% 25%,#fff 0% 50%) 50%/16px 16px}.layer-list{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.layer-list .preview canvas{width:240px;height:180px;object-fit:contain}.meta{margin-top:8px;font:12px ui-monospace;color:#626573}';
      document.head.append(style);
      const heading = document.createElement('h1'); heading.textContent = 'PSD 真实浏览器验证'; document.body.append(heading);
      const description = document.createElement('p'); description.textContent = '透明 PNG → 标准 PSD → ag-psd 解码；逐层显示位置、效果、显隐与透明边缘'; document.body.append(description);
      const row = document.createElement('div'); row.className = 'row'; document.body.append(row);
      const append = (parent, title, value, meta = '') => { const block = document.createElement('section'); block.className = 'preview'; const h = document.createElement('h2'); h.textContent = title; block.append(h, value); if (meta) { const m = document.createElement('div'); m.className = 'meta'; m.textContent = meta; block.append(m); } parent.append(block); };
      append(row, '同设置 PNG', preview.expected);
      append(row, 'PSD 合成预览', preview.merged);
      append(row, '解码图层重新合成', preview.reconstructed);
      const list = document.createElement('div'); list.className = 'layer-list'; document.body.append(list);
      for (const l of [...preview.psd.children].reverse()) {
        const full = canvas(preview.psd.width, preview.psd.height); if (l.imageData) full.getContext('2d').drawImage(fromData(l.imageData), l.left, l.top);
        append(list, l.name, full, `${l.hidden ? '隐藏（此处展示像素）' : '显示'} · x=${l.left}, y=${l.top} · ${l.right - l.left}×${l.bottom - l.top}`);
      }
      return { cases: results, empty, quantization, invalid, sampleProject: preview.sample, userAgent: navigator.userAgent };
    });
    if (artifacts) {
      const full = result.cases.find(item => item.id === 'full');
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'sample.psd'), Buffer.from(full.files.psd.split(',')[1], 'base64'));
      const opacity = result.cases.find(item => item.id === 'opacity-order');
      await writeFile(path.join(output, 'opacity-order.psd'), Buffer.from(opacity.files.psd.split(',')[1], 'base64'));
      await writeFile(path.join(output, 'opacity-order.png'), Buffer.from(opacity.files.png.split(',')[1], 'base64'));
      for (const [key, name] of [['png', 'reference.png'], ['merged', 'decoded-composite.png'], ['reconstructed', 'decoded-layers.png']]) await writeFile(path.join(output, name), Buffer.from(full.files[key].split(',')[1], 'base64'));
      await writeFile(path.join(output, 'sample.title.json'), JSON.stringify(result.sampleProject, null, 2));
      await writeFile(path.join(output, 'results.json'), JSON.stringify({ ...result, cases: result.cases.map(({ files, ...item }) => item), sampleProject: undefined }, null, 2));
      await page.screenshot({ path: path.join(output, 'browser-verification.png'), fullPage: true });
    }
    assert.deepEqual(pageErrors, [], 'browser page errors');
    for (const item of result.cases) {
      assert.equal(item.mime, 'image/vnd.adobe.photoshop');
      assert.equal(item.width, item.pngWidth, `${item.id} width`);
      assert.equal(item.height, item.pngHeight, `${item.id} height`);
      assert.equal(item.width, item.estimate.width); assert.equal(item.height, item.estimate.height);
      assert.equal(item.bitsPerChannel, 8);
      assert.deepEqual(item.layers.map(l => l.name), item.expectedNames, `${item.id} layer names/order`);
      assert.deepEqual(item.layers.map(l => l.hidden), item.expectedHidden, `${item.id} hidden flags`);
      assert.deepEqual(item.layers.map(l => l.locked), item.expectedLocked, `${item.id} locked flags`);
      assert.equal(item.unchanged, true, `${item.id} project mutation`);
      assert.ok(item.mergedDifference.maxAlpha === 0, `${item.id} composite alpha ${JSON.stringify(item.mergedDifference)}`);
      // ag-psd/dist/psdWriter.js:530-551 floors C*a + 255*(1-a) into Uint8.
      // ag-psd/dist/psdReader.js:1220-1231 unmattes into Uint8ClampedArray.
      // In premultiplied units, floor error < 1 plus rounding <= 0.5*a gives < 1.5.
      assert.ok(item.mergedDifference.maxPremultiplied < 1.5, `${item.id} composite pixels ${JSON.stringify(item.mergedDifference)}`);
      assert.equal(item.layerDifference.maxAlpha, 0, `${item.id} recomposed alpha ${JSON.stringify(item.layerDifference)}`);
      assert.equal(item.layerDifference.maxPremultiplied, 0, `${item.id} recomposed pixels ${JSON.stringify(item.layerDifference)}`);
      for (const l of item.layers) {
        assert.equal(l.opacity, 1, `${item.id}/${l.name} no double opacity`);
        assert.ok(l.left >= 0 && l.top >= 0 && l.right <= item.width && l.bottom <= item.height, `${item.id}/${l.name} clipped to document`);
        assert.equal(l.difference.maxAlpha, 0, `${item.id}/${l.name} layer alpha ${JSON.stringify(l.difference)}`);
        assert.equal(l.difference.maxPremultiplied, 0, `${item.id}/${l.name} layer pixels ${JSON.stringify(l.difference)}`);
      }
    }
    assert.equal(result.quantization.pixelCount, 65536);
    assert.equal(result.quantization.composite.maxAlpha, 0, 'all 8-bit alpha values round trip exactly');
    assert.ok(result.quantization.composite.maxPremultiplied < 1.5, 'white-matte quantization bound across every 8-bit alpha/color pair');
    assert.equal(result.quantization.layerExact, true, 'all 8-bit RGBA layer bytes round trip exactly');
    assert.deepEqual(result.empty, { width: 96, height: 48, channels: 4, layerCount: 1, layerHasPixels: false, stats: { transparent: 4608, partial: 0, opaque: 0 } }, 'empty project keeps a transparent PSD placeholder layer');
    const full = result.cases.find(item => item.id === 'full');
    assert.ok(full.stats.transparent > 10000 && full.stats.partial > 1000);
    assert.deepEqual(full.corners, [0, 0, 0, 0]);
    assert.ok(full.layers.filter(l => l.pixelWidth > 0).some(l => l.left > 0 && l.top > 0));
    assert.ok(full.layers.every(l => l.pixelWidth < full.width || l.pixelHeight < full.height));
    assert.ok(full.layers.find(l => l.hidden).stats.partial > 100, 'hidden layer has pixels');
    const opacity = result.cases.find(item => item.id === 'opacity-order');
    assert.deepEqual(opacity.redOnly, [255, 0, 0, 255]);
    assert.deepEqual(opacity.blueOnly, [0, 0, 255, 128]);
    assert.deepEqual(opacity.overlap, [127, 0, 128, 255]);
    for (const id of ['hidden-only', 'transparent', 'outside']) {
      const item = result.cases.find(c => c.id === id);
      assert.equal(item.stats.transparent, item.width * item.height, `${id} full transparency`);
      assert.equal(item.channels, 4, `${id} alpha channel`);
    }
    for (const invalid of result.invalid) assert.match(invalid.error ?? '', /^PSD.*[\u3400-\u9fff]/, invalid.id);
    for (const item of [full, opacity]) {
      const sample = Buffer.from(item.files.psd.split(',')[1], 'base64');
      assert.equal(sample.subarray(0, 4).toString(), '8BPS');
      assert.equal(sample.readUInt16BE(4), 1);
      const decoded = readPsd(sample, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, throwForMissingFeatures: true });
      assert.equal(decoded.width, item.width); assert.equal(decoded.height, item.height);
      assert.deepEqual(decoded.children.map(l => l.name), item.expectedNames, `${item.id} bottom-to-top PSD record order`);
      delete item.files;
    }
    delete result.sampleProject;
    if (artifacts) await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => httpServer.close(resolve));
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPsd({ artifacts: true });
  for (const item of result.cases) console.log(`PASS ${item.id}: ${item.width}x${item.height}, ${item.layers.length} layers, composite alpha Δ${item.mergedDifference.maxAlpha}, layer alpha Δ${item.layerDifference.maxAlpha}, premultiplied RGB Δ${item.layerDifference.maxPremultiplied.toFixed(3)}`);
  console.log(`PASS empty canvas: ${result.empty.width}x${result.empty.height}, ${result.empty.stats.transparent} transparent pixels`);
  console.log(`PASS ${result.quantization.pixelCount} RGBA pairs: alpha Δ${result.quantization.composite.maxAlpha}, composite premultiplied RGB Δ${result.quantization.composite.maxPremultiplied.toFixed(3)}, layer bytes exact=${result.quantization.layerExact}`);
  console.log(`PASS ${result.invalid.length} invalid size/memory guards; 8BPS v1 readPsd round trip; artifacts: verification/psd`);
}
