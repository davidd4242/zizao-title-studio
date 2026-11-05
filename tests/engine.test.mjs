import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  modules.set(name, module.exports);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: `${name}.ts` })(specifier => specifier.startsWith('.') ? load(posix.normalize(posix.join(posix.dirname(name), specifier))) : require(specifier), module, module.exports);
  return module.exports;
}
const engine = load('engine');
const { BASE_LAYER, DEFAULT_STYLE } = load('types');
const { STYLE_PRESETS, STICKERS, MATERIAL_PRESETS, GRADIENT_PRESETS, createSticker, applyPreset } = load('presets');
const flat = { ...DEFAULT_STYLE, fill: '#f04070', gradient: false, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false };
const rectangle = (x, y, width, height) => [{ type: 'M', x, y }, { type: 'L', x: x + width, y }, { type: 'L', x: x + width, y: y + height }, { type: 'L', x, y: y + height }, { type: 'Z' }];
function layer(changes = {}) {
  return { ...BASE_LAYER, id: 'test', name: 'Test', kind: 'path', text: '', fontId: '', x: 60, y: 60, width: 100, height: 100, style: { ...flat }, glyphs: [{ id: 'glyph', char: 'O', x: 0, y: 0, width: 100, height: 100, commands: [...rectangle(0, 0, 100, 100), ...rectangle(25, 25, 50, 50)] }], ...changes };
}
function project(layers, changes = {}) {
  return { version: 1, name: 'Title & <test>', width: 240, height: 240, layers, ...changes };
}
async function raster(svg) {
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function pixel(image, x, y) {
  const offset = (Math.round(y) * image.info.width + Math.round(x)) * image.info.channels;
  return [...image.data.subarray(offset, offset + 4)];
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`);

test('all path commands serialize, without leaking nonfinite numbers', () => {
  assert.equal(engine.commandPath([{ type: 'M', x: 1, y: 2 }, { type: 'L', x: 3, y: 4 }, { type: 'Q', x1: 5, y1: 6, x: 7, y: 8 }, { type: 'C', x1: 9, y1: 10, x2: 11, y2: 12, x: 13, y: 14 }, { type: 'Z' }]), 'M1 2 L3 4 Q5 6 7 8 C9 10 11 12 13 14 Z');
  assert.equal(engine.commandPath([{ type: 'M', x: NaN, y: Infinity }]), 'M0 0');
});

test('layer transform follows DESIGN and inverses rotation, reflections and unequal scales', () => {
  const l = layer({ x: 320, y: 210, width: 100, height: 70, rotation: 37, scaleX: -1.4, scaleY: 0.65 });
  assert.equal(engine.layerTransform(l), 'translate(320 210) rotate(37) scale(-1.4 0.65) translate(-50 -35)');
  for (const p of [{ x: 0, y: 0 }, { x: 50, y: 35 }, { x: 137, y: -19 }]) {
    const radians = l.rotation * Math.PI / 180;
    const x = (p.x - l.width / 2) * l.scaleX;
    const y = (p.y - l.height / 2) * l.scaleY;
    const actual = engine.screenToLayer(l, l.x + x * Math.cos(radians) - y * Math.sin(radians), l.y + x * Math.sin(radians) + y * Math.cos(radians));
    near(actual.x, p.x); near(actual.y, p.y);
  }
  assert.throws(() => engine.screenToLayer({ ...l, scaleX: 0 }, 0, 0), RangeError);
});

test('compound glyph holes remain transparent; separate overlapping glyphs remain filled', async () => {
  const l = layer();
  const image = await raster(engine.projectSvg(project([l])));
  assert.equal(pixel(image, 60, 60)[3], 0);
  assert.equal(pixel(image, 20, 20)[3], 255);
  const solid = { id: 'second', char: '', x: 30, y: 30, width: 20, height: 20, commands: rectangle(0, 0, 20, 20) };
  const overlap = await raster(engine.projectSvg(project([{ ...l, glyphs: [...l.glyphs, solid] }])));
  assert.equal(pixel(overlap, 45, 45)[3], 255);
});

test('translated and rotated glyphs share layer-space gradients, gloss and texture', async () => {
  const glyph = { id: 'top', char: '', x: 0, y: 0, width: 40, height: 40, commands: rectangle(0, 0, 40, 40) };
  const l = layer({ x: 20, y: 50, width: 40, height: 100, glyphs: [glyph, { ...glyph, id: 'bottom', y: 60, rotation: 90 }], style: { ...flat, gradient: true, gradientAngle: 90, fill: '#ff0000', fill2: '#0000ff' } });
  const image = await raster(engine.projectSvg(project([l], { width: 40, height: 100 })));
  assert.ok(pixel(image, 20, 20)[0] > 180 && pixel(image, 20, 20)[2] < 80);
  assert.ok(pixel(image, 20, 80)[0] < 80 && pixel(image, 20, 80)[2] > 180);
  assert.ok(Math.abs(pixel(image, 10, 70)[0] - pixel(image, 30, 70)[0]) <= 2);
  const glossy = await raster(engine.projectSvg(project([{ ...l, style: { ...flat, fill: '#000000', gloss: true } }], { width: 40, height: 100 })));
  assert.ok(pixel(glossy, 20, 20)[0] > 50); assert.equal(pixel(glossy, 20, 80)[0], 0);
  const textured = await raster(engine.projectSvg(project([{ ...l, glyphs: [glyph, { ...glyph, id: 'bottom', y: 60 }], style: { ...flat, fill: '#000000', texture: 'dots', textureColor: '#ffffff', textureOpacity: 1 } }], { width: 40, height: 100 })));
  assert.ok(pixel(textured, 4, 4)[0] > 240); assert.equal(pixel(textured, 4, 64)[0], 0); assert.ok(pixel(textured, 4, 68)[0] > 240);
});

test('standalone SVG namespaces and layer definitions are complete, unique and escaped', () => {
  const a = layer({ id: 'a:b', style: { ...DEFAULT_STYLE } });
  const b = layer({ id: 'a_3a_b', x: 170, style: { ...DEFAULT_STYLE, texture: 'stripes' } });
  const svg = engine.projectSvg(project([a, b, layer({ id: 'hidden', visible: false })], { background: { src: 'REFERENCE_BACKGROUND', opacity: 1 } }));
  assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /width="240" height="240" viewBox="0 0 240 240"/);
  assert.match(svg, /Title &amp; &lt;test&gt;/);
  assert.doesNotMatch(svg, /REFERENCE_BACKGROUND|checker|hidden|<text|@font-face/);
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of svg.matchAll(/(?:url\(#|href="#)([^)" ]+)/g)) assert.ok(ids.includes(match[1]), `Missing definition ${match[1]}`);
  assert.match(svg, /linearGradient/); assert.match(svg, /feDropShadow/); assert.match(svg, /patternTransform/);
  assert.match(svg, /stroke-width="27"/);
});

test('curve extrema and empty geometry give stable conservative bounds', () => {
  const quadratic = layer({ x: 100, y: 50, width: 200, height: 100, glyphs: [{ id: 'q', char: '', x: 0, y: 0, width: 200, height: 100, commands: [{ type: 'M', x: 0, y: 0 }, { type: 'Q', x1: 100, y1: 200, x: 200, y: 0 }, { type: 'Z' }] }] });
  assert.deepEqual(engine.contentBounds(project([quadratic])), { x: -2, y: -2, width: 204, height: 104 });
  const cubic = { ...quadratic, glyphs: [{ ...quadratic.glyphs[0], commands: [{ type: 'M', x: 0, y: 0 }, { type: 'C', x1: 0, y1: 200, x2: 200, y2: 200, x: 200, y: 0 }, { type: 'Z' }] }] };
  assert.deepEqual(engine.contentBounds(project([cubic])), { x: -2, y: -2, width: 204, height: 154 });
  assert.deepEqual(engine.contentBounds(project([layer({ visible: false }), layer({ style: { ...flat, opacity: 0 } }), layer({ glyphs: [] })])), { x: 0, y: 0, width: 0, height: 0 });
  assert.match(engine.projectSvg(project([]), { crop: true }), /viewBox="0 0 240 240"/);
});

test('glyph and layer rotation, negative scale, strokes, depth and blur stay inside content bounds', async () => {
  const l = layer({ x: 300, y: 300, scaleX: -1.2, scaleY: 0.8, rotation: 37, style: { ...DEFAULT_STYLE, shadowX: -14, shadowY: 18, shadowBlur: 7, depth: 18 } });
  l.glyphs[0].rotation = -24;
  const p = project([l], { width: 600, height: 600 });
  const bounds = engine.contentBounds(p);
  const image = await raster(engine.projectSvg(p));
  let filled = 0;
  for (let y = 0; y < image.info.height; y += 1) for (let x = 0; x < image.info.width; x += 1) {
    if (pixel(image, x, y)[3] > 1) {
      filled += 1;
      assert.ok(x >= bounds.x - 1 && x <= bounds.x + bounds.width + 1 && y >= bounds.y - 1 && y <= bounds.y + bounds.height + 1, `Pixel outside bounds: ${x},${y}`);
    }
  }
  assert.ok(filled > 5000);
  const cropped = engine.projectSvg(p, { scale: 2, crop: true, padding: 11 });
  assert.match(cropped, new RegExp(`width="${Math.ceil((bounds.width + 22) * 2)}" height="${Math.ceil((bounds.height + 22) * 2)}"`));
  const cropImage = await raster(cropped);
  for (const [x, y] of [[0, 0], [cropImage.info.width - 1, 0], [0, cropImage.info.height - 1], [cropImage.info.width - 1, cropImage.info.height - 1]]) assert.equal(pixel(cropImage, x, y)[3], 0);
});

test('image layers embed base64 and reject external references', async () => {
  const png = await sharp({ create: { width: 6, height: 6, channels: 4, background: '#25a87d' } }).png().toBuffer();
  const l = layer({ kind: 'image', imageSrc: `data:image/png;base64,${png.toString('base64')}`, width: 60, height: 60, glyphs: [] });
  const svg = engine.layerSvg(l);
  assert.match(svg, /<image.*href="data:image\/png;base64,/);
  const image = await raster(engine.projectSvg(project([l])));
  assert.deepEqual(pixel(image, 60, 60), [37, 168, 125, 255]);
  assert.equal(pixel(image, 1, 1)[3], 0);
  assert.throws(() => engine.layerSvg({ ...l, imageSrc: 'https://example.test/picture.png' }), /embedded base64/);
});

test('cloning, applying presets and creating stickers do not share editable state', () => {
  const original = layer();
  const copy = engine.cloneLayer(original);
  assert.notEqual(copy.id, original.id); assert.notEqual(copy.glyphs[0].id, original.glyphs[0].id);
  assert.equal(copy.x, original.x + 24); assert.equal(copy.y, original.y + 24);
  copy.glyphs[0].commands[0].x = 444; copy.style.fill = '#000';
  assert.equal(original.glyphs[0].commands[0].x, 0); assert.equal(original.style.fill, '#f04070');
  const styled = applyPreset(original, 'black-gold');
  styled.style.fill = '#123';
  assert.notEqual(STYLE_PRESETS.find(p => p.id === 'black-gold').style.fill, '#123');
  const a = createSticker('star', 30, 40), b = createSticker('star', 30, 40);
  a.glyphs[0].commands[0].x = 555; a.style.fill = '#456';
  assert.notEqual(b.glyphs[0].commands[0].x, 555); assert.notEqual(b.style.fill, '#456');
  assert.equal(a.x, 30); assert.equal(a.y, 40); assert.equal(a.kind, 'sticker');
  assert.throws(() => createSticker('missing', 0, 0), RangeError);
  assert.throws(() => applyPreset(original, 'missing'), RangeError);
  assert.equal(new Set(Array.from({ length: 500 }, () => engine.newId())).size, 500);
});

test('cloned letterforms keep source and rendered glyph identities isolated through restore and reapply', () => {
  const { LETTERFORM_PRESETS, applyLetterform, clearLetterform } = load('letterforms');
  const geometry = glyphs => glyphs.map(({ id, ...value }) => value);
  for (const preset of LETTERFORM_PRESETS) {
    const original = applyLetterform(layer(), preset.id, 0.7);
    const originalSnapshot = structuredClone(original);
    const copy = engine.cloneLayer(original);
    const oldIds = new Set([...original.glyphs, ...original.letterform.sourceGlyphs].map(glyph => glyph.id));
    const sourceId = copy.letterform.sourceGlyphs[0].id;
    assert.equal(copy.glyphs[0].id, sourceId, `${preset.id}: body/source correspondence`);
    const restored = clearLetterform(copy);
    const reapplied = applyLetterform(copy, preset.id, 0.7);
    const reappliedFromRestored = applyLetterform(restored, preset.id, 0.7);
    for (const variant of [copy, restored, reapplied, reappliedFromRestored]) {
      assert.equal(new Set(variant.glyphs.map(glyph => glyph.id)).size, variant.glyphs.length);
      for (const glyph of [...variant.glyphs, ...(variant.letterform?.sourceGlyphs || [])]) assert.ok(!oldIds.has(glyph.id), `${preset.id}: stale glyph ID ${glyph.id}`);
    }
    assert.equal(restored.glyphs[0].id, sourceId);
    assert.deepEqual(reapplied.glyphs, reappliedFromRestored.glyphs);
    assert.deepEqual(geometry(copy.glyphs), geometry(original.glyphs));
    assert.deepEqual(geometry(restored.glyphs), geometry(original.letterform.sourceGlyphs));
    copy.letterform.sourceGlyphs[0].commands[0].x += 100;
    copy.glyphs[0].commands[0].x += 100;
    assert.deepEqual(original, originalSnapshot);
  }
});

test('all authored stickers and visibly distinct style presets render real pixels', async () => {
  assert.ok(STYLE_PRESETS.length >= 8); assert.ok(STICKERS.length >= 12);
  assert.equal(new Set(STICKERS.map(s => s.id)).size, STICKERS.length);
  for (const sticker of STICKERS) {
    assert.match(sticker.id, /^[a-z][a-z0-9-]*$/);
    const image = await raster(engine.projectSvg(project([createSticker(sticker.id, 150, 150)], { width: 300, height: 300 }), { crop: true, padding: 5 }));
    let pixels = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 128) pixels += 1;
    assert.ok(pixels > 100, sticker.id);
  }
  const images = new Set();
  for (const preset of STYLE_PRESETS) images.add((await sharp(Buffer.from(engine.projectSvg(project([applyPreset(layer(), preset.id)])))).png().toBuffer()).toString('base64'));
  assert.ok(images.size >= 8);
});

test('multiple gradient stops render positioned colors, radial falloff and legacy fallback', async () => {
  const stops = [{ offset: 1, color: '#0000ff' }, { offset: 0, color: '#ff0000' }, { offset: 0.5, color: '#00ff00' }];
  const l = layer({ x: 50, y: 50, style: { ...flat, gradient: true, gradientAngle: 0, gradientStops: stops }, glyphs: [{ id: 'solid', char: '', x: 0, y: 0, width: 100, height: 100, commands: rectangle(0, 0, 100, 100) }] });
  const linear = await raster(engine.projectSvg(project([l], { width: 100, height: 100 })));
  assert.ok(pixel(linear, 1, 50)[0] > 240); assert.ok(pixel(linear, 50, 50)[1] > 240); assert.ok(pixel(linear, 98, 50)[2] > 240);
  assert.equal(stops[0].offset, 1);
  const radialSvg = engine.projectSvg(project([{ ...l, style: { ...l.style, gradientType: 'radial' } }], { width: 100, height: 100 }));
  assert.match(radialSvg, /<radialGradient/);
  const radial = await raster(radialSvg);
  assert.ok(pixel(radial, 50, 50)[0] > 230); assert.ok(pixel(radial, 75, 50)[1] > 230); assert.ok(pixel(radial, 98, 50)[2] > 230);
  const legacy = { ...l, style: { ...flat, gradient: true } };
  assert.equal(engine.projectSvg(project([legacy])), engine.projectSvg(project([{ ...legacy, style: { ...legacy.style, gradientType: 'linear', gradientStops: [{ offset: 0, color: flat.fill }, { offset: 1, color: flat.fill2 }] } }])));
  const cloned = engine.cloneLayer(l); cloned.style.gradientStops[0].color = '#123456'; assert.equal(stops[0].color, '#0000ff');
  assert.ok(GRADIENT_PRESETS.length >= 6);
  for (const preset of GRADIENT_PRESETS) {
    assert.ok(preset.stops.length >= 2 && preset.stops.length <= 6);
    assert.ok(preset.stops.every(stop => stop.offset >= 0 && stop.offset <= 1));
    const p = project([{ ...l, style: { ...l.style, gradientStops: preset.stops, gradientType: preset.type, gradientAngle: preset.angle } }]);
    assert.equal(engine.projectSvg(p), engine.projectSvg(JSON.parse(JSON.stringify(p))));
  }
});

test('five deterministic materials change real pixels and preserve clipped alpha at every strength', async () => {
  const p = project([layer({ style: { ...flat, fill: '#6396ae', fill2: '#a270d6' } })]);
  const baselineSvg = engine.projectSvg(p);
  const baseline = await raster(baselineSvg);
  const signatures = new Set();
  const differences = [];
  assert.deepEqual(MATERIAL_PRESETS.map(item => item.id), ['none', 'metal', 'glass', 'jelly', 'paper', 'neon']);
  for (const { id: material } of MATERIAL_PRESETS.slice(1)) {
    const make = materialStrength => ({ ...p, layers: [{ ...p.layers[0], style: { ...p.layers[0].style, material, materialStrength } }] });
    assert.equal(engine.projectSvg(make(0)), baselineSvg, `${material} zero strength`);
    const svg = engine.projectSvg(make(1));
    assert.equal(svg, engine.projectSvg(make(1)), `${material} deterministic`);
    const full = await raster(svg), half = await raster(engine.projectSvg(make(0.5)));
    let changed = 0, fullDifference = 0, halfDifference = 0;
    for (let index = 0; index < full.data.length; index += 4) {
      assert.equal(full.data[index + 3], baseline.data[index + 3], `${material} alpha ${index}`);
      assert.equal(half.data[index + 3], baseline.data[index + 3], `${material} half alpha ${index}`);
      const delta = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(full.data[index + channel] - baseline.data[index + channel]), 0);
      if (delta > 5) changed += 1;
      fullDifference += delta;
      halfDifference += [0, 1, 2].reduce((sum, channel) => sum + Math.abs(half.data[index + channel] - baseline.data[index + channel]), 0);
    }
    assert.ok(changed > 3000, `${material} changed ${changed} pixels`);
    assert.ok(halfDifference > fullDifference * 0.3 && halfDifference < fullDifference * 0.7, `${material} intensity response`);
    assert.equal(pixel(full, 60, 60)[3], 0); assert.equal(pixel(full, 0, 0)[3], 0);
    assert.deepEqual(engine.contentBounds(make(1)), engine.contentBounds(p));
    signatures.add(full.data.toString('base64'));
    differences.push(`${material}:${changed}`);
  }
  assert.equal(signatures.size, 5);
  console.log(`Material changed pixels / 7500 filled: ${differences.join(', ')}`);
});

test('materials preserve antialiased alpha on rotated, fractional and curved glyph edges', async () => {
  const curve = [{ type: 'M', x: 50, y: 0 }, { type: 'C', x1: 77.6142, y1: 0, x2: 100, y2: 22.3858, x: 100, y: 50 }, { type: 'C', x1: 100, y1: 77.6142, x2: 77.6142, y2: 100, x: 50, y: 100 }, { type: 'C', x1: 22.3858, y1: 100, x2: 0, y2: 77.6142, x: 0, y: 50 }, { type: 'C', x1: 0, y1: 22.3858, x2: 22.3858, y2: 0, x: 50, y: 0 }, { type: 'Z' }, ...rectangle(30, 30, 40, 40)];
  for (const curved of [false, true]) for (const scale of [1, 0.05]) for (const outputScale of [1, 0.25]) {
    const l = layer({ x: 120.35, y: 116.65, rotation: curved ? -22 : 13, scaleX: 0.97 * scale, scaleY: 1.12 * scale });
    if (curved) l.glyphs[0].commands = curve;
    const reference = await raster(engine.projectSvg(project([l]), { scale: outputScale }));
    assert.ok(reference.data.some((value, index) => index % 4 === 3 && value > 0 && value < 255));
    for (const { id: material } of MATERIAL_PRESETS.slice(1)) for (const materialStrength of [0.45, 1]) {
      const frame = await raster(engine.projectSvg(project([{ ...l, style: { ...l.style, material, materialStrength } }]), { scale: outputScale }));
      for (let index = 3; index < frame.data.length; index += 4) assert.equal(frame.data[index], reference.data[index], `${material}/${materialStrength}/${curved}/${scale}/${outputScale} edge alpha ${index}`);
    }
  }
});

test('real browser SVG decoding, PNG alpha, crop dimensions, matrix and download', async () => {
  const source = ts.transpileModule(readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const executablePath = process.env.BROWSER_PATH || [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => existsSync(path));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    const p = project([layer()], { background: { src: 'never-export-reference', opacity: 1 } });
    const result = await page.evaluate(async ({ source, project }) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const engine = await import(url);
      URL.revokeObjectURL(url);
      window.engine = engine;
      const documentSvg = new DOMParser().parseFromString(engine.projectSvg(project), 'image/svg+xml');
      const error = documentSvg.querySelector('parsererror')?.textContent;
      const full = await engine.exportPng(project, { scale: 2, crop: false, padding: 0 });
      const crop = await engine.exportPng(project, { scale: 2, crop: true, padding: 7 });
      const bitmap = await createImageBitmap(full);
      const cropped = await createImageBitmap(crop);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      const alpha = (x, y) => context.getImageData(x, y, 1, 1).data[3];
      const width = bitmap.width, height = bitmap.height, croppedWidth = cropped.width, croppedHeight = cropped.height;
      const alphas = [alpha(0, 0), alpha(120, 120), alpha(40, 40)];
      bitmap.close(); cropped.close();
      const layer = { ...project.layers[0], x: 117, y: 81, rotation: 33, scaleX: -1.2, scaleY: 1.7 };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const group = document.createElementNS(svg.namespaceURI, 'g'); group.setAttribute('transform', engine.layerTransform(layer)); svg.append(group); document.body.append(svg);
      const matrix = group.getCTM(); const world = new DOMPoint(23, 57).matrixTransform(matrix);
      const point = engine.screenToLayer(layer, world.x, world.y); svg.remove();
      const materialResults = [];
      let referencePixels;
      for (const material of ['none', 'metal', 'glass', 'jelly', 'paper', 'neon']) {
        const styledProject = { ...project, layers: [{ ...project.layers[0], style: { ...project.layers[0].style, gradient: true, gradientType: 'radial', gradientStops: [{ offset: 0, color: '#fff3d1' }, { offset: 0.35, color: '#f6a2c9' }, { offset: 0.7, color: '#9e90e6' }, { offset: 1, color: '#588bb8' }], material, materialStrength: 0.85 } }] };
        const png = await engine.exportPng(styledProject, { scale: 1, crop: true, padding: 7 });
        const frame = await createImageBitmap(png);
        canvas.width = frame.width; canvas.height = frame.height; context.drawImage(frame, 0, 0);
        const pixels = context.getImageData(0, 0, frame.width, frame.height).data;
        if (!referencePixels) referencePixels = new Uint8ClampedArray(pixels);
        let alphaDifference = 0, colorDifference = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          alphaDifference += Math.abs(pixels[i + 3] - referencePixels[i + 3]);
          if (Math.abs(pixels[i] - referencePixels[i]) + Math.abs(pixels[i + 1] - referencePixels[i + 1]) + Math.abs(pixels[i + 2] - referencePixels[i + 2]) > 5) colorDifference += 1;
        }
        materialResults.push({ material, alphaDifference, colorDifference, width: frame.width, height: frame.height, holeAlpha: alpha(59, 59), cornerAlpha: alpha(0, 0) });
        frame.close();
      }
      const edgeAlphaResults = [];
      for (const scale of [1, 0.05]) for (const outputScale of [1, 0.25]) {
        let edgeReference;
        for (const material of ['none', 'metal', 'glass', 'jelly', 'paper', 'neon']) for (const materialStrength of material === 'none' ? [1] : [0.45, 1]) {
          const rotated = { ...project, layers: [{ ...project.layers[0], x: 120.35, y: 116.65, rotation: 13, scaleX: 0.97 * scale, scaleY: 1.12 * scale, style: { ...project.layers[0].style, opacity: 0.64, material, materialStrength } }] };
          const png = await engine.exportPng(rotated, { scale: outputScale, crop: false, padding: 0 });
          const frame = await createImageBitmap(png);
          canvas.width = frame.width; canvas.height = frame.height; context.drawImage(frame, 0, 0);
          const pixels = context.getImageData(0, 0, frame.width, frame.height).data;
          if (!edgeReference) edgeReference = new Uint8ClampedArray(pixels);
          let difference = 0;
          for (let i = 3; i < pixels.length; i += 4) difference += Math.abs(pixels[i] - edgeReference[i]);
          edgeAlphaResults.push({ material, materialStrength, scale, outputScale, difference });
          frame.close();
        }
      }
      return { type: full.type, error, width, height, croppedWidth, croppedHeight, alphas, point, materialResults, edgeAlphaResults };
    }, { source, project: p });
    assert.equal(result.error, undefined); assert.equal(result.type, 'image/png');
    assert.equal(result.width, 480); assert.equal(result.height, 480);
    assert.equal(result.croppedWidth, 236); assert.equal(result.croppedHeight, 236);
    assert.deepEqual(result.alphas, [0, 0, 255]); near(result.point.x, 23); near(result.point.y, 57);
    for (const item of result.materialResults) {
      assert.equal(item.alphaDifference, 0, `${item.material} PNG alpha`);
      assert.equal(item.holeAlpha, 0); assert.equal(item.cornerAlpha, 0);
      assert.equal(item.width, 118); assert.equal(item.height, 118);
      if (item.material !== 'none') assert.ok(item.colorDifference > 3000, `${item.material} PNG changed ${item.colorDifference}`);
    }
    for (const item of result.edgeAlphaResults) assert.equal(item.difference, 0, `${item.material}/${item.materialStrength} rotated PNG alpha`);
    console.log(`Browser material PNG changed pixels: ${result.materialResults.map(item => `${item.material}:${item.colorDifference}`).join(', ')}; rotated alpha difference: ${result.edgeAlphaResults.map(item => item.difference).join(',')}`);
    const download = page.waitForEvent('download');
    await page.evaluate(() => window.engine.downloadBlob(new Blob(['vector-download'], { type: 'text/plain' }), 'engine-export.txt'));
    assert.equal((await download).suggestedFilename(), 'engine-export.txt');
  } finally {
    await browser.close();
  }
});
