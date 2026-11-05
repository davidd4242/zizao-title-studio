import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { outlineFont } from '../server/outline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
export function loadSource(relative, cache = new Map()) {
  const file = path.resolve(root, 'src', relative.endsWith('.ts') ? relative : `${relative}.ts`);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const source = readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })((specifier) => {
    if (!specifier.startsWith('.')) return nativeRequire(specifier);
    return loadSource(path.relative(path.join(root, 'src'), path.resolve(path.dirname(file), specifier)), cache);
  }, module, module.exports);
  return module.exports;
}

export const presets = loadSource('catalog/styles').EXTRA_STYLE_PRESETS;
const engine = loadSource('engine');
const { BASE_LAYER } = loadSource('types');
const fontPath = [process.env.STYLE_TEST_FONT, 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttf'].find(file => file && existsSync(file));
assert.ok(fontPath, 'STYLE_TEST_FONT or Microsoft YaHei is required for real Chinese outline verification');
const fontFile = fontkit.create(readFileSync(fontPath));
const font = fontFile.fonts?.[0] || fontFile;
const request = { fontId: 'catalog-verification', text: '字造封面', fontSize: 84, letterSpacing: 5, lineHeight: 1.2, align: 'left', layout: 'horizontal' };
const outline = outlineFont(font, request);
assert.deepEqual(outline.missing, [], 'Chinese verification font must cover the real sample');

function projectFor(preset) {
  return { version: 1, name: preset.name, width: 720, height: 240, layers: [{
    ...BASE_LAYER, ...request, ...outline, id: 'style-proof', name: preset.name, kind: 'text',
    x: 360, y: 120, rotation: 0, scaleX: 1, scaleY: 1, style: preset.style,
  }] };
}
export async function renderPreset(preset) {
  const svg = engine.projectSvg(projectFor(preset), { crop: true, padding: 18, scale: 1 });
  assert.doesNotMatch(svg, /NaN|Infinity|<text|@font-face|https?:\/\/(?!www\.w3\.org)/);
  const image = sharp(Buffer.from(svg));
  const { data, info } = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const png = await image.png().toBuffer();
  let filled = 0;
  let transparent = 0;
  let antialiased = 0;
  let borderAlpha = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (alpha > 0) filled++;
    if (alpha === 0) transparent++;
    if (alpha > 0 && alpha < 255) antialiased++;
    if (!x || !y || x === info.width - 1 || y === info.height - 1) borderAlpha = Math.max(borderAlpha, alpha);
  }
  return { preset, png, width: info.width, height: info.height, filled, transparent, antialiased, borderAlpha, hash: createHash('sha256').update(data).digest('hex') };
}
export async function evaluateStyleCatalog() {
  const results = [];
  for (const preset of presets) results.push(await renderPreset(preset));
  return results;
}

function labelSvg(text, size, color, width, height) {
  const label = outlineFont(font, { ...request, text, fontSize: size, letterSpacing: 0 });
  const paths = label.glyphs.map(glyph => `<path transform="translate(${glyph.x} ${glyph.y})" d="${engine.commandPath(glyph.commands)}"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="${color}" fill-rule="evenodd">${paths}</g></svg>`);
}
async function contactSheet(items, filename, columns = 4) {
  const cellWidth = 340;
  const cellHeight = 174;
  const layers = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const dark = i % 2 === 1;
    const left = (i % columns) * cellWidth;
    const top = Math.floor(i / columns) * cellHeight;
    layers.push({ input: await sharp({ create: { width: cellWidth - 8, height: cellHeight - 8, channels: 4, background: dark ? '#293334' : '#f7f3e9' } }).png().toBuffer(), left: left + 4, top: top + 4 });
    const preview = await sharp(item.png).resize({ width: 304, height: 114, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    layers.push({ input: preview.data, left: left + Math.round((cellWidth - preview.info.width) / 2), top: top + 7 + Math.round((114 - preview.info.height) / 2) });
    layers.push({ input: labelSvg(item.preset.name, 17, dark ? '#f6efdf' : '#303a35', 300, 23), left: left + 18, top: top + 122 });
    layers.push({ input: labelSvg(item.preset.category, 12, dark ? '#c4cdbf' : '#6b756b', 300, 19), left: left + 18, top: top + 148 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(items.length / columns) * cellHeight, channels: 4, background: '#deddd3' } }).composite(layers).png().toFile(filename);
}
async function main() {
  const results = await evaluateStyleCatalog();
  for (const item of results) {
    assert.ok(item.filled > 3000, `${item.preset.id} must render readable glyph pixels`);
    assert.ok(item.transparent > 1000, `${item.preset.id} must preserve transparent background`);
    assert.ok(item.antialiased > 100, `${item.preset.id} must retain antialiased edges`);
    assert.equal(item.borderAlpha, 0, `${item.preset.id} must stay inside crop padding`);
  }
  assert.equal(new Set(results.map(item => item.hash)).size, presets.length, 'every rendered preset must be distinct');
  const output = path.join(root, 'verification/catalog/styles');
  await mkdir(output, { recursive: true });
  const categories = [...new Set(presets.map(preset => preset.category))];
  const representatives = categories.flatMap(category => {
    const items = results.filter(item => item.preset.category === category);
    return [items[0], items[4]];
  });
  await contactSheet(representatives, path.join(output, 'representatives.png'));
  for (let start = 0; start < results.length; start += 50) await contactSheet(results.slice(start, start + 50), path.join(output, `all-${Math.floor(start / 50) + 1}.png`), 5);
  const report = { font: font.fullName, count: presets.length, categories: categories.map(name => ({ name, count: presets.filter(preset => preset.category === name).length })), uniqueRenders: new Set(results.map(item => item.hash)).size, samples: results.map(({ preset, png, ...item }) => ({ id: preset.id, name: preset.name, category: preset.category, ...item })) };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ count: report.count, categories: categories.length, uniqueRenders: report.uniqueRenders, transparent: results.length, borderClipping: 0, contactSheets: 5, output }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
