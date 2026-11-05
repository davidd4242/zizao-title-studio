import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource, renderSticker } from '../scripts/verify-sticker-catalog.mjs';

const { STICKERS } = loadSource('presets');

test('moon-ring bat keeps the ring hollow and its face visibly editable', async () => {
  const original = STICKERS.find(item => item.id === 'deco-spooky-bat-2');
  assert.ok(original);
  const ring = original.glyphs.find(glyph => glyph.char === '主体4');
  assert.ok(ring, 'The moon ring remains an editable part');
  assert.equal(ring.commands.filter(command => command.type === 'M').length, 2, 'Ring must retain both outer and inner contours');
  const withoutFace = structuredClone(original);
  withoutFace.glyphs = withoutFace.glyphs.filter(glyph => !/^内色面3-/.test(glyph.char));
  assert.ok(withoutFace.glyphs.length < original.glyphs.length, 'The bat has independent facial marks');
  const before = await renderSticker(original);
  const after = await renderSticker(withoutFace);
  assert.notEqual(before.hash, after.hash, 'Facial marks must contribute visible pixels inside the ring');
  assert.equal(before.borderAlpha, 0);
});
