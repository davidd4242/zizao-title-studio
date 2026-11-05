import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { loadSource } from './verify-sticker-catalog.mjs';
import { outlineFont } from '../server/outline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map();
const { EXTRA_STICKERS } = loadSource('catalog/stickers', cache);
const { STICKERS } = loadSource('presets', cache);
const { candyArt } = loadSource('catalog/sticker-art', cache);
const { paintedStickerGeometry } = loadSource('catalog/sticker-geometry', cache);
const { BASE_LAYER, DEFAULT_STYLE } = loadSource('types', cache);
const engine = loadSource('engine', cache);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export const representativeIds = ['deco-starburst-4','deco-heart-token-2','deco-classic-bow-3','deco-garden-flower-2','deco-layer-cake-1','deco-ice-cream-2','deco-boba-2','deco-bunny-face-4','deco-little-ghost-1','deco-witch-hat-2','deco-controller-4','deco-camera-3','deco-royal-crown-1','deco-planet-1','deco-tea-pot-3','deco-magic-wand-4'];
export function previewSticker(id) {
  const old = EXTRA_STICKERS.find(s => s.id === id);
  assert.ok(old, id);
  const [, family, number] = id.match(/^deco-(.*)-(\d)$/);
  const art = candyArt(family, +number - 1);
  assert.ok(art, `Missing representative ${id}`);
  return { ...old, ...paintedStickerGeometry(family, +number - 1, art.parts), style: { ...old.style, gradient: false, strokeWidth: 4, outerStroke: '#fffaf2', outerWidth: 6.5, depth: 3.6, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false, ...art.style } };
}
export function previewLayer(sticker, x = 150, y = 150, extra = {}) {
  return { ...BASE_LAYER, id: sticker.id, name: sticker.name, kind: 'sticker', text: '', fontId: '', x, y, width: sticker.width, height: sticker.height, glyphs: structuredClone(sticker.glyphs), style: structuredClone(sticker.style), ...extra };
}
const project = (layers, width = 300, height = 300, name = '分色糖果贴纸') => ({ version: 1, name, width, height, layers });
async function png(p, options = { crop: true, padding: 8 }) {
  const svg = engine.projectSvg(p, options);
  assert.doesNotMatch(svg, /NaN|Infinity|<text|@font-face/);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
function font(pathname) { const source = fontkit.openSync(pathname); return source.fonts ? source.fonts[0] : source; }
function title(text, fontPath, x, y, size, colors, id) {
  const outline = outlineFont(font(fontPath), { fontId: id, text, fontSize: size, letterSpacing: 6, lineHeight: 1.2, align: 'center', layout: 'horizontal' });
  return { ...BASE_LAYER, id, name: text, kind: 'text', text, fontId: id, x, y, width: outline.width, height: outline.height, glyphs: outline.glyphs, style: { ...DEFAULT_STYLE, fill: colors[0], fill2: colors[1], stroke: colors[2], outerStroke: '#fffaf4', outerWidth: 12, strokeWidth: 5, gradient: false, depth: 7, depthColor: colors[3], shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false } };
}
export async function verifyStickerRefresh() {
  const out = path.join(root, 'verification', 'decoration-refresh');
  await mkdir(out, { recursive: true });
  const rows = [];
  for (const id of representativeIds) {
    const item = previewSticker(id), layer = previewLayer(item);
    const image = await png(project([layer]));
    await writeFile(path.join(out, `${id}.png`), image);
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let filled = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 240) { filled++; colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`); }
    assert.ok(filled > 500, `${id} empty`);
    assert.ok(colors.size > 8, `${id} missing independent color faces`);
    for (const [x, y] of [[0,0],[info.width-1,0],[0,info.height-1],[info.width-1,info.height-1]]) assert.equal(data[(y * info.width + x) * 4 + 3], 0, `${id} exterior alpha`);
    rows.push({ id, name: item.name, image, parts: item.glyphs.length, colors: colors.size });
  }
  const cellW = 300, cellH = 250, header = 70;
  const tiles = rows.map((row, i) => `<g transform="translate(${i % 4 * cellW},${header + Math.floor(i / 4) * cellH})"><rect x="8" y="5" width="284" height="236" rx="16" fill="${i % 3 === 0 ? '#eee4ee' : i % 3 === 1 ? '#e3edf0' : '#f4ecdc'}"/><image x="24" y="16" width="180" height="177" href="data:image/png;base64,${row.image.toString('base64')}"/><image x="217" y="80" width="64" height="64" href="data:image/png;base64,${row.image.toString('base64')}"/><text x="148" y="214" text-anchor="middle" font-size="17" fill="#5f4668">${esc(row.name)}</text></g>`).join('');
  const contact = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1070"><rect width="1200" height="1070" fill="#faf8f4"/><g font-family="Microsoft YaHei,sans-serif"><text x="28" y="42" font-size="27" font-weight="700" fill="#684a6c">糖果贴纸 · 分色与造型初稿</text><text x="1170" y="42" text-anchor="end" font-size="15" fill="#8b7c90">大图 + 64px实际小图</text>${tiles}</g></svg>`;
  await writeFile(path.join(out, 'representatives.png'), await sharp(Buffer.from(contact)).png().toBuffer());
  const pick = (id, x, y, scale = 1, rotation = 0) => previewLayer(previewSticker(id), x, y, { scaleX: scale, scaleY: scale, rotation, id: `${id}-${x}` });
  const chinese = project([
    pick('deco-planet-1', 984, 155, 1.2, 14), pick('deco-starburst-4', 245, 168, 0.7, -18),
    title('甜心放送', 'C:/Windows/Fonts/STHUPO.TTF', 600, 330, 194, ['#ffabd1','#ffe5ae','#a26094','#be78aa'], 'title-zh'),
    pick('deco-bunny-face-4', 169, 340, 1.35, -13), pick('deco-layer-cake-1', 996, 410, 1.3, 10),
    pick('deco-classic-bow-3', 350, 485, 0.8, -5), pick('deco-garden-flower-2', 796, 500, 0.7, 7),
  ], 1200, 660, '甜心放送 · 实际矢量标题组合');
  const english = project([
    pick('deco-heart-token-2', 1020, 165, 0.8, 15), pick('deco-planet-1', 218, 170, 0.9, -13),
    title('Candy Day', 'C:/Windows/Fonts/ARLRDBD.TTF', 600, 335, 155, ['#a1dcf7','#ffe8a9','#568fb5','#64abd1'], 'title-en'),
    pick('deco-ice-cream-2', 111, 403, 1.1, -12), pick('deco-boba-2', 1059, 382, 1.13, 9),
    pick('deco-little-ghost-1', 320, 482, 0.72, -6), pick('deco-magic-wand-4', 890, 485, 0.75, -16),
  ], 1200, 660, 'Candy Day · 实际矢量标题组合');
  for (const [id, p] of [['composition-cn', chinese], ['composition-en', english]]) {
    const svg = engine.projectSvg(p);
    await writeFile(path.join(out, `${id}.svg`), svg);
    await writeFile(path.join(out, `${id}.json`), JSON.stringify(p, null, 2));
    await writeFile(path.join(out, `${id}.png`), await png(p, {}));
    const background = id.endsWith('cn') ? '#f5e9f0' : '#eaf1f4';
    await writeFile(path.join(out, `${id}-preview.png`), await sharp(Buffer.from(svg)).flatten({ background }).png().toBuffer());
  }
  await writeFile(path.join(out, 'preview-report.json'), JSON.stringify({ representatives: rows.map(({ image, ...r }) => r), schema: 'Glyph.paint optional; no field preserves legacy engine', compositions: ['composition-cn','composition-en'] }, null, 2));
  console.log(JSON.stringify({ representatives: rows.length, paintedParts: rows.reduce((sum, row) => sum + row.parts, 0), compositions: 2, output: out }));
  return rows;
}
export async function verifyFullStickerRefresh() {
  const out = path.join(root, 'verification', 'decoration-refresh', 'catalog');
  await mkdir(out, { recursive: true });
  assert.equal(STICKERS.length, 400);
  assert.equal(new Set(STICKERS.map(item => item.id)).size, 400);
  const rows = [];
  for (const item of STICKERS) {
    assert.ok(item.glyphs.every(glyph => glyph.paint), `${item.id} missing paint`);
    const image = await png(project([previewLayer(item)]));
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const palette = new Set();
    let filled = 0, transparent = 0, borderAlpha = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4, a = data[i + 3];
      if (a === 0) transparent++;
      if (a > 240) { filled++; palette.add(`${data[i] >> 4},${data[i+1] >> 4},${data[i+2] >> 4}`); }
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) borderAlpha = Math.max(borderAlpha, a);
    }
    assert.ok(filled > 80 && transparent > 300, `${item.id} empty or opaque exterior`);
    assert.equal(borderAlpha, 0, `${item.id} cropped effect`);
    rows.push({ id: item.id, name: item.name, category: item.id.startsWith('deco-') ? item.category : '经典装饰', parts: item.glyphs.length, colors: palette.size, filled, transparent, borderAlpha, image });
  }
  async function sheet(selected, name, title, classic = false) {
    const cellW = classic ? 360 : 300, cellH = classic ? 330 : 218, imageSize = classic ? 256 : 164;
    const width = cellW * 4, height = 62 + Math.ceil(selected.length / 4) * cellH;
    const tiles = selected.map((row, i) => `<g transform="translate(${i % 4 * cellW},${62 + Math.floor(i / 4) * cellH})"><rect x="6" y="4" width="${cellW - 12}" height="${cellH - 9}" rx="13" fill="${i % 3 === 0 ? '#eee4ee' : i % 3 === 1 ? '#e3edf0' : '#f4ecdc'}"/><image x="12" y="9" width="${imageSize}" height="${imageSize}" href="data:image/png;base64,${row.image.toString('base64')}"/><image x="${cellW - 82}" y="${classic ? 109 : 62}" width="64" height="64" href="data:image/png;base64,${row.image.toString('base64')}"/><text x="${cellW / 2}" y="${cellH - 30}" text-anchor="middle" font-size="15" fill="#614a68">${esc(row.name)}</text><text x="${cellW / 2}" y="${cellH - 13}" text-anchor="middle" font-size="10" fill="#8c7a93">${esc(row.id)}</text></g>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#faf8f4"/><g font-family="Microsoft YaHei,sans-serif"><text x="20" y="39" font-size="25" fill="#684a6c">${esc(title)} · 大图 / 64px</text>${tiles}</g></svg>`;
    await writeFile(path.join(out, name), await sharp(Buffer.from(svg)).png().toBuffer());
  }
  const categories = [...new Set(rows.map(row => row.category))], links = [];
  for (const [index, category] of categories.entries()) {
    const filename = category === '经典装饰' ? 'classics-256-64.png' : `category-${String(index).padStart(2, '0')}.png`;
    const selected = rows.filter(row => row.category === category);
    await sheet(selected, filename, `${category} · ${selected.length}款`, category === '经典装饰');
    links.push(`<section><h2>${esc(category)}</h2><img src="${filename}" alt="${esc(category)}" loading="lazy"></section>`);
  }
  await sheet(categories.flatMap(category => rows.filter(row => row.category === category).filter((_, i) => i === 0 || i === 7)), 'all-category-representatives.png', '全分类代表图');
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ total: rows.length, painted: rows.length, categories: categories.map(name => ({ name, count: rows.filter(row => row.category === name).length })), rows: rows.map(({ image, ...r }) => r) }, null, 2));
  await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>分色装饰全分类验证</title><style>body{background:#faf8f4;color:#614a68;font:16px/1.6 'Microsoft YaHei',sans-serif;margin:28px}main{max-width:1440px;margin:auto}img{max-width:100%;height:auto}section{margin:36px 0}</style><main><h1>400款分色装饰</h1><p>每款保留稳定标识与可编辑路径。所有分类均提供实际透明渲染的大图与64px缩图。</p>${links.join('')}</main></html>`);
  console.log(JSON.stringify({ stickers: rows.length, painted: rows.length, categories: categories.length, maxParts: Math.max(...rows.map(row => row.parts)), output: out }));
  return rows;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--catalog')) await verifyFullStickerRefresh();
  else await verifyStickerRefresh();
}
