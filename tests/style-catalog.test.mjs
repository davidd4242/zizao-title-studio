import assert from 'node:assert/strict';
import test from 'node:test';
import { presets, loadSource, renderPreset, evaluateStyleCatalog } from '../scripts/verify-style-catalog.mjs';

const color = /^#[0-9a-f]{6}$/i;
const numeric = ['gradientAngle', 'strokeWidth', 'outerWidth', 'shadowX', 'shadowY', 'shadowBlur', 'depth', 'textureOpacity', 'materialStrength', 'opacity'];
const structural = ['gradient', 'gradientType', 'gradientAngle', 'strokeWidth', 'outerWidth', 'depth', 'shadowX', 'shadowY', 'shadowBlur', 'texture', 'textureOpacity', 'material', 'materialStrength', 'gloss'];

test('190 named styles cover nineteen categories with valid independent deterministic data', () => {
  assert.equal(presets.length, 190);
  assert.equal(new Set(presets.map(item => item.id)).size, 190);
  assert.equal(new Set(presets.map(item => item.name)).size, 190);
  assert.equal(new Set(presets.map(item => JSON.stringify(item.style))).size, 190);
  const categories = [...new Set(presets.map(item => item.category))];
  assert.equal(categories.length, 19);
  const stopObjects = new Set();
  for (const preset of presets) {
    assert.match(preset.id, /^style-[a-z0-9-]+$/);
    assert.match(preset.name, /[\u4e00-\u9fff]/);
    assert.ok(preset.description.length > 12);
    assert.ok(preset.tags.length >= 4);
    assert.equal(new Set(preset.tags).size, preset.tags.length);
    const style = preset.style;
    for (const key of numeric) assert.ok(Number.isFinite(style[key]), `${preset.id}.${key}`);
    for (const key of ['fill', 'fill2', 'stroke', 'outerStroke', 'shadowColor', 'depthColor', 'textureColor']) assert.match(style[key], color, `${preset.id}.${key}`);
    for (const key of ['strokeWidth', 'outerWidth', 'shadowBlur', 'depth']) assert.ok(style[key] >= 0 && style[key] <= 24, `${preset.id}.${key} range`);
    for (const key of ['textureOpacity', 'materialStrength', 'opacity']) assert.ok(style[key] >= 0 && style[key] <= 1, `${preset.id}.${key} range`);
    assert.ok(['none', 'metal', 'glass', 'jelly', 'paper', 'neon'].includes(style.material));
    assert.ok(['none', 'dots', 'stripes'].includes(style.texture));
    assert.ok(['linear', 'radial'].includes(style.gradientType));
    for (const key of ['gradient', 'gloss']) assert.equal(typeof style[key], 'boolean');
    assert.equal(style.opacity, 1);
    assert.ok(style.gradientStops.length >= 3 && style.gradientStops.length <= 6);
    let previous = -1;
    for (const stop of style.gradientStops) {
      assert.ok(Number.isFinite(stop.offset) && stop.offset >= previous && stop.offset >= 0 && stop.offset <= 1);
      assert.match(stop.color, color);
      assert.ok(!stopObjects.has(stop), `${preset.id} shares mutable stop objects`);
      stopObjects.add(stop);
      previous = stop.offset;
    }
    assert.equal(style.gradientStops[0].offset, 0);
    assert.equal(style.gradientStops.at(-1).offset, 1);
  }
  for (const category of categories) {
    const group = presets.filter(item => item.category === category);
    assert.equal(group.length, 10, category);
    const silhouettes = new Set(group.map(item => JSON.stringify(structural.map(key => item.style[key]))));
    assert.ok(silhouettes.size >= 7, `${category} needs structural variety, got ${silhouettes.size}`);
  }
  assert.deepEqual(loadSource('catalog/styles').EXTRA_STYLE_PRESETS, presets);
});

test('every style renders real Chinese curves with transparent unclipped pixels and unique appearance', async () => {
  const results = await evaluateStyleCatalog();
  for (const item of results) {
    assert.ok(item.width > 100 && item.height > 50, item.preset.id);
    assert.ok(item.filled > 3000, `${item.preset.id}: nonempty glyphs`);
    assert.ok(item.transparent > 1000, `${item.preset.id}: transparent background`);
    assert.ok(item.antialiased > 100, `${item.preset.id}: antialiased edges`);
    assert.equal(item.borderAlpha, 0, `${item.preset.id}: crop clipping`);
  }
  assert.equal(new Set(results.map(item => item.hash)).size, 190, 'all rendered styles are unique');
  console.log(`Style catalog: ${results.length}/190 real Chinese renders; 190 unique pixel hashes; transparent borders preserved`);
});

test('material sample pixels are stable across repeated renders', async () => {
  for (const material of ['none', 'metal', 'glass', 'jelly', 'paper', 'neon']) {
    const preset = presets.find(item => item.style.material === material);
    const first = await renderPreset(preset);
    const second = await renderPreset(preset);
    assert.equal(first.hash, second.hash, material);
  }
});
