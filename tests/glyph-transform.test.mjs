import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  modules.set(name, module.exports);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: `${name}.ts` })(specifier => specifier.startsWith('.') ? load(posix.normalize(posix.join(posix.dirname(name), specifier))) : require(specifier), module, module.exports);
  return module.exports;
}
const engine = load('engine');
const transform = load('glyph-transform');
const { parseProject } = load('project');
const { BASE_LAYER, DEFAULT_STYLE } = load('types');

const flat = { ...DEFAULT_STYLE, fill: '#f04070', gradient: false, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false };
const rectangle = (x, y, width, height) => [{ type: 'M', x, y }, { type: 'L', x: x + width, y }, { type: 'L', x: x + width, y: y + height }, { type: 'L', x, y: y + height }, { type: 'Z' }];
function glyph(changes = {}) {
  return { id: 'glyph', char: 'O', x: 0, y: 0, width: 100, height: 100, commands: rectangle(0, 0, 100, 100), ...changes };
}
function layer(changes = {}, glyphChanges = {}) {
  return { ...BASE_LAYER, id: 'test', name: 'Test', kind: 'path', text: '', fontId: '', x: 60, y: 60, width: 100, height: 100, style: { ...flat }, glyphs: [glyph(glyphChanges)], ...changes };
}
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}${actual} != ${expected}`);

test('a glyph scale grows the outline around its own centre, leaving the unrotated box centred', () => {
  const plain = layer();
  const grown = layer({}, { scaleX: 2, scaleY: 2 });
  const bounds = engine.layerGeometryBounds(grown);
  near(bounds.width, 200, 'width ');
  near(bounds.height, 200, 'height ');
  // centre of the glyph box (50,50) plus its own offset stays put
  near(bounds.x, -50, 'x ');
  near(bounds.y, -50, 'y ');
  assert.equal(engine.layerGeometryBounds(plain).width, 100);
});

test('a glyph without explicit scale serializes byte-identically to scale 1', () => {
  assert.equal(engine.layerSvg(layer({}, { scaleX: 1, scaleY: 1 })), engine.layerSvg(layer()));
});

test('dragging a corner keeps the opposite corner fixed, rotated glyphs included', () => {
  const base = glyph();
  const next = transform.resizeGlyph(base, 2, { x: 200, y: 200 });
  near(next.scaleX, 2, 'scaleX ');
  near(next.scaleY, 2, 'scaleY ');
  const anchor = transform.glyphCorners(base)[0];
  const after = transform.glyphCorners({ ...base, scaleX: next.scaleX, scaleY: next.scaleY, x: next.x, y: next.y })[0];
  near(after.x, anchor.x, 'anchor x ');
  near(after.y, anchor.y, 'anchor y ');

  const turned = glyph({ rotation: 90, x: 30, y: 40 });
  const corners = transform.glyphCorners(turned);
  const anchorTurned = corners[0];
  const stretched = { x: anchorTurned.x + (corners[2].x - anchorTurned.x) * 1.5, y: anchorTurned.y + (corners[2].y - anchorTurned.y) * 1.5 };
  const fixed = transform.resizeGlyph(turned, 2, stretched);
  const stillThere = transform.glyphCorners({ ...turned, scaleX: fixed.scaleX, scaleY: fixed.scaleY, x: fixed.x, y: fixed.y })[0];
  near(stillThere.x, anchorTurned.x, 'rotated anchor x ');
  near(stillThere.y, anchorTurned.y, 'rotated anchor y ');
  near(fixed.scaleX, 1.5, 'rotated scaleX ');
  near(fixed.scaleY, 1.5, 'rotated scaleY ');
});

test('shift locks the two axes together and scale stays inside the supported range', () => {
  const base = glyph();
  const uniform = transform.resizeGlyph(base, 2, { x: 200, y: 150 }, true);
  near(uniform.scaleX, uniform.scaleY, 'uniform ');
  near(uniform.scaleX, 2, 'uniform value ');
  const clamped = transform.resizeGlyph(base, 2, { x: 1e6, y: 1e6 });
  near(clamped.scaleX, transform.MAX_GLYPH_SCALE, 'clamp x ');
  near(clamped.scaleY, transform.MAX_GLYPH_SCALE, 'clamp y ');
  const collapsed = transform.resizeGlyph(base, 2, { x: 0, y: 0 });
  near(collapsed.scaleX, transform.MIN_GLYPH_SCALE, 'min x ');
  near(collapsed.scaleY, transform.MIN_GLYPH_SCALE, 'min y ');
});

test('rotating applies a delta from the grab point, snaps to 15 degrees and stays in range', () => {
  const base = glyph({ x: 0, y: 0, width: 100, height: 100 });
  const center = { x: 50, y: 50 };
  const start = { x: 50, y: -30 };
  const right = { x: 130, y: 50 };
  near(transform.rotateGlyph(base, start, right), 90, 'quarter turn ');
  near(transform.rotateGlyph(base, start, { x: 130, y: 40 }, true), 90, 'snapped ');
  near(transform.rotateGlyph(base, start, { x: 55, y: -25 }, true), 0, 'snap to zero ');
  const wrapped = transform.rotateGlyph(base, center, { x: -50, y: 50 });
  assert.ok(wrapped <= 180 && wrapped > -180, `wrapped ${wrapped}`);
  assert.equal(transform.rotateGlyph(base, start, start), 0);
});

test('glyph scale survives the strict project parser and invalid values are rejected', () => {
  const project = { version: 1, name: 'p', width: 240, height: 240, layers: [layer({}, { scaleX: 1.5, scaleY: 0.75 })] };
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.layers[0].glyphs[0].scaleX, 1.5);
  assert.equal(parsed.layers[0].glyphs[0].scaleY, 0.75);
  const legacy = parseProject(JSON.stringify({ ...project, layers: [layer()] }));
  assert.equal(legacy.layers[0].glyphs[0].scaleX, undefined);
  for (const bad of [{ scaleX: 0 }, { scaleY: -1 }, { scaleX: 21 }, { scaleX: '2' }, { scaleY: true }]) {
    const broken = JSON.parse(JSON.stringify({ ...project, layers: [layer({}, bad)] }));
    assert.throws(() => parseProject(JSON.stringify(broken)), /字形缩放不正确/, JSON.stringify(bad));
  }
});

test('a scaled glyph really changes rendered pixels and covers the expected area', async () => {
  const render = async (glyphChanges) => {
    const fragment = engine.layerSvg(layer({ x: 200, y: 200 }, glyphChanges));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">${fragment}</svg>`;
    return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const plain = await render({});
  const grown = await render({ scaleX: 1.6, scaleY: 1.6 });
  const area = (image) => {
    let count = 0;
    for (let i = 3; i < image.data.length; i += image.info.channels) if (image.data[i] > 8) count += 1;
    return count;
  };
  const small = area(plain), big = area(grown);
  assert.ok(big > small * 2.2 && big < small * 3.1, `area ${small} -> ${big}`);
  assert.ok(small > 9000 && small < 11000, `unscaled area ${small}`);
  let changed = 0;
  assert.equal(plain.data.length, grown.data.length);
  for (let i = 0; i < plain.data.length; i += plain.info.channels) {
    if (Math.abs(plain.data[i] - grown.data[i]) > 4 || Math.abs(plain.data[i + 3] - grown.data[i + 3]) > 4) changed += 1;
  }
  assert.ok(changed > 500, `changed pixels ${changed}`);
});
