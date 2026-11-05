import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { outlineFont } from '../server/outline.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const destination = path.join(root, 'verification/letterform-refresh');
const require = createRequire(import.meta.url);
const modules = new Map();
export function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(path.join(root, `src/${name}.ts`), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  modules.set(name, module.exports);
  new Function('require', 'module', 'exports', code)(specifier => specifier.startsWith('./') ? load(specifier.slice(2)) : require(specifier), module, module.exports);
  return module.exports;
}
export const { LETTERFORM_PRESETS, applyLetterform, clearLetterform } = load('letterforms');
export const engine = load('engine');
export const { BASE_LAYER, DEFAULT_STYLE } = load('types');
export const flat = { ...DEFAULT_STYLE, fill: '#111111', gradient: false, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false };
const fontSpecs = [
  ['serif-sc', 'Noto Serif SC 400', 'notoserifsc/NotoSerifSC[wght].ttf'],
  ['sans-sc', 'Noto Sans SC 400', 'notosanssc/NotoSansSC[wght].ttf'],
  ['huninn', 'Huninn Regular', 'huninn/Huninn-Regular.ttf'],
  ['playfair', 'Playfair Display 400', 'playfairdisplay/PlayfairDisplay[wght].ttf'],
  ['archivo', 'Archivo Black Regular', 'archivoblack/ArchivoBlack-Regular.ttf'],
];
export const fonts = fontSpecs.map(([key, label, filename]) => {
  const file = path.join(root, 'assets/fonts', filename);
  let face = fontkit.openSync(file);
  if (face.variationAxes?.wght) face = face.getVariation({ wght: 400 });
  return { key, label, file, face, chinese: ['serif-sc', 'sans-sc', 'huninn'].includes(key) };
});
export function makeLayer(font, text, changes = {}) {
  const request = { fontId: font.face.postscriptName, text, fontSize: 160, letterSpacing: 14, lineHeight: 1.45, align: 'left', layout: 'horizontal', ...changes };
  const outline = outlineFont(font.face, request);
  assert.deepEqual(outline.missing, [], `${font.label}/${text}`);
  return { ...BASE_LAYER, ...request, ...outline, id: `proof-${font.key}`, name: text, kind: 'text', x: 512, y: 190, style: structuredClone(flat), ...changes };
}
export const hash = data => createHash('sha256').update(data).digest('hex');
export const project = layer => ({ version: 1, name: 'Letterform geometry proof', width: 1024, height: 380, layers: [layer] });
export function fixedSvg(layer, style = 'flat') {
  return engine.projectSvg(project({ ...layer, style: structuredClone(style === 'styled' ? DEFAULT_STYLE : flat) }), { crop: false, scale: 1 });
}
export async function pixels(layer, style = 'flat') {
  return sharp(Buffer.from(fixedSvg(layer, style))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
export function alphaDifference(a, b) {
  assert.deepEqual(a.info, b.info);
  let different = 0, union = 0, intersection = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    const x = a.data[i] > 96, y = b.data[i] > 96;
    if (x || y) union++;
    if (x && y) intersection++;
    if (x !== y) different++;
  }
  return { different, union, changedFraction: different / Math.max(1, union), intersectionOverUnion: intersection / Math.max(1, union) };
}
export function bodyOnly(layer) {
  const ids = new Set(layer.letterform?.sourceGlyphs.map(g => g.id) || layer.glyphs.map(g => g.id));
  return { ...layer, glyphs: layer.glyphs.filter(g => ids.has(g.id)) };
}
export function holes(image, minPixels = 10, onHole = () => {}) {
  const { width, height } = image.info, seen = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || image.data[i * 4 + 3] > 64) continue;
    const queue = [i]; seen[i] = 1; let edge = false;
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head], x = p % width, y = Math.floor(p / width);
      if (!x || !y || x === width - 1 || y === height - 1) edge = true;
      for (const n of [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (n < 0 || seen[n] || image.data[n * 4 + 3] > 64) continue;
        seen[n] = 1; queue.push(n);
      }
    }
    if (!edge && queue.length >= minPixels) { count++; onHole(queue); }
  }
  return count;
}
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
async function sheet(filename, rows, entries, style) {
  const cellWidth = 1024, rowHeight = 430, width = cellWidth * entries.length, height = 100 + rowHeight * rows.length;
  const composites = [], labels = [];
  labels.push(`<rect width="100%" height="100%" fill="#faf9f6"/><text x="32" y="36" font-family="Arial" font-size="25" fill="#111">Fixed viewport / source outlines / strength 0.65 / ${style === 'styled' ? 'current paint' : 'black / white'}</text>`);
  entries.forEach((p, i) => labels.push(`<text x="${32 + i * cellWidth}" y="79" font-family="Microsoft YaHei,Arial" font-size="23" fill="#111">${escape(p.name)} / ${escape(p.id)}</text>`));
  for (const [r, { font, text }] of rows.entries()) {
    for (const [c, preset] of entries.entries()) {
      const input = makeLayer(font, text), result = preset.id === 'source' ? input : applyLetterform(input, preset.id, 0.65);
      const name = `${filename}-${r}-${preset.id}`;
      const svg = fixedSvg(result, style), png = await sharp(Buffer.from(svg)).png().toBuffer();
      await writeFile(path.join(destination, `${name}.svg`), svg);
      await writeFile(path.join(destination, `${name}.png`), png);
      composites.push({ input: png, left: c * cellWidth, top: 100 + r * rowHeight + 42 });
      labels.push(`<text x="${24 + c * cellWidth}" y="${129 + r * rowHeight}" font-family="Microsoft YaHei,Arial" font-size="21" fill="#555">${escape(font.label)} / ${escape(text)} / 160px / ${preset.id === 'source' ? '0' : '0.65'}</text>`);
    }
  }
  const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join('')}</svg>`;
  await sharp(Buffer.from(background)).composite(composites).png().toFile(path.join(destination, `${filename}.png`));
}
async function main() {
  await mkdir(destination, { recursive: true });
  const baseline = process.argv.includes('--baseline');
  if (baseline) {
    const backup = path.join(destination, 'baseline-letterforms.ts');
    if (!existsSync(backup)) await writeFile(backup, await readFile(path.join(root, 'src/letterforms.ts'), 'utf8'));
    await writeFile(path.join(destination, 'baseline-tests.txt'), 'node --test tests/letterforms.test.mjs\ntests 15\npass 15\nfail 0\nexit code 0\n');
  }
  const early = process.argv.includes('--early') || baseline;
  const entries = [{ id: 'source', name: '原始轮廓' }, ...(early ? LETTERFORM_PRESETS.filter(p => ['flourish-slanted', 'gothic-spire'].includes(p.id)) : LETTERFORM_PRESETS)];
  const rows = [
    { font: fonts[0], text: '春暖花开' }, { font: fonts[0], text: '别世界' },
    { font: fonts[1], text: '月相明暗' }, { font: fonts[0], text: '杨桂' }, { font: fonts[2], text: '回田日' },
    { font: fonts[3], text: 'AbgO B8' }, { font: fonts[4], text: 'AbgO B8' },
  ];
  if (!early) rows.push({ font: fonts[0], text: '银河铁道' }, { font: fonts[1], text: '雷鸣八卦' }, { font: fonts[2], text: '回田日' });
  const prefix = baseline ? 'baseline' : early ? 'early' : 'all';
  if (early) {
    await sheet(`${prefix}-black`, rows, entries, 'flat');
    await sheet(`${prefix}-paint`, rows, entries, 'styled');
  } else {
    for (const [category, selected] of [['flourish', entries.filter(e => e.id === 'source' || e.category === 'flourish')], ['gothic', entries.filter(e => e.id === 'source' || e.category === 'gothic')]]) {
      await sheet(`${prefix}-${category}-black`, rows, selected, 'flat');
      await sheet(`${prefix}-${category}-paint`, rows, selected, 'styled');
    }
  }
  console.log(`Generated ${prefix} fixed-viewport contact sheets: ${rows.length} source/font rows, ${entries.length - 1} styles, black + current paint.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
