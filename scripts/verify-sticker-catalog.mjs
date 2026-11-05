import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

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
const cache = new Map();
export const stickers = loadSource('catalog/stickers', cache).EXTRA_STICKERS;
export const allStickers = loadSource('presets', cache).STICKERS;
const { stickerGeometry } = loadSource('catalog/sticker-geometry', cache);
export const legacyStickers = stickers.map(sticker => {
  const [, family, variant] = sticker.id.match(/^deco-(.*)-([1-4])$/);
  return { ...sticker, ...stickerGeometry(family, Number(variant) - 1) };
});
export const engine = loadSource('engine', cache);
const { BASE_LAYER, DEFAULT_STYLE } = loadSource('types', cache);
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const esc = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const flatStyle = { ...DEFAULT_STYLE, fill: '#000000', gradient: false, strokeWidth: 0, outerWidth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, depth: 0, texture: 'none', gloss: false, opacity: 1 };

export function stickerLayer(sticker, changes = {}) {
  return { ...BASE_LAYER, id: sticker.id, name: sticker.name, kind: 'sticker', text: '', fontId: '', x: 100, y: 100, glyphs: sticker.glyphs, width: sticker.width, height: sticker.height, style: sticker.style, ...changes };
}
function project(layer) { return { version: 1, name: layer.name, width: 200, height: 200, layers: [layer] }; }
export function geometrySignature(sticker) {
  const minX = Math.min(...sticker.glyphs.map(glyph => glyph.x));
  const minY = Math.min(...sticker.glyphs.map(glyph => glyph.y));
  const boundsWidth = Math.max(...sticker.glyphs.map(glyph => glyph.x + glyph.width)) - minX;
  const boundsHeight = Math.max(...sticker.glyphs.map(glyph => glyph.y + glyph.height)) - minY;
  const maximum = Math.max(boundsWidth, boundsHeight);
  const signatures = [];
  for (let transform = 0; transform < 8; transform++) {
    const swap = transform >= 4, flipX = transform % 2 === 1, flipY = Math.floor(transform / 2) % 2 === 1;
    const width = swap ? boundsHeight : boundsWidth, height = swap ? boundsWidth : boundsHeight;
    const glyphs = sticker.glyphs.map(glyph => glyph.commands.map(command => {
      const values = [command.type];
      for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) if (command[x] !== undefined) {
        const worldX = glyph.x + command[x] - minX, worldY = glyph.y + command[y] - minY;
        let a = swap ? worldY : worldX, b = swap ? worldX : worldY;
        if (flipX) a = width - a;
        if (flipY) b = height - b;
        values.push(Math.round(a / maximum * 1000), Math.round(b / maximum * 1000));
      }
      return values.join(',');
    }).join(';')).sort();
    signatures.push(glyphs.join('|'));
  }
  return digest(signatures.sort()[0]);
}
export async function renderSticker(sticker, changes = {}) {
  const svg = engine.projectSvg(project(stickerLayer(sticker, changes)), { crop: true, padding: 8, scale: 1 });
  assert.doesNotMatch(svg, /NaN|Infinity|<text|@font-face|https?:\/\/(?!www\.w3\.org)/, sticker.id);
  const image = sharp(Buffer.from(svg));
  const { data, info } = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const png = await image.png().toBuffer();
  let filled = 0, transparent = 0, borderAlpha = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (alpha > 16) filled++;
    if (alpha === 0) transparent++;
    if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) borderAlpha = Math.max(borderAlpha, alpha);
  }
  return { svg, png, data, info, filled, transparent, borderAlpha, hash: digest(data) };
}
export async function silhouette(sticker) {
  const layer = stickerLayer(sticker, { x: 72, y: 72, style: flatStyle });
  const svg = engine.projectSvg({ version: 1, name: '', width: 144, height: 144, layers: [layer] });
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rotations = [];
  for (let t = 0; t < 8; t++) {
    const pixels = Buffer.alloc(144 * 144);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 144; x++) {
      let a = t >= 4 ? y : x, b = t >= 4 ? x : y;
      if (t % 2) a = 143 - a;
      if (Math.floor(t / 2) % 2) b = 143 - b;
      pixels[y * 144 + x] = data[(b * 144 + a) * 4 + 3] >= 128 ? 255 : 0;
    }
    rotations.push(digest(pixels));
  }
  return rotations.sort()[0];
}
function references(value, result = new Set()) {
  if (value && typeof value === 'object' && !result.has(value)) {
    result.add(value);
    for (const child of Object.values(value)) references(child, result);
  }
  return result;
}
export async function evaluateStickerCatalog(catalog = stickers, { uniqueSilhouettes = false } = {}) {
  const rows = [], geometry = new Map(), silhouettes = new Map(), pixels = new Map();
  for (const sticker of catalog) {
    const signature = geometrySignature(sticker);
    assert.ok(!geometry.has(signature), `${sticker.id} repeats geometry ${geometry.get(signature)}`);
    geometry.set(signature, sticker.id);
    const shape = await silhouette(sticker);
    if (uniqueSilhouettes) assert.ok(!silhouettes.has(shape), `${sticker.id} repeats a rotated/reflected silhouette ${silhouettes.get(shape)}`);
    silhouettes.set(shape, sticker.id);
    const rendered = await renderSticker(sticker);
    assert.ok(!pixels.has(rendered.hash), `${sticker.id} repeats pixels ${pixels.get(rendered.hash)}`);
    pixels.set(rendered.hash, sticker.id);
    assert.ok(rendered.filled > 80, `${sticker.id} is visually empty`);
    assert.ok(rendered.transparent > 300, `${sticker.id} has no transparent exterior`);
    assert.equal(rendered.borderAlpha, 0, `${sticker.id} touches export bounds`);
    const source = stickerLayer(sticker), before = JSON.stringify(sticker);
    const clone = engine.cloneLayer(source), originalReferences = references(source);
    assert.notEqual(clone.id, sticker.id);
    for (const object of references(clone)) assert.ok(!originalReferences.has(object), `${sticker.id} clone shares mutable data`);
    assert.equal(new Set(clone.glyphs.map(glyph => glyph.id)).size, clone.glyphs.length, `${sticker.id} duplicate clone glyph IDs`);
    const originalIds = new Set(source.glyphs.map(glyph => glyph.id));
    assert.ok(clone.glyphs.every(glyph => !originalIds.has(glyph.id)), `${sticker.id} clone reuses glyph IDs`);
    assert.deepEqual(clone.glyphs.map(({ id, ...glyph }) => glyph), source.glyphs.map(({ id, ...glyph }) => glyph), `${sticker.id} clone changes geometry or paint`);
    assert.deepEqual(clone.style, source.style, `${sticker.id} clone changes style`);
    let boundary;
    for (const [glyphIndex, glyph] of clone.glyphs.entries()) for (const [commandIndex, command] of glyph.commands.entries()) {
      if (command.x !== undefined && (!boundary || glyph.x + command.x > boundary.worldX)) boundary = { command, glyphIndex, commandIndex, worldX: glyph.x + command.x };
    }
    assert.ok(boundary, `${sticker.id} has no editable node`);
    const originalNodeX = boundary.command.x;
    boundary.command.x += 8;
    const svgAfter = engine.projectSvg(project({ ...clone, x: 100, y: 100 }), { crop: true, padding: 8, scale: 1 });
    // Keep the original viewport so a crop-size change alone cannot pass the node-edit check.
    const viewport = rendered.svg.match(/^<svg\b[^>]*>/)?.[0];
    assert.ok(viewport, `${sticker.id} missing SVG viewport`);
    const editedPixels = await sharp(Buffer.from(svgAfter.replace(/^<svg\b[^>]*>/, viewport))).ensureAlpha().raw().toBuffer();
    assert.equal(editedPixels.length, rendered.data.length, `${sticker.id} edited viewport changed`);
    let nodeEditPixels = 0;
    for (let i = 0; i < editedPixels.length; i += 4) {
      const a = editedPixels[i + 3], b = rendered.data[i + 3];
      if (a !== b || [0, 1, 2].some(channel => editedPixels[i + channel] * a !== rendered.data[i + channel] * b)) nodeEditPixels++;
    }
    assert.notEqual(digest(editedPixels), rendered.hash, `${sticker.id} node edit is visually inert`);
    assert.ok(nodeEditPixels > 0, `${sticker.id} node edit changes no visible pixels`);
    assert.equal(JSON.stringify(sticker), before, `${sticker.id} shares edited data`);
    rows.push({ id: sticker.id, name: sticker.name, category: sticker.category, glyphs: sticker.glyphs.length, commands: sticker.glyphs.reduce((sum, glyph) => sum + glyph.commands.length, 0), width: sticker.width, height: sticker.height, geometry: signature, silhouette: shape, pixels: rendered.hash, filled: rendered.filled, transparent: rendered.transparent, borderAlpha: rendered.borderAlpha, nodeEdit: { glyphIndex: boundary.glyphIndex, commandIndex: boundary.commandIndex, fromX: originalNodeX, toX: boundary.command.x, changedPixels: nodeEditPixels }, cloneIndependent: true, png: rendered.png });
  }
  return rows;
}
async function contactSheet(rows, title, columns = 4) {
  const cellW = 200, cellH = 177, header = 55;
  const width = columns * cellW, height = header + Math.ceil(rows.length / columns) * cellH;
  const tiles = rows.map((row, i) => `<g transform="translate(${i % columns * cellW} ${header + Math.floor(i / columns) * cellH})"><rect x="7" y="4" width="186" height="166" rx="12" fill="#fffdf8"/><image href="data:image/png;base64,${row.png.toString('base64')}" x="26" y="6" width="148" height="135" preserveAspectRatio="xMidYMid meet"/><text x="100" y="159" text-anchor="middle" font-size="13" fill="#383b37">${esc(row.name)}</text></g>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eeebe4"/><g font-family="Microsoft YaHei, sans-serif"><text x="18" y="34" font-size="21" font-weight="700" fill="#2c3b34">${esc(title)}</text>${tiles}</g></svg>`)).png().toBuffer();
}
async function main() {
  const rows = await evaluateStickerCatalog();
  const directory = path.join(root, 'verification', 'catalog', 'stickers');
  await mkdir(directory, { recursive: true });
  const categories = [...new Set(rows.map(row => row.category))];
  const links = [];
  for (let i = 0; i < categories.length; i++) {
    const selected = rows.filter(row => row.category === categories[i]);
    const file = `category-${String(i + 1).padStart(2, '0')}.png`;
    await writeFile(path.join(directory, file), await contactSheet(selected, `${categories[i]} · ${selected.length}款`));
    links.push(`<section><h2>${esc(categories[i])}</h2><img src="${file}" loading="lazy" alt="${esc(categories[i])}完整接触表"/></section>`);
  }
  const representatives = categories.flatMap(category => rows.filter(row => row.category === category).filter((_, index) => index === 0 || index === 7 || index === 13));
  await writeFile(path.join(directory, 'representatives.png'), await contactSheet(representatives, '原创装饰目录 · 20主题选览', 6));
  const metadata = rows.map(({ png, ...row }) => row);
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ count: rows.length, geometryMethod: 'Global bounds origin removed; uniform scale and eight reflected axes normalized', silhouetteMethod: '144px alpha>=128 bitmap D4 hash; raster edge differences are not a proof of geometric inequality', categories: categories.map(category => ({ name: category, count: rows.filter(row => row.category === category).length })), geometryUnique: new Set(rows.map(row => row.geometry)).size, silhouetteUnique: new Set(rows.map(row => row.silhouette)).size, pixelUnique: new Set(rows.map(row => row.pixels)).size, allBordersTransparent: rows.every(row => row.borderAlpha === 0), allEditable: true, rows: metadata }, null, 2));
  await writeFile(path.join(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原创装饰全量校验</title><style>body{margin:0;padding:32px;background:#eeebe4;color:#293a31;font:16px/1.6 'Microsoft YaHei',sans-serif}main{max-width:1024px;margin:auto}h1{font-size:32px}section{margin:36px 0}img{max-width:100%;height:auto;border-radius:12px}p{color:#59665e}</style><main><h1>388件原创装饰 · 20个主题</h1><p>全量真实SVG渲染、透明边缘与节点编辑均已实测。归一化几何签名消除整体平移、等比缩放和镜像方向；144像素阈值位图D4哈希另行检查。栅格边缘误差不作为几何差异的证明。原12件由主目录保留。</p>${links.join('')}</main></html>`);
  console.log(JSON.stringify({ stickers: rows.length, categories: categories.length, geometryUnique: new Set(rows.map(row => row.geometry)).size, silhouetteUnique: new Set(rows.map(row => row.silhouette)).size, pixelUnique: new Set(rows.map(row => row.pixels)).size, transparentBorders: rows.filter(row => row.borderAlpha === 0).length, editable: rows.length, output: directory }));
}
export async function verifyCurrentStickerQuality() {
  assert.equal(allStickers.length, 400);
  const rows = await evaluateStickerCatalog(allStickers);
  assert.equal(new Set(rows.map(row => row.geometry)).size, 400);
  assert.equal(new Set(rows.map(row => row.pixels)).size, 400);
  const silhouetteGroups = new Map();
  for (const row of rows) {
    if (!silhouetteGroups.has(row.silhouette)) silhouetteGroups.set(row.silhouette, []);
    silhouetteGroups.get(row.silhouette).push(row.id);
  }
  const directory = path.join(root, 'verification', 'decoration-refresh', 'quality');
  await mkdir(directory, { recursive: true });
  const report = {
    createdAt: new Date().toISOString(), command: 'node scripts/verify-sticker-catalog.mjs --quality',
    nodeVersion: process.version, count: rows.length,
    geometryMethod: 'Global bounds origin removed; uniform scale and eight reflected axes normalized; IDs, names, char labels, paint and colors excluded',
    silhouetteMethod: '144px alpha>=128 bitmap D4 hash; measured shape count, not an expected uniqueness requirement for painted artwork',
    nodeEditMethod: 'Rightmost endpoint x + 8; original SVG viewport retained; alpha and premultiplied RGB differences counted',
    geometryUnique: new Set(rows.map(row => row.geometry)).size,
    pixelUnique: new Set(rows.map(row => row.pixels)).size,
    silhouetteUnique: silhouetteGroups.size,
    sharedSilhouettes: [...silhouetteGroups.values()].filter(ids => ids.length > 1),
    editable: rows.filter(row => row.nodeEdit.changedPixels > 0).length,
    cloneIndependent: rows.filter(row => row.cloneIndependent).length,
    transparentBorders: rows.filter(row => row.borderAlpha === 0).length,
    minNodeEditPixels: Math.min(...rows.map(row => row.nodeEdit.changedPixels)),
    rows: rows.map(({ png, ...row }) => row),
  };
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const { rows: details, sharedSilhouettes, ...summary } = report;
  console.log(JSON.stringify({ ...summary, output: directory }));
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--quality')) await verifyCurrentStickerQuality();
  else await main();
}
