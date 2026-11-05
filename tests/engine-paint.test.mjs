import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { loadSource } from '../scripts/verify-sticker-catalog.mjs';

const cache = new Map();
const { projectSvg, contentBounds, cloneLayer } = loadSource('engine', cache);
const { BASE_LAYER, DEFAULT_STYLE } = loadSource('types', cache);
const { parseProject } = loadSource('project', cache);
const box = (x, y, w, h) => [{ type: 'M', x, y }, { type: 'L', x: x + w, y }, { type: 'L', x: x + w, y: y + h }, { type: 'L', x, y: y + h }, { type: 'Z' }];
const part = (id, commands, paint) => ({ id, char: '', x: 0, y: 0, width: 100, height: 100, commands, ...(paint ? { paint } : {}) });
const style = { ...DEFAULT_STYLE, fill: '#ffb4d0', fill2: '#ffe4a8', stroke: '#94618a', strokeWidth: 4, outerStroke: '#fffaf2', outerWidth: 6, depth: 3, depthColor: '#be78a8', shadowX: 0, shadowY: 0, shadowBlur: 0, gradient: false, gloss: false, texture: 'none' };
function layer() {
  return { ...BASE_LAYER, id: 'paint-fixture', name: '分色测试', kind: 'sticker', text: '', fontId: '', x: 100, y: 100, width: 100, height: 100, style: { ...style }, glyphs: [part('body', box(10, 10, 80, 80), { fill: 'primary', stroke: 'ink' }), part('lining', box(18, 60, 64, 22), { fill: 'secondary', strokeWidth: 0, silhouette: false }), part('shine', box(20, 20, 20, 8), { fill: 'paper', strokeWidth: 0, silhouette: false }), part('eye', box(60, 40, 6, 10), { fill: 'ink', strokeWidth: 0, silhouette: false })] };
}
const project = l => ({ version: 1, name: '彩色贴纸', width: 200, height: 200, layers: [l] });
async function render(l) {
  return sharp(Buffer.from(projectSvg(project(l)))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
const pixel = (image, x, y) => [...image.data.subarray((y * image.info.width + x) * 4, (y * image.info.width + x) * 4 + 4)];

test('painted parts keep independent solid colors, a single backplate and global recoloring', async () => {
  const l = layer(), image = await render(l);
  assert.deepEqual(pixel(image, 100, 95), [255, 180, 208, 255]);
  assert.deepEqual(pixel(image, 100, 120), [255, 228, 168, 255]);
  assert.deepEqual(pixel(image, 112, 95), [148, 97, 138, 255]);
  assert.deepEqual(pixel(image, 75, 73), [255, 250, 242, 255]);
  assert.deepEqual(pixel(image, 55, 100), [255, 250, 242, 255]);
  assert.equal(pixel(image, 0, 0)[3], 0);
  const recolored = await render({ ...l, style: { ...l.style, fill: '#63d8cf', fill2: '#cbb5fa' } });
  assert.deepEqual(pixel(recolored, 100, 95), [99, 216, 207, 255]);
  assert.deepEqual(pixel(recolored, 100, 120), [203, 181, 250, 255]);
  assert.deepEqual(pixel(recolored, 112, 95), pixel(image, 112, 95));
});

test('silhouette false details avoid backplate and extrusion but remain inside crop bounds', async () => {
  const l = layer();
  l.glyphs.push(part('free-detail', box(110, 30, 10, 10), { fill: '#62b9d2', stroke: '#428da7', strokeWidth: 14, silhouette: false }));
  const image = await render(l);
  assert.equal(pixel(image, 180, 85)[3], 0);
  assert.deepEqual(pixel(image, 165, 85), [98, 185, 210, 255]);
  assert.equal(pixel(image, 178, 92)[3], 0);
  const bounds = contentBounds(project(l));
  assert.ok(bounds.x + bounds.width > 177);
  const cropped = await sharp(Buffer.from(projectSvg(project(l), { crop: true, padding: 0 }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < cropped.info.height; y++) for (let x = 0; x < cropped.info.width; x++) {
    if (x === 0 || y === 0 || x === cropped.info.width - 1 || y === cropped.info.height - 1) assert.equal(pixel(cropped, x, y)[3], 0);
  }
});

test('painted opacity is multiplied once, compound holes stay holes and invisible layers stay absent', async () => {
  const l = layer();
  l.style.opacity = 0.5;
  const image = await render(l);
  for (const [x, y] of [[100, 95], [100, 120], [112, 95], [75, 73]]) assert.ok(Math.abs(pixel(image, x, y)[3] - 128) <= 1);
  const ring = { ...l, glyphs: [part('ring', [...box(10, 10, 80, 80), ...box(35, 35, 30, 30)], { fill: 'primary', stroke: 'ink' })] };
  assert.equal(pixel(await render(ring), 100, 100)[3], 0);
  assert.doesNotMatch(projectSvg(project({ ...l, visible: false })), /data-layer-id/);
});

test('stroke-only silhouette parts keep open contours open through backplate and depth', async () => {
  const l = layer();
  l.glyphs = [part('open-chevron', [{ type: 'M', x: 10, y: 10 }, { type: 'L', x: 90, y: 50 }, { type: 'L', x: 10, y: 90 }], { fill: 'none', stroke: 'ink', strokeWidth: 7 })];
  const image = await render(l);
  assert.equal(pixel(image, 75, 100)[3], 0);
  assert.equal(pixel(image, 100, 80)[3], 255);
});

test('paint is validated, serialized, cloned and remains attached to editable nodes', async () => {
  const l = layer(), copy = cloneLayer(l);
  const reopened = parseProject(JSON.stringify(project(l)));
  assert.equal(projectSvg(reopened), projectSvg(project(l)));
  copy.glyphs[0].paint.fill = '#000000';
  assert.equal(l.glyphs[0].paint.fill, 'primary');
  const before = (await render(l)).data;
  l.glyphs[0].commands[1].x += 13;
  assert.notDeepEqual((await render(l)).data, before);
  assert.equal(l.glyphs[0].paint.fill, 'primary');
  for (const paint of [null, [], { fill: 'url(#bad)' }, { fill: 'primary', stroke: '#fff' }, { fill: 'primary', opacity: 2 }, { fill: 'primary', strokeWidth: -1 }, { fill: 'primary', strokeWidth: Infinity }, { fill: 'primary', silhouette: 1 }]) {
    const bad = layer(); bad.glyphs[0].paint = paint;
    assert.throws(() => parseProject(JSON.stringify(project(bad))), /分色/);
  }
  const old = layer(); old.glyphs.forEach(glyph => delete glyph.paint);
  assert.equal(projectSvg(project(old)), projectSvg(parseProject(JSON.stringify(project(old)))));
  assert.doesNotMatch(projectSvg(project(old)), /paint-silhouette|data-part-id/);
});
