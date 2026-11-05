import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPsdElements, assertPsdElements } from '../scripts/verify-psd-elements.mjs';

let pending;
const result = () => pending ??= verifyPsdElements();
test('PSD elements counts include hidden glyphs', { timeout: 120000 }, async () => {
  assert.equal((await result()).estimate.layerCount, 3, 'actual leaf count including hidden glyphs');
});
test('PSD elements source groups and character names retain paint order', async () => {
  const { tree } = await result();
  assert.deepEqual(tree.map(g => g.name), ['标题', '隐藏'], 'bottom-to-top source groups');
  assert.deepEqual(tree[0].children?.map(l => l.name), ['字 · 1', '造 · 2'], 'character names and order');
  assert.deepEqual(tree[1].children?.map(l => l.name), ['藏 · 1'], 'hidden leaf name');
  assert.equal(tree[0].locked, true);
  assert.equal(tree[1].hidden, true);
  assert.equal(tree[1].children[0].locked, true);
});
test('PSD elements bounds follow individual content instead of parent rectangles', async () => {
  const { tree } = await result();
  assert.ok(tree[0].children, 'source layer must be a group');
  assert.equal(tree[0].children[0].right - tree[0].children[0].left, 43, 'actual glyph bounds plus guards');
  assert.equal(tree[0].children[1].right - tree[0].children[1].left, 38, 'second glyph bounds');
});
test('PSD elements strict standalone pixels, group composite, overlap evidence, guards and real UI', async () => {
  const checked = await result();
  assertPsdElements(checked);
  console.log(`Strict element references: ${checked.cases.length} cases, ${checked.cases.reduce((sum, item) => sum + item.leaves.length, 0)} leaves; alpha 0, premultiplied RGB 0; original PSD bytes exact`);
});
