import assert from 'node:assert/strict';
import test from 'node:test';
import { stickers, allStickers, legacyStickers, loadSource, geometrySignature, evaluateStickerCatalog, renderSticker, stickerLayer } from '../scripts/verify-sticker-catalog.mjs';

const coordinates = ['x', 'y', 'x1', 'y1', 'x2', 'y2'];
const fields = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] };

test('388 original vector presets form 97 structural families in 20 named categories', () => {
  assert.equal(stickers.length, 388);
  assert.equal(new Set(stickers.map(item => item.id)).size, 388);
  assert.equal(new Set(stickers.map(item => item.name)).size, 388);
  assert.equal(new Set(stickers.map(item => item.category)).size, 20);
  assert.equal(new Set(stickers.map(item => item.id.replace(/-[1-4]$/, ''))).size, 97);
  const objectReferences = new Set();
  const uniqueReference = object => { assert.ok(!objectReferences.has(object), 'Preset data must not share mutable objects'); objectReferences.add(object); };
  for (const sticker of stickers) {
    assert.match(sticker.id, /^deco-[a-z0-9-]+-[1-4]$/);
    assert.match(sticker.name, /[\u4e00-\u9fff]/);
    assert.ok(sticker.tags.length >= 4);
    assert.equal(new Set(sticker.tags).size, sticker.tags.length);
    assert.ok(sticker.width > 0 && sticker.height > 0);
    assert.ok(Math.abs(Math.max(sticker.width, sticker.height) - 132) < 0.001);
    assert.ok(sticker.glyphs.length > 0 && sticker.glyphs.length <= 40);
    uniqueReference(sticker.style); uniqueReference(sticker.tags); uniqueReference(sticker.glyphs);
    for (const glyph of sticker.glyphs) {
      uniqueReference(glyph); uniqueReference(glyph.commands);
      assert.equal(typeof glyph.char, 'string');
      assert.ok(glyph.char.length > 0, `${sticker.id} needs a named editable part`);
      assert.ok(glyph.paint, `${sticker.id} missing paint`);
      uniqueReference(glyph.paint);
      assert.match(glyph.paint.fill, /^(#[a-f0-9]{6}|primary|secondary|ink|paper|none)$/i);
      if (glyph.paint.stroke !== undefined) assert.match(glyph.paint.stroke, /^(#[a-f0-9]{6}|primary|secondary|ink|paper|none)$/i);
      if (glyph.paint.strokeWidth !== undefined) assert.ok(Number.isFinite(glyph.paint.strokeWidth) && glyph.paint.strokeWidth >= 0 && glyph.paint.strokeWidth <= 1000);
      if (glyph.paint.opacity !== undefined) assert.ok(Number.isFinite(glyph.paint.opacity) && glyph.paint.opacity >= 0 && glyph.paint.opacity <= 1);
      if (glyph.paint.silhouette !== undefined) assert.equal(typeof glyph.paint.silhouette, 'boolean');
      assert.ok(glyph.commands.length > 0);
      assert.equal(glyph.commands[0].type, 'M');
      assert.ok(glyph.x >= -0.0001 && glyph.y >= -0.0001);
      assert.ok(glyph.x + glyph.width <= sticker.width + 0.0002);
      assert.ok(glyph.y + glyph.height <= sticker.height + 0.0002);
      for (const command of glyph.commands) {
        uniqueReference(command);
        assert.ok(Object.hasOwn(fields, command.type));
        for (const key of fields[command.type]) assert.ok(Number.isFinite(command[key]), `${sticker.id} ${command.type}.${key}`);
        for (const key of coordinates) if (command[key] !== undefined) assert.ok(Number.isFinite(command[key]) && Math.abs(command[key]) < 500);
      }
    }
  }
  for (const category of new Set(stickers.map(item => item.category))) assert.ok([8, 20].includes(stickers.filter(item => item.category === category).length));
  assert.deepEqual(JSON.parse(JSON.stringify(stickers)), loadSource('catalog/stickers').EXTRA_STICKERS);
});

test('geometry signatures ignore color, translation, uniform scaling and reflected axes', () => {
  assert.equal(new Set(stickers.map(geometrySignature)).size, 388);
  const original = stickers[0];
  const scaled = structuredClone(original);
  scaled.style.fill = '#000000'; scaled.width *= 2; scaled.height *= 2;
  for (const glyph of scaled.glyphs) {
    glyph.x *= 2; glyph.y *= 2; glyph.width *= 2; glyph.height *= 2;
    for (const command of glyph.commands) for (const key of coordinates) if (command[key] !== undefined) command[key] *= 2;
  }
  assert.equal(geometrySignature(original), geometrySignature(scaled));
  const renamed = structuredClone(original);
  renamed.id = 'different-id'; renamed.name = 'Different name';
  for (const [index, glyph] of renamed.glyphs.entries()) { glyph.id = `different-${index}`; glyph.char = 'Different part'; glyph.paint = { fill: '#123456', stroke: '#abcdef' }; }
  assert.equal(geometrySignature(original), geometrySignature(renamed));
  const shifted = structuredClone(original);
  for (const glyph of shifted.glyphs) { glyph.x += 17; glyph.y -= 9; }
  assert.equal(geometrySignature(original), geometrySignature(shifted));
  for (const id of ['deco-starburst-1', 'deco-classic-bow-3', 'deco-rocket-4']) {
    const source = stickers.find(item => item.id === id), reflected = structuredClone(source);
    for (const glyph of reflected.glyphs) {
      glyph.x = reflected.width - glyph.x - glyph.width;
      for (const command of glyph.commands) for (const key of ['x', 'x1', 'x2']) if (command[key] !== undefined) command[key] = glyph.width - command[key];
    }
    assert.equal(geometrySignature(source), geometrySignature(reflected), id);
  }
});

test('legacy stickerGeometry retains empty character metadata and unpainted paths', () => {
  assert.equal(legacyStickers.length, 388);
  for (const sticker of legacyStickers) for (const glyph of sticker.glyphs) {
    assert.equal(glyph.char, '');
    assert.equal(glyph.paint, undefined);
  }
});

test('legacy named inset motifs contribute real visible pixels instead of hiding inside solid bodies', async () => {
  const fixtures = [
    ['deco-classic-bow-3', 2, 1], ['deco-classic-bow-3', 5, 1],
    ['deco-game-badge-3', 0, 3], ['deco-seal-stamp-1', 0, 3], ['deco-seal-stamp-2', 0, 3],
    ['deco-seal-stamp-3', 0, 3], ['deco-seal-stamp-4', 0, 3], ['deco-rocket-4', 2, 2],
    ['deco-pointer-arrow-3', 0, 1], ['deco-camera-3', 4, 1], ['deco-camera-3', 5, 0],
    ['deco-paint-tool-4', 0, 1], ['deco-record-2', 0, 5], ['deco-pudding-3', 0, 1],
  ];
  for (const [id, glyphIndex, keepContours] of fixtures) {
    const original = legacyStickers.find(item => item.id === id), reduced = structuredClone(original);
    const glyph = reduced.glyphs[glyphIndex];
    const starts = glyph.commands.flatMap((command, index) => command.type === 'M' ? [index] : []);
    assert.ok(starts.length > keepContours, `${id} glyph ${glyphIndex} needs a visible semantic inset`);
    glyph.commands = glyph.commands.slice(0, starts[keepContours]);
    const before = await renderSticker(original), after = await renderSticker(reduced);
    assert.notEqual(after.hash, before.hash, `${id} glyph ${glyphIndex} motif deletion must change pixels`);
  }
});

test('legacy stickers render nonempty with alpha, respond to node edits and retain distinct mirrored silhouettes', async () => {
  const rows = await evaluateStickerCatalog(legacyStickers, { uniqueSilhouettes: true });
  assert.equal(rows.length, 388);
  assert.equal(new Set(rows.map(row => row.geometry)).size, 388);
  assert.equal(new Set(rows.map(row => row.silhouette)).size, 388);
  assert.equal(new Set(rows.map(row => row.pixels)).size, 388);
  assert.ok(rows.every(row => row.borderAlpha === 0 && row.transparent > 300 && row.filled > 80));
  console.log(`legacy sticker catalog: ${rows.length} real renders / ${new Set(rows.map(row => row.category)).size} categories / 388 editable / 388 alpha / 388 unique silhouettes`);
});

test('all 400 current painted stickers have unique geometry and pixels, editable nodes and independent clones', async () => {
  assert.equal(allStickers.length, 400);
  assert.equal(new Set(allStickers.map(item => item.id)).size, 400);
  const { parseProject } = loadSource('project');
  for (const sticker of allStickers) {
    assert.ok(sticker.glyphs.every(glyph => glyph.paint && glyph.char.length > 0), sticker.id);
    const project = { version: 1, name: sticker.name, width: 200, height: 200, layers: [stickerLayer(sticker)] };
    assert.deepEqual(parseProject(JSON.stringify(project)), project, `${sticker.id} project roundtrip`);
  }
  const rows = await evaluateStickerCatalog(allStickers);
  assert.equal(rows.length, 400);
  assert.equal(new Set(rows.map(row => row.geometry)).size, 400);
  assert.equal(new Set(rows.map(row => row.pixels)).size, 400);
  assert.ok(rows.every(row => row.borderAlpha === 0 && row.transparent > 300 && row.filled > 80));
  assert.ok(rows.every(row => row.cloneIndependent && row.nodeEdit.changedPixels > 0));
  console.log(`current sticker catalog: ${rows.length} real renders / 400 unique geometries / 400 unique pixels / 400 editable / 400 independent clones / 400 alpha / ${new Set(rows.map(row => row.silhouette)).size} measured silhouettes`);
});
