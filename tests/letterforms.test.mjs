import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { outlineFont } from '../server/outline.mjs';

const require = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  modules.set(name, module.exports);
  new Function('require', 'module', 'exports', code)(specifier => specifier.startsWith('./') ? load(specifier.slice(2)) : require(specifier), module, module.exports);
  return module.exports;
}
const { LETTERFORM_PRESETS, applyLetterform, clearLetterform } = load('letterforms');
const { BASE_LAYER, DEFAULT_STYLE } = load('types');
const { projectSvg, contentBounds } = load('engine');
const flat = { ...DEFAULT_STYLE, fill: '#192d41', gradient: false, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false };
const rectangle = (x, y, width, height) => [{ type: 'M', x, y }, { type: 'L', x: x + width, y }, { type: 'L', x: x + width, y: y + height }, { type: 'L', x, y: y + height }, { type: 'Z' }];
const source = () => ({ ...BASE_LAYER, id: 'letterform-test', name: 'Original', fontId: 'fixture', text: 'O', kind: 'text', x: 200, y: 150, width: 100, height: 100, glyphs: [{ id: 'g0', char: 'O', x: 0, y: 0, width: 100, height: 100, commands: [...rectangle(0, 0, 100, 100), ...rectangle(25, 25, 50, 50)] }], style: structuredClone(flat) });
const geometry = layer => ({ width: layer.width, height: layer.height, glyphs: layer.glyphs });
const project = layer => ({ version: 1, name: 'Letterform test', width: 1000, height: 600, layers: [layer] });
const pathSignature = layer => JSON.stringify({ width: layer.width, height: layer.height, glyphs: layer.glyphs.map(({ x, y, width, height, rotation, commands }) => ({ x, y, width, height, rotation, commands })) });
async function raster(layer, crop = true, scale = 1) {
  return sharp(Buffer.from(projectSvg(project(layer), { crop, scale, padding: 12 }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function finiteGeometry(layer) {
  for (const value of [layer.x, layer.y, layer.width, layer.height]) assert.ok(Number.isFinite(value));
  for (const glyph of layer.glyphs) {
    for (const value of [glyph.x, glyph.y, glyph.width, glyph.height]) assert.ok(Number.isFinite(value));
    assert.ok(glyph.x >= -1e-8 && glyph.y >= -1e-8);
    assert.ok(glyph.x + glyph.width <= layer.width + 1e-8 && glyph.y + glyph.height <= layer.height + 1e-8);
    for (const command of glyph.commands) for (const [key, value] of Object.entries(command)) if (key !== 'type') assert.ok(Number.isFinite(value));
  }
}
function alphaAt(image, x, y) {
  return image.data[(Math.round(y) * image.info.width + Math.round(x)) * 4 + 3];
}
function enclosedHoles(image, minPixels = 12, onHole = () => {}) {
  const { width, height } = image.info;
  const visited = new Uint8Array(width * height);
  let count = 0;
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || image.data[start * 4 + 3] > 64) continue;
    let edge = false, size = 0;
    const queue = [start]; visited[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const position = queue[head], x = position % width, y = Math.floor(position / width); size++;
      if (!x || !y || x === width - 1 || y === height - 1) edge = true;
      for (const adjacent of [x ? position - 1 : -1, x + 1 < width ? position + 1 : -1, y ? position - width : -1, y + 1 < height ? position + width : -1]) {
        if (adjacent < 0 || visited[adjacent] || image.data[adjacent * 4 + 3] > 64) continue;
        visited[adjacent] = 1; queue.push(adjacent);
      }
    }
    if (!edge && size >= minPixels) { count++; onHole(queue); }
  }
  return count;
}
const windowsFonts = `${process.env.WINDIR || 'C:/Windows'}/Fonts`;
const latin = fontkit.openSync(`${windowsFonts}/arial.ttf`);
const chinese = fontkit.openSync(`${windowsFonts}/msyh.ttc`).fonts[0];
function realLayer(font, text, changes = {}) {
  const request = { fontId: font.postscriptName, text, fontSize: 160, letterSpacing: 8, lineHeight: 1.45, align: 'left', layout: 'horizontal' };
  const outlined = outlineFont(font, { ...request, ...changes });
  assert.deepEqual(outlined.missing, []);
  return { ...source(), ...request, ...outlined, ...changes };
}

test('five flourish and five gothic presets have stable IDs and real distinct geometry', () => {
  assert.equal(LETTERFORM_PRESETS.filter(preset => preset.category === 'flourish').length, 5);
  assert.equal(LETTERFORM_PRESETS.filter(preset => preset.category === 'gothic').length, 5);
  assert.equal(new Set(LETTERFORM_PRESETS.map(preset => preset.id)).size, 10);
  const paths = new Set();
  for (const preset of LETTERFORM_PRESETS) {
    const input = source(), copy = structuredClone(input);
    const transformed = applyLetterform(input, preset.id, 1);
    assert.deepEqual(input, copy);
    assert.equal(transformed.kind, 'path'); assert.deepEqual(transformed.style, input.style);
    assert.equal(transformed.fontId, input.fontId); assert.equal(transformed.text, input.text);
    assert.notDeepEqual(transformed.glyphs.find(glyph => glyph.id === 'g0').commands, input.glyphs[0].commands);
    assert.ok(transformed.glyphs.length > input.glyphs.length);
    assert.deepEqual(transformed, applyLetterform(input, preset.id, 1));
    finiteGeometry(transformed); paths.add(pathSignature(transformed));
  }
  assert.equal(paths.size, 10);
});

test('zero strength exactly preserves source geometry and clamps finite out-of-range values', () => {
  for (const preset of LETTERFORM_PRESETS) {
    const input = realLayer(latin, 'AbgO'), zero = applyLetterform(input, preset.id, 0);
    assert.deepEqual(geometry(zero), geometry(input));
    assert.equal(projectSvg(project(zero)), projectSvg(project(input)));
    assert.deepEqual(geometry(applyLetterform(input, preset.id, -1)), geometry(zero));
    assert.deepEqual(geometry(applyLetterform(input, preset.id, 2)), geometry(applyLetterform(input, preset.id, 1)));
    assert.throws(() => applyLetterform(input, preset.id, NaN), RangeError);
    assert.throws(() => applyLetterform(input, preset.id, Infinity), RangeError);
  }
});

test('switching and repeated application always use original source; clear restores exact kind and contours', () => {
  for (const kind of ['text', 'path']) for (const preset of LETTERFORM_PRESETS) {
    const input = realLayer(chinese, '花体回田', { kind });
    const applied = applyLetterform(input, preset.id, 0.8);
    const edited = structuredClone(applied); edited.glyphs[0].commands[0].x += 17;
    const alternate = applyLetterform(edited, 'gothic-diamond', 0.45);
    assert.deepEqual(geometry(alternate), geometry(applyLetterform(input, 'gothic-diamond', 0.45)));
    assert.deepEqual(geometry(applyLetterform(applied, preset.id, 0.8)), geometry(applied));
    assert.deepEqual(clearLetterform(alternate), input);
    assert.deepEqual(geometry(applyLetterform(alternate, preset.id, 0)), geometry(input));
  }
});

test('input and metadata are deeply independent and non-path layers stay unchanged', () => {
  const original = source(), result = applyLetterform(original, 'flourish-royal', 1);
  result.glyphs[0].commands[0].x += 100;
  result.letterform.sourceGlyphs[0].commands[0].x += 50;
  result.style.fill = '#ff0000';
  assert.equal(original.glyphs[0].commands[0].x, 0); assert.equal(original.style.fill, flat.fill);
  const pristine = applyLetterform(original, 'gothic-spire'), restored = clearLetterform(pristine);
  restored.glyphs[0].commands[0].x += 30;
  assert.equal(pristine.letterform.sourceGlyphs[0].commands[0].x, 0);
  for (const kind of ['sticker', 'image']) {
    const input = { ...source(), kind };
    assert.deepEqual(applyLetterform(input, 'flourish-vine'), input);
    assert.notEqual(applyLetterform(input, 'flourish-vine'), input);
  }
  assert.throws(() => applyLetterform(source(), 'unknown'), RangeError);
  const bad = source(); bad.glyphs[0].commands[0].x = Infinity;
  assert.throws(() => applyLetterform(bad, 'flourish-swash'), RangeError);
});

test('normalized bounds preserve layer center with rotated glyphs, reflections, multiline and vertical text', () => {
  for (const layout of ['horizontal', 'vertical']) for (const preset of LETTERFORM_PRESETS) {
    const input = realLayer(chinese, '中文\n回田', { layout, rotation: 31, scaleX: -1.3, scaleY: 0.76 });
    input.glyphs[0].rotation = -28;
    const result = applyLetterform(input, preset.id, 0.7);
    finiteGeometry(result);
    assert.deepEqual([result.x, result.y, result.rotation, result.scaleX, result.scaleY], [input.x, input.y, input.rotation, input.scaleX, input.scaleY]);
    assert.ok(Object.values(contentBounds(project(result))).every(Number.isFinite));
    assert.deepEqual(clearLetterform(result), input);
  }
  const empty = { ...source(), glyphs: [] };
  for (const preset of LETTERFORM_PRESETS) assert.deepEqual(geometry(applyLetterform(empty, preset.id, 1)), geometry(empty));
});

test('counter fixture remains transparent and ornaments never XOR a filled body', async () => {
  for (const preset of LETTERFORM_PRESETS) {
    const transformed = applyLetterform(source(), preset.id, 1), image = await raster(transformed, false);
    const glyph = transformed.glyphs.find(item => item.id === 'g0');
    const centerX = transformed.x - transformed.width / 2 + glyph.x + glyph.width / 2;
    const centerY = transformed.y - transformed.height / 2 + glyph.y + glyph.height / 2;
    assert.equal(alphaAt(image, centerX, centerY), 0, `${preset.id} counter`);
    const bodyOnly = await raster({ ...transformed, glyphs: [glyph] }, false);
    for (let offset = 3; offset < image.data.length; offset += 4) {
      assert.ok(image.data[offset] >= bodyOnly.data[offset], `${preset.id} ornament removed body alpha`);
    }
    assert.ok(enclosedHoles(image) >= 1, preset.id);
  }
});

test('all presets render distinct alpha, finite export bounds and transparent borders on real Latin and CJK fonts', async () => {
  for (const [font, text] of [[latin, 'AbgO B8'], [chinese, '花体字造 回田']]) {
    const input = realLayer(font, text), signatures = new Set();
    for (const preset of LETTERFORM_PRESETS) for (const amount of [0.35, 1]) {
      const result = applyLetterform(input, preset.id, amount);
      finiteGeometry(result);
      const image = await raster(result);
      const { width, height } = image.info;
      let filled = 0;
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 128) filled++;
      assert.ok(filled > 1000, `${preset.id} ${text}`);
      assert.equal(alphaAt(image, 0, 0), 0); assert.equal(alphaAt(image, width - 1, height - 1), 0);
      for (let x = 0; x < width; x++) { assert.equal(alphaAt(image, x, 0), 0); assert.equal(alphaAt(image, x, height - 1), 0); }
      for (let y = 0; y < height; y++) { assert.equal(alphaAt(image, 0, y), 0); assert.equal(alphaAt(image, width - 1, y), 0); }
      signatures.add(`${width}:${height}:${image.data.toString('base64')}`);
    }
    assert.equal(signatures.size, 20, text);
  }
});

test('real O B 8 and 回 田 日 counters survive each style at full strength', async () => {
  const measurements = [];
  for (const [font, text] of [[latin, 'OB8'], [chinese, '回田日']]) {
    const input = realLayer(font, text, { x: 500, y: 300 }), baseline = enclosedHoles(await raster(input));
    assert.ok(baseline >= (text === 'OB8' ? 5 : 7), `${text} real reference holes ${baseline}`);
    for (const preset of LETTERFORM_PRESETS) {
      const transformed = applyLetterform(input, preset.id, 1);
      const fullImage = await raster(transformed, false);
      const sourceIds = new Set(input.glyphs.map(glyph => glyph.id));
      const bodyImage = await raster({ ...transformed, glyphs: transformed.glyphs.filter(glyph => sourceIds.has(glyph.id)) }, false);
      const bodyHoles = enclosedHoles(bodyImage, 12, positions => {
        for (const position of positions) assert.ok(fullImage.data[position * 4 + 3] <= 64, `${preset.id}/${text} ornament entered an original counter`);
      });
      assert.equal(bodyHoles, baseline, `${preset.id}/${text} changed original counters`);
      const holes = enclosedHoles(fullImage);
      assert.ok(holes >= baseline, `${preset.id}/${text} ${holes} < ${baseline}`);
      measurements.push(`${preset.id}/${text}:${bodyHoles}`);
    }
  }
  console.log(`Real-font counter counts: ${measurements.join(', ')}`);
});

test('degenerate contours stay empty and source snapshots stay independent for blank glyphs', async () => {
  const paths = [[], [{ type: 'Z' }], [{ type: 'M', x: 1, y: 2 }], [{ type: 'M', x: 1, y: 2 }, { type: 'Z' }], [{ type: 'M', x: 5, y: 5 }, { type: 'L', x: 10, y: 10 }, { type: 'L', x: 20, y: 20 }, { type: 'Z' }]];
  for (const commands of paths) for (const preset of LETTERFORM_PRESETS) {
    const input = source(); input.glyphs[0].commands = structuredClone(commands);
    const transformed = applyLetterform(input, preset.id, 1);
    assert.deepEqual(geometry(transformed), geometry(input), preset.id);
    const mixed = source(); mixed.glyphs.push({ ...input.glyphs[0], id: 'empty', x: 110, char: ' ' }); mixed.width = 210;
    const result = applyLetterform(mixed, preset.id, 1), blank = result.glyphs.find(glyph => glyph.id === 'empty');
    assert.ok(!result.glyphs.some(glyph => glyph.id.startsWith('empty:letterform:')));
    assert.notEqual(blank.commands, result.letterform.sourceGlyphs[1].commands);
    blank.commands.push({ type: 'M', x: 7, y: 8 });
    assert.deepEqual(clearLetterform(result), mixed);
  }
});

test('closed quadratic and single-cubic counters retain filled area after faceting', async () => {
  const counters = [
    [{ type: 'M', x: 25, y: 50 }, { type: 'Q', x1: 50, y1: 0, x: 75, y: 50 }, { type: 'Q', x1: 50, y1: 100, x: 25, y: 50 }, { type: 'Z' }],
    [{ type: 'M', x: 30, y: 60 }, { type: 'C', x1: 95, y1: 20, x2: 10, y2: 5, x: 30, y: 60 }, { type: 'Z' }],
  ];
  for (const counter of counters) {
    const input = source(); input.glyphs[0].commands = [...rectangle(0, 0, 100, 100), ...counter];
    assert.equal(enclosedHoles(await raster(input)), 1);
    for (const preset of LETTERFORM_PRESETS) {
      const result = applyLetterform(input, preset.id, 1);
      const body = { ...result, glyphs: result.glyphs.filter(glyph => glyph.id === 'g0') };
      assert.equal(enclosedHoles(await raster(body)), 1, preset.id);
    }
  }
});

test('dense editable paths do not exhaust the JavaScript argument stack', () => {
  const input = source();
  input.glyphs[0].commands = [{ type: 'M', x: 90, y: 50 }, ...Array.from({ length: 16000 }, (_, i) => ({ type: 'L', x: 50 + 40 * Math.cos((i + 1) * Math.PI / 8000), y: 50 + 40 * Math.sin((i + 1) * Math.PI / 8000) })), { type: 'Z' }];
  for (const id of ['flourish-swash', 'gothic-fraktur']) {
    const result = applyLetterform(input, id, 1);
    finiteGeometry(result); assert.ok(result.glyphs.length > 1);
    assert.deepEqual(clearLetterform(result), input);
  }
});

test('explicit narrow blanks and skipped glyphs stop slanted joins', () => {
  const input = source(); input.width = 220;
  input.glyphs = [input.glyphs[0], { ...structuredClone(input.glyphs[0]), id: 'blank', char: ' ', x: 101, width: 5, commands: [] }, { ...structuredClone(input.glyphs[0]), id: 'last', x: 112 }];
  assert.ok(!applyLetterform(input, 'flourish-slanted', 1).glyphs.some(glyph => glyph.id.includes(':join:')));
});

test('painted path bodies preserve all per-part paint across every letterform', () => {
  for (const preset of LETTERFORM_PRESETS) {
    const input = source(); input.kind = 'path';
    input.glyphs[0].paint = { fill: '#123456', stroke: 'ink', strokeWidth: 4, opacity: 0.4, silhouette: false };
    const before = structuredClone(input);
    const result = applyLetterform(input, preset.id, 0.65);
    const body = result.glyphs.find(glyph => glyph.id === input.glyphs[0].id);
    assert.deepEqual(body.paint, before.glyphs[0].paint, preset.id);
    assert.notEqual(body.paint, input.glyphs[0].paint, preset.id);
    assert.notEqual(body.paint, result.letterform.sourceGlyphs[0].paint, preset.id);
    assert.deepEqual(clearLetterform(result), before, preset.id);
    assert.deepEqual(input, before, preset.id);
  }
});

test('paint snapshots isolate zero, transformed and blank glyphs from source and restoration', () => {
  for (const preset of LETTERFORM_PRESETS) for (const amount of [0, 0.65, 1]) {
    const input = source(); input.kind = 'path';
    input.glyphs[0].paint = { fill: '#123456', stroke: 'none', opacity: 0.4, silhouette: false };
    input.glyphs.push({ id: 'painted-blank', char: ' ', x: 110, y: 0, width: 10, height: 100, commands: [], paint: { fill: 'secondary', stroke: 'none', opacity: 0.2 } });
    input.width = 120;
    const before = structuredClone(input), result = applyLetterform(input, preset.id, amount);
    for (const original of input.glyphs) {
      const current = result.glyphs.find(glyph => glyph.id === original.id);
      const backup = result.letterform.sourceGlyphs.find(glyph => glyph.id === original.id);
      assert.deepEqual(current.paint, original.paint, `${preset.id}/${amount}/${original.id}`);
      assert.notEqual(current.paint, original.paint);
      assert.notEqual(current.paint, backup.paint);
      assert.notEqual(backup.paint, original.paint);
      current.paint.fill = '#ffffff';
      assert.deepEqual(backup.paint, original.paint);
    }
    assert.deepEqual(input, before);
    const restored = clearLetterform(result);
    assert.deepEqual(restored, before);
    restored.glyphs[0].paint.fill = '#000000';
    assert.deepEqual(result.letterform.sourceGlyphs, before.glyphs);
    assert.deepEqual(input, before);
  }
});

test('slanted connectors respect blank spaces, different rows and vertical layout', () => {
  const tight = realLayer(latin, 'OO', { letterSpacing: 0 });
  assert.ok(applyLetterform(tight, 'flourish-slanted', 1).glyphs.some(glyph => glyph.id.includes(':join:')));
  for (const input of [realLayer(latin, 'O O'), realLayer(latin, 'O     O'), realLayer(latin, 'O\nO'), realLayer(latin, 'OO', { layout: 'vertical' })]) {
    assert.ok(!applyLetterform(input, 'flourish-slanted', 1).glyphs.some(glyph => glyph.id.includes(':join:')));
  }
});
