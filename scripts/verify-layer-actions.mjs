import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { outlineFont } from '../server/outline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'verification/layer-actions');
const bytes = value => Buffer.from(value.split(',')[1], 'base64');
async function pixels(value) { return sharp(value).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); }
function difference(a, b) {
  assert.equal(a.length, b.length);
  let maxAlpha = 0, maxPremultiplied = 0, changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const da = Math.abs(a[i + 3] - b[i + 3]);
    maxAlpha = Math.max(maxAlpha, da);
    let different = da !== 0;
    for (let c = 0; c < 3; c++) {
      const dc = Math.abs(a[i + c] * a[i + 3] / 255 - b[i + c] * b[i + 3] / 255);
      maxPremultiplied = Math.max(maxPremultiplied, dc);
      if (dc > 0.01) different = true;
    }
    if (different) changed++;
  }
  return { maxAlpha, maxPremultiplied, changed };
}
function quantizationEnvelope(before, after, reference) {
  let violations = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (Math.abs(before[i + 3] - after[i + 3]) > Math.abs(before[i + 3] - reference[i + 3])) violations++;
    for (let c = 0; c < 3; c++) {
      const original = before[i + c] * before[i + 3] / 255;
      const actual = after[i + c] * after[i + 3] / 255;
      const expected = reference[i + c] * reference[i + 3] / 255;
      if (Math.abs(original - actual) > Math.abs(original - expected) + 1e-9) violations++;
    }
  }
  return violations;
}
function roundingProof(count) {
  // C'=Cs+Cd(1-As), A'=As+Ad(1-As). Each nearest-byte round has q<=0.5.
  // n sequential blends: |eC|,|eA|<=nq. Group then backdrop: |eC|<=2nq+q.
  // Subtract the paths: |deltaC|<=(3n+1)q, |deltaA|<=(2n+1)q.
  // Reading two straight-alpha PNGs as premultiplied adds <=0.5 each.
  // This is a conservative fixture bound, not the product acceptance oracle:
  // the independent identity-filter SVG below must match the result exactly.
  const over = (s, d) => [s[0] + Math.round(d[0] * (255 - s[1]) / 255), s[1] + Math.round(d[1] * (255 - s[1]) / 255)];
  const backdrop = [170, 217], sources = [[88, 213], [89, 210], [13, 13]];
  const direct = sources.reduce((destination, source) => over(source, destination), backdrop);
  const grouped = over(sources.reduce((destination, source) => over(source, destination), [0, 0]), backdrop);
  assert.deepEqual(direct, [116, 254]); assert.deepEqual(grouped, [118, 254]);
  return { sourceGroups: count, roundingPerBlend: 0.5, alphaBound: (2 * count + 1) / 2, premultipliedBound: (3 * count + 1) / 2 + 1, counterexample: { backdrop, sources, direct, grouped, channelDifference: 2 } };
}
function alphaStats({ data, info }) {
  let transparent = 0, partial = 0, filled = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (!data[i]) transparent++;
    else { filled++; if (data[i] < 255) partial++; }
  }
  return { transparent, partial, filled, corners: [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]].map(([x, y]) => data[(y * info.width + x) * 4 + 3]) };
}
export async function verifyLayerActions({ artifacts = false, diagnostics = false } = {}) {
  const fontPath = [process.env.STYLE_TEST_FONT, 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttf'].find(file => file && existsSync(file));
  assert.ok(fontPath, 'A real Chinese font is required');
  const file = fontkit.create(readFileSync(fontPath));
  const font = file.fonts?.[0] || file;
  const text = outlineFont(font, { fontId: 'real-test-font', text: '字造', fontSize: 58, letterSpacing: 4, lineHeight: 1.2, align: 'left', layout: 'horizontal' });
  assert.deepEqual(text.missing, []);
  const vite = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: 'node_modules/.vite-layer-actions-verification', server: { middlewareMode: true, hmr: false }, optimizeDeps: { include: ['fflate'], entries: [] } });
  vite.middlewares.use('/__layer-actions', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>图层操作验收</title></head><body></body></html>');
  });
  const server = httpServer(vite.middlewares);
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const executablePath = process.env.BROWSER_PATH || [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1180, height: 850 } });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:')) { externalRequests.push(url); await route.abort(); }
      else await route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/__layer-actions`);
    const data = await page.evaluate(async ({ outline, diagnostics }) => {
      const engine = await import('/src/engine.ts');
      const { exportLayerPngs, mergeLayers } = await import('/src/layer-actions.ts');
      const { BASE_LAYER, DEFAULT_STYLE } = await import('/src/types.ts');
      const flat = { ...DEFAULT_STYLE, fill: '#ee637c', fill2: '#c8d2ff', gradient: false, strokeWidth: 0, outerWidth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, depth: 0, material: 'none', texture: 'none', gloss: false, opacity: 1 };
      const rect = (x, y, width, height) => [{ type: 'M', x, y }, { type: 'L', x: x + width, y }, { type: 'L', x: x + width, y: y + height }, { type: 'L', x, y: y + height }, { type: 'Z' }];
      const glyph = (width, height, hole = false) => ({ id: 'glyph', char: 'O', x: 0, y: 0, width, height, commands: [...rect(0, 0, width, height), ...(hole ? rect(width / 3, height / 3, width / 3, height / 3) : [])] });
      const layer = (id, changes = {}) => ({ ...BASE_LAYER, id, name: id, kind: 'path', fontId: '', text: '', x: 140, y: 130, width: 120, height: 80, glyphs: [glyph(120, 80, true)], style: { ...flat }, ...changes });
      const project = (layers, changes = {}) => ({ version: 1, name: '图层操作真实验证', width: 440, height: 320, layers, background: { src: 'https://reference.invalid/not-exported.png', opacity: 1 }, ...changes });
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 18;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#65b9ad'; ctx.fillRect(0, 0, 24, 18); ctx.clearRect(7, 5, 8, 7); ctx.fillStyle = '#ffda72'; ctx.fillRect(0, 0, 6, 4);
      const sourceImage = canvas.toDataURL();
      const bottom = layer('bottom', { x: 190, y: 160, width: 260, height: 170, glyphs: [glyph(260, 170)], style: { ...flat, fill: '#f3e3b0', opacity: 0.45 } });
      const a = layer('a', { name: '../重复:*?\\名字', x: 162.35, y: 136.65, rotation: 17, scaleX: -0.85, scaleY: 1.12, style: { ...DEFAULT_STYLE, material: 'glass', materialStrength: 0.8, opacity: 0.68 } });
      const b = layer('b', { name: '../重复:*?\\名字', ...outline, kind: 'text', text: '字造', x: 233.2, y: 139.4, rotation: -11, style: { ...DEFAULT_STYLE, material: 'metal', materialStrength: 0.76, depth: 4, opacity: 0.83 } });
      const image = layer('image', { name: 'CON... ', kind: 'image', width: 72, height: 54, x: 258.25, y: 205.75, glyphs: [], imageSrc: sourceImage, rotation: -9, style: { ...flat, shadowBlur: 3, shadowX: -3, shadowY: 4, opacity: 0.54 } });
      const top = layer('top', { x: 320, y: 128, width: 32, height: 32, glyphs: [glyph(32, 32)], style: { ...flat, fill: '#ef8b4d' } });
      const hidden = layer('hidden', { name: '隐藏层', visible: false });
      const empty = layer('empty', { name: '', glyphs: [] });
      const locked = layer('locked', { name: '锁定仍可导出', x: 80, y: 240, width: 36, height: 24, glyphs: [glyph(36, 24)], locked: true, style: { ...flat, opacity: 0.5 } });
      const sample = project([bottom, a, b, image, top, hidden, empty, locked]);
      const dataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      async function pngFromSvg(source) {
        const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
        try {
          const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          // Chrome's same-canvas toDataURL/toBlob comparison changed 169 RGB pixels
          // (max premultiplied 0.6667, alpha 0). Match exportPng's toBlob encoder.
          return dataUrl(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
        } finally { URL.revokeObjectURL(url); }
      }
      async function isolatedGroupPng(original, ids) {
        const document = new DOMParser().parseFromString(engine.projectSvg(original, { scale: 1, crop: false, padding: 0 }), 'image/svg+xml');
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const definitions = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        definitions.innerHTML = `<filter id="verification-identity" filterUnits="userSpaceOnUse" x="0" y="0" width="${original.width}" height="${original.height}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>`;
        document.documentElement.prepend(definitions);
        group.setAttribute('filter', 'url(#verification-identity)');
        const nodes = Array.from(document.documentElement.children).filter(node => ids.includes(node.getAttribute('data-layer-id')));
        nodes.at(-1).after(group); nodes.forEach(node => group.append(node));
        return pngFromSvg(new XMLSerializer().serializeToString(document.documentElement));
      }
      const zips = [];
      for (const [id, options] of [['full', { scale: 1, crop: false, padding: 0 }], ['crop-fractional', { scale: 1.35, crop: true, padding: 7.25 }], ['crop-small', { scale: 0.31, crop: true, padding: 0 }], ['double', { scale: 2, crop: false, padding: 19 }]]) {
        const before = JSON.stringify(sample);
        const archive = await exportLayerPngs(sample, options);
        const root = new DOMParser().parseFromString(engine.projectSvg(sample, options), 'image/svg+xml').documentElement;
        const expected = [];
        for (const item of sample.layers.filter(layer => layer.visible)) {
          const single = new DOMParser().parseFromString(engine.projectSvg({ ...sample, layers: [item] }, { ...options, crop: false }), 'image/svg+xml').documentElement;
          for (const key of ['width', 'height', 'viewBox', 'preserveAspectRatio']) single.setAttribute(key, root.getAttribute(key));
          expected.push({ id: item.id, name: item.name, png: await pngFromSvg(new XMLSerializer().serializeToString(single)) });
        }
        zips.push({ id, archive: await dataUrl(archive), mime: archive.type, width: Number(root.getAttribute('width')), height: Number(root.getAttribute('height')), expected, unchanged: before === JSON.stringify(sample) });
      }
      const simple = project([layer('red', { x: 90, y: 90, width: 80, height: 60, glyphs: [glyph(80, 60)], style: { ...flat, fill: '#ff0000', opacity: 0.64 } }), layer('blue', { x: 130, y: 90, width: 80, height: 60, glyphs: [glyph(80, 60)], style: { ...flat, fill: '#0000ff', opacity: 0.5 } })], { width: 240, height: 180 });
      const outside = project([layer('oa', { x: -15.25, y: 170.5, rotation: 13 }), layer('ob', { x: 37.5, y: 198.4, style: { ...DEFAULT_STYLE, material: 'jelly' } })]);
      const cases = [['effects-adjacent', sample, ['a', 'b', 'image'], true], ['alpha', simple, ['red', 'blue'], true], ['outside-canvas', outside, ['oa', 'ob'], true], ['nonadjacent-order', sample, ['bottom', 'top'], false], ['with-empty', project([a, empty]), ['a', 'empty'], true]];
      const merges = [];
      for (const [id, original, ids, compare] of cases) {
        const snapshot = JSON.stringify(original);
        const before = await engine.exportPng(original, { scale: 1, crop: false, padding: 0 });
        const merged = await mergeLayers(original, ids);
        const after = await engine.exportPng(merged, { scale: 1, crop: false, padding: 0 });
        const image = merged.layers.find(item => !original.layers.some(old => old.id === item.id));
        const isolatedBefore = await engine.exportPng({ ...original, layers: original.layers.filter(item => ids.includes(item.id)) }, { scale: 1, crop: false, padding: 0 });
        const isolatedAfter = await engine.exportPng({ ...original, layers: [image] }, { scale: 1, crop: false, padding: 0 });
        const groupedReference = compare ? await isolatedGroupPng(original, ids) : null;
        merges.push({ id, compare, before: await dataUrl(before), after: await dataUrl(after), isolatedBefore: await dataUrl(isolatedBefore), isolatedAfter: await dataUrl(isolatedAfter), groupedReference, unchanged: snapshot === JSON.stringify(original), selected: ids, originalIds: original.layers.map(item => item.id), afterIds: merged.layers.map(item => item.id), image, retained: merged.layers.filter(item => item !== image).every(item => original.layers.find(old => old.id === item.id) === item), backgroundUnchanged: original.background === merged.background });
      }
      const invalid = [];
      for (const [id, callback] of [
        ['zip-hidden-only', () => exportLayerPngs(project([hidden]), { scale: 1, crop: false, padding: 0 })],
        ['zip-scale', () => exportLayerPngs(sample, { scale: 0, crop: false, padding: 0 })],
        ['zip-padding', () => exportLayerPngs(sample, { scale: 1, crop: true, padding: NaN })],
        ['zip-size', () => exportLayerPngs({ ...sample, width: 40000 }, { scale: 1, crop: false, padding: 0 })],
        ['zip-memory', () => exportLayerPngs({ ...sample, width: 12000, height: 12000 }, { scale: 1, crop: false, padding: 0 })],
        ['zip-count', () => exportLayerPngs(project(Array.from({ length: 513 }, (_, i) => ({ ...a, id: `many-${i}` }))), { scale: 1, crop: false, padding: 0 })],
        ['merge-single', () => mergeLayers(sample, ['a'])], ['merge-duplicate', () => mergeLayers(sample, ['a', 'a'])],
        ['merge-missing', () => mergeLayers(sample, ['a', 'missing'])], ['merge-hidden', () => mergeLayers(sample, ['a', 'hidden'])],
        ['merge-locked', () => mergeLayers(sample, ['a', 'locked'])],
        ['merge-empty', () => mergeLayers(project([empty, { ...empty, id: 'empty-2' }]), ['empty', 'empty-2'])],
        ['merge-size', () => mergeLayers(project([a, { ...b, x: 50000 }]), ['a', 'b'])],
      ]) {
        try { await callback(); invalid.push({ id, error: null }); }
        catch (error) { invalid.push({ id, error: error.message }); }
      }
      const styles = document.createElement('style'); styles.textContent = 'body{margin:0;padding:28px;background:#f3efe7;color:#283d35;font:15px system-ui}h1{margin:0 0 5px;font-size:28px}p{color:#63746a;margin:0 0 20px}.row{display:flex;gap:20px;margin-bottom:24px}figure{margin:0;padding:12px;background:white;border:1px solid #d9ddd4;border-radius:12px}figcaption{font-weight:600;margin-bottom:10px}img{display:block;background:repeating-conic-gradient(#e4e4e4 0% 25%,#fff 0% 50%) 50%/16px 16px;max-width:440px}'; document.head.append(styles);
      const heading = document.createElement('h1'); heading.textContent = '逐层 PNG / 合并图层 · 真实浏览器验收'; document.body.append(heading);
      const description = document.createElement('p'); description.textContent = '真实中文字形、透明图片、旋转、镜像、玻璃/金属材质、投影与多层半透明叠加'; document.body.append(description);
      for (const item of merges.filter(item => item.compare).slice(0, 2)) {
        const row = document.createElement('div'); row.className = 'row'; document.body.append(row);
        for (const [title, source] of [['合并前', item.before], ['合并后', item.after]]) { const figure = document.createElement('figure'); const caption = document.createElement('figcaption'); caption.textContent = `${item.id} · ${title}`; const image = document.createElement('img'); image.src = source; figure.append(caption, image); row.append(figure); }
      }
      const probes = [];
      if (diagnostics) {
        async function renderVariants(id, source, { draw = 5, software = false, float16 = false, dx = 0, dy = 0, width, height } = {}) {
          const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
          try {
            const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
            const target = document.createElement('canvas'); target.width = width || image.naturalWidth; target.height = height || image.naturalHeight;
            const context = target.getContext('2d', { alpha: true, willReadFrequently: software, colorType: float16 ? 'float16' : 'unorm8' });
            if (draw === 3) context.drawImage(image, dx, dy);
            else context.drawImage(image, dx, dy, image.naturalWidth, image.naturalHeight);
            const synchronous = target.toDataURL();
            const asynchronous = await dataUrl(await new Promise(resolve => target.toBlob(resolve, 'image/png')));
            probes.push({ id: `${id}/data`, png: synchronous }, { id: `${id}/blob`, png: asynchronous });
            return asynchronous;
          } finally { URL.revokeObjectURL(url); }
        }
        const source = engine.projectSvg(project([a]), { scale: 1, crop: false, padding: 0 });
        const serialized = new XMLSerializer().serializeToString(new DOMParser().parseFromString(source, 'image/svg+xml').documentElement);
        for (const [id, sourceValue, options] of [['raw3', source, { draw: 3 }], ['raw5', source, { draw: 5 }], ['serialized3', serialized, { draw: 3 }], ['software5', source, { software: true }]]) await renderVariants(id, sourceValue, options);
        for (const [id, p] of [['effects', project([a, b, image])], ['outside', outside]]) {
          const bounds = engine.contentBounds(p);
          const left = Math.floor(bounds.x), top = Math.floor(bounds.y), width = Math.ceil(bounds.x + bounds.width) - left, height = Math.ceil(bounds.y + bounds.height) - top;
          const original = engine.projectSvg(p, { scale: 1, crop: false, padding: 0 });
          await renderVariants(`${id}-original`, original);
          const moved = engine.projectSvg({ ...p, width, height, layers: p.layers.map(l => ({ ...l, x: l.x - left, y: l.y - top })) }, { scale: 1, crop: false, padding: 0 });
          const cropView = original.replace(/width="[^"]+" height="[^"]+" viewBox="[^"]+"/, `width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}"`);
          for (const [method, sourceValue, options] of [['moved', moved, {}], ['viewbox', cropView, {}], ['draw-crop', original, { dx: -left, dy: -top, width, height }], ['float16', original, { dx: -left, dy: -top, width, height, float16: true }], ['software', moved, { software: true }]]) {
            const raster = await renderVariants(`${id}-${method}`, sourceValue, options);
            const bitmap = layer(`probe-${method}`, { kind: 'image', width, height, x: left + width / 2, y: top + height / 2, glyphs: [], imageSrc: raster, style: { ...flat } });
            await renderVariants(`${id}-${method}-embedded`, engine.projectSvg({ ...p, layers: [bitmap] }, { scale: 1, crop: false, padding: 0 }));
            if (id === 'effects') await renderVariants(`backdrop-${method}`, engine.projectSvg({ ...sample, layers: [bottom, bitmap, sample.layers.find(item => item.id === 'top'), hidden, empty, locked] }, { scale: 1, crop: false, padding: 0 }));
          }
          if (id === 'effects') {
            const allSource = engine.projectSvg(sample, { scale: 1, crop: false, padding: 0 });
            await renderVariants('backdrop-original', allSource);
            await renderVariants('backdrop-only', engine.projectSvg(project([bottom]), { scale: 1, crop: false, padding: 0 }));
            for (const mode of ['isolate', 'opacity', 'filter']) {
              const document = new DOMParser().parseFromString(allSource, 'image/svg+xml');
              const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              if (mode === 'isolate') group.setAttribute('style', 'isolation:isolate');
              if (mode === 'opacity') group.setAttribute('opacity', '0.99999999');
              if (mode === 'filter') {
                group.setAttribute('filter', 'url(#probe-identity)');
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                defs.innerHTML = '<filter id="probe-identity" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>';
                document.documentElement.prepend(defs);
              }
              const nodes = ['a', 'b', 'image'].map(id => document.querySelector(`[data-layer-id="${id}"]`));
              nodes[0].before(group); nodes.forEach(node => group.append(node));
              await renderVariants(`backdrop-group-${mode}`, new XMLSerializer().serializeToString(document.documentElement));
            }
          }
        }
      }
      return { zips, merges, invalid, probes, userAgent: navigator.userAgent };
    }, { outline: text, diagnostics });
    assert.deepEqual(errors, [], 'browser exceptions');
    assert.deepEqual(externalRequests, [], 'reference image stays outside exports');
    const zips = [];
    for (const zip of data.zips) {
      const files = unzipSync(bytes(zip.archive));
      const names = Object.keys(files);
      const entries = [];
      for (let i = 0; i < names.length; i++) {
        const actual = await pixels(files[names[i]]);
        const expected = await pixels(bytes(zip.expected[i].png));
        entries.push({ name: names[i], sourceId: zip.expected[i].id, width: actual.info.width, height: actual.info.height, difference: difference(actual.data, expected.data), stats: alphaStats(actual) });
      }
      zips.push({ id: zip.id, mime: zip.mime, width: zip.width, height: zip.height, unchanged: zip.unchanged, expectedCount: zip.expected.length, entries });
      if (artifacts && zip.id === 'full') { await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'layers.zip'), bytes(zip.archive)); }
    }
    const merges = [];
    for (const merge of data.merges) {
      const before = await pixels(bytes(merge.before));
      const after = await pixels(bytes(merge.after));
      const bitmap = await pixels(bytes(merge.image.imageSrc));
      const isolatedBefore = await pixels(bytes(merge.isolatedBefore));
      const isolatedAfter = await pixels(bytes(merge.isolatedAfter));
      const reference = merge.groupedReference ? await pixels(bytes(merge.groupedReference)) : null;
      const { before: _before, after: _after, isolatedBefore: _isolatedBefore, isolatedAfter: _isolatedAfter, groupedReference: _groupedReference, image, ...properties } = merge;
      let outsideFilled = 0;
      const left = image.x - image.width / 2, top = image.y - image.height / 2;
      for (let y = 0; y < bitmap.info.height; y++) for (let x = 0; x < bitmap.info.width; x++) {
        if ((x + left < 0 || y + top < 0) && bitmap.data[(y * bitmap.info.width + x) * 4 + 3] > 0) outsideFilled++;
      }
      merges.push({ ...properties, image: { ...image, imageSrc: undefined }, bitmap: { width: bitmap.info.width, height: bitmap.info.height, outsideFilled, stats: alphaStats(bitmap) }, difference: difference(before.data, after.data), isolatedDifference: difference(isolatedBefore.data, isolatedAfter.data), referenceDifference: reference ? difference(reference.data, after.data) : null, quantization: reference ? { measured: difference(before.data, reference.data), envelopeViolations: quantizationEnvelope(before.data, after.data, reference.data), proof: roundingProof(merge.selected.length) } : null });
      if (artifacts && merge.id === 'effects-adjacent') {
        await mkdir(output, { recursive: true });
        for (const [filename, value] of [['before.png', merge.before], ['after.png', merge.after], ['merged-layer.png', image.imageSrc], ['grouped-reference.png', merge.groupedReference], ['isolated-before.png', merge.isolatedBefore], ['isolated-after.png', merge.isolatedAfter]]) await writeFile(path.join(output, filename), bytes(value));
      }
    }
    const probes = [];
    const decoded = new Map();
    for (const item of data.probes) decoded.set(item.id, await pixels(bytes(item.png)));
    const pairs = [
      ['raw3/data', 'raw3/blob'], ['raw3/blob', 'raw5/blob'], ['raw3/data', 'serialized3/data'], ['raw5/blob', 'software5/blob'],
      ...['effects', 'outside'].flatMap(id => ['moved', 'viewbox', 'draw-crop', 'float16', 'software'].map(method => [`${id}-original/blob`, `${id}-${method}-embedded/blob`])),
      ...['moved', 'viewbox', 'draw-crop', 'float16', 'software', 'group-isolate', 'group-opacity', 'group-filter'].map(method => ['backdrop-original/blob', `backdrop-${method}/blob`]),
      ...['isolate', 'opacity', 'filter'].map(method => ['backdrop-draw-crop/blob', `backdrop-group-${method}/blob`]),
    ];
    for (const [from, to] of pairs) if (decoded.has(from) && decoded.has(to)) probes.push({ from, to, ...difference(decoded.get(from).data, decoded.get(to).data) });
    const report = { zips, merges, invalid: data.invalid, probes, externalRequests, errors, userAgent: data.userAgent };
    if (artifacts) { await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await page.screenshot({ path: path.join(output, 'comparison.png'), fullPage: true }); }
    return report;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await vite.close();
  }
}
export function assertZipResults(report) {
  assert.equal(report.zips.length, 4);
  for (const zip of report.zips) {
    assert.equal(zip.mime, 'application/zip'); assert.equal(zip.unchanged, true);
    assert.equal(zip.entries.length, zip.expectedCount); assert.equal(zip.expectedCount, 7);
    assert.equal(new Set(zip.entries.map(item => item.name.toLowerCase())).size, zip.entries.length);
    for (const [i, entry] of zip.entries.entries()) {
      assert.match(entry.name, new RegExp(`^${String(i + 1).padStart(3, '0')}-[^<>:"/\\\\|?*\\x00-\\x1f]+\\.png$`));
      assert.equal(entry.width, zip.width); assert.equal(entry.height, zip.height);
      assert.equal(entry.difference.maxAlpha, 0, `${zip.id}/${entry.name}`);
      assert.equal(entry.difference.maxPremultiplied, 0, `${zip.id}/${entry.name}`);
      assert.ok(entry.stats.transparent > 100, `${zip.id}/${entry.name}`);
      if (entry.sourceId === 'empty') assert.equal(entry.stats.filled, 0);
      else assert.ok(entry.stats.filled > 10, `${zip.id}/${entry.name}`);
    }
    assert.ok(zip.entries.some(entry => entry.sourceId === 'locked'));
    assert.ok(!zip.entries.some(entry => entry.sourceId === 'hidden'));
  }
}
export function assertMergeResults(report) {
  assert.equal(report.merges.length, 5);
  for (const merge of report.merges) {
    assert.equal(merge.unchanged, true); assert.equal(merge.retained, true); assert.equal(merge.backgroundUnchanged, true);
    const highest = Math.max(...merge.selected.map(id => merge.originalIds.indexOf(id)));
    const expected = merge.originalIds.flatMap((id, index) => index === highest ? [merge.image.id] : merge.selected.includes(id) ? [] : [id]);
    assert.deepEqual(merge.afterIds, expected, merge.id);
    assert.equal(merge.image.kind, 'image'); assert.deepEqual(merge.image.glyphs, []);
    for (const property of ['rotation', 'style.depth', 'style.strokeWidth', 'style.outerWidth', 'style.shadowX', 'style.shadowY', 'style.shadowBlur', 'style.textureOpacity', 'style.materialStrength']) {
      assert.equal(property.split('.').reduce((value, key) => value[key], merge.image), 0, `${merge.id}/${property}`);
    }
    for (const property of ['scaleX', 'scaleY']) assert.equal(merge.image[property], 1);
    assert.equal(merge.image.style.opacity, 1); assert.equal(merge.image.style.material, 'none');
    assert.equal(merge.image.width, merge.bitmap.width); assert.equal(merge.image.height, merge.bitmap.height);
    assert.ok(merge.bitmap.stats.filled > 100); assert.ok(merge.bitmap.stats.transparent > 100);
    assert.deepEqual(merge.bitmap.stats.corners, [0, 0, 0, 0], merge.id);
    assert.deepEqual(merge.isolatedDifference, { maxAlpha: 0, maxPremultiplied: 0, changed: 0 }, `${merge.id} transparent selected artwork`);
    if (merge.id === 'outside-canvas') assert.ok(merge.bitmap.outsideFilled > 100, 'off-canvas artwork survives the original-viewport crop');
    if (merge.compare) {
      assert.deepEqual(merge.referenceDifference, { maxAlpha: 0, maxPremultiplied: 0, changed: 0 }, `${merge.id} independent SVG composite group`);
      assert.equal(merge.quantization.envelopeViolations, 0, `${merge.id} exceeds independently measured per-pixel rounding`);
      assert.ok(merge.difference.maxAlpha <= merge.quantization.proof.alphaBound, `${merge.id} alpha difference ${merge.difference.maxAlpha}`);
      assert.ok(merge.difference.maxPremultiplied <= merge.quantization.proof.premultipliedBound, `${merge.id} premultiplied difference ${merge.difference.maxPremultiplied}`);
    }
  }
}
export function assertInvalidResults(report) {
  assert.equal(report.invalid.length, 13);
  for (const item of report.invalid) assert.ok(item.error && item.error.length > 5, `${item.id} must reject before allocation`);
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await verifyLayerActions({ artifacts: true });
  assertZipResults(result); assertMergeResults(result); assertInvalidResults(result);
  console.log(JSON.stringify({ zipCases: result.zips.length, decodedPngs: result.zips.reduce((total, item) => total + item.entries.length, 0), mergeCases: result.merges.length, mergePixelChecks: result.merges.filter(item => item.compare).map(item => ({ id: item.id, originalStack: item.difference, transparent: item.isolatedDifference, groupedSvg: item.referenceDifference, quantizationBound: item.quantization.proof.premultipliedBound, envelopeViolations: item.quantization.envelopeViolations })), invalidCases: result.invalid.length, errors: result.errors, output }, null, 2));
}
