import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  fonts, makeLayer, LETTERFORM_PRESETS, applyLetterform, clearLetterform,
  bodyOnly, pixels, alphaDifference, hash, load, engine, flat, project,
} from '../scripts/verify-letterform-refresh.mjs';

const { parseProject, splitCommand } = load('project');
const ids = [
  'flourish-slanted', 'flourish-swash', 'flourish-royal', 'flourish-ribbon', 'flourish-vine',
  'gothic-spire', 'gothic-fraktur', 'gothic-diamond', 'gothic-textura', 'gothic-inscription',
];
const cases = [
  [0, '春暖花开'], [0, '杨桂'], [1, '月相明暗'], [1, '雷鸣八卦'],
  [2, '回田日'], [3, 'AbgOB8'], [4, 'AbgOB8'],
].map(([index, text]) => ({ font: fonts[index], text, input: makeLayer(fonts[index], text) }));
const metrics = { viewport: '1024x380, no crop or scale-to-fit', defaultBodies: [], strengths: [], editing: [], layouts: [] };
const geometry = ({ width, height, glyphs }) => ({ width, height, glyphs });
const digest = async url => createHash('sha256').update(await readFile(url)).digest('hex');
const protectedFiles = ['src/letterforms.ts', 'src/letterform-geometry.ts', 'tests/letterforms.test.mjs'];
const beforeHashes = Object.fromEntries(await Promise.all(protectedFiles.map(async name => [name, await digest(new URL(`../${name}`, import.meta.url))])));

function alphaMask(image) {
  const mask = Buffer.alloc(image.info.width * image.info.height);
  for (let i = 0; i < mask.length; i++) mask[i] = image.data[i * 4 + 3] > 96 ? 1 : 0;
  return mask;
}
function visibleAndUnclipped(image, label) {
  const mask = alphaMask(image), { width, height } = image.info;
  assert.ok(mask.reduce((sum, value) => sum + value, 0) > 1000, `${label}: visible ink`);
  for (let x = 0; x < width; x++) assert.equal(mask[x] + mask[(height - 1) * width + x], 0, `${label}: top/bottom clipping`);
  for (let y = 0; y < height; y++) assert.equal(mask[y * width] + mask[y * width + width - 1], 0, `${label}: left/right clipping`);
  return mask;
}
function centeredBody(layer) {
  const body = bodyOnly(layer), visible = body.glyphs.filter(g => g.commands.length);
  const left = Math.min(...visible.map(g => g.x)), top = Math.min(...visible.map(g => g.y));
  const right = Math.max(...visible.map(g => g.x + g.width)), bottom = Math.max(...visible.map(g => g.y + g.height));
  // Remove ornament-driven recentering, without resizing the outline or its viewport.
  return { ...body, x: 512, y: 190, width: right - left, height: bottom - top, glyphs: body.glyphs.map(g => ({ ...g, x: g.x - left, y: g.y - top })) };
}
function validateFinite(layer, label) {
  for (const g of layer.glyphs) {
    assert.ok([g.x, g.y, g.width, g.height].every(Number.isFinite), label);
    assert.ok(g.x >= -1e-7 && g.y >= -1e-7 && g.x + g.width <= layer.width + 1e-7 && g.y + g.height <= layer.height + 1e-7, `${label}: bounds`);
    for (const c of g.commands) for (const [key, value] of Object.entries(c)) if (key !== 'type') assert.ok(Number.isFinite(value), label);
  }
}

test('seven real-font rows: ten stable presets change the body and remain visibly distinct at the default strength', async () => {
  assert.deepEqual(LETTERFORM_PRESETS.map(p => p.id), ids);
  const violations = [];
  for (const { font, text, input } of cases) {
    const pristine = structuredClone(input), baseline = await pixels(centeredBody(input));
    const signatures = new Set([hash(visibleAndUnclipped(baseline, `${font.key}/${text}/source`))]);
    const images = [];
    for (const id of ids) {
      const output = applyLetterform(input, id), label = `${font.key}/${text}/${id}`;
      assert.equal(output.letterform.amount, 0.65, label);
      assert.deepEqual(output, applyLetterform(input, id, 0.65), label);
      assert.deepEqual(geometry(applyLetterform(input, id, 0)), geometry(input), `${label}: exact zero`);
      assert.deepEqual(clearLetterform(output), input, `${label}: exact restore`);
      assert.deepEqual(input, pristine, `${label}: source isolation`);
      assert.deepEqual(bodyOnly(output).glyphs.map(g => g.id), input.glyphs.map(g => g.id), label);
      validateFinite(output, label);
      const image = await pixels(centeredBody(output)), signature = hash(visibleAndUnclipped(image, label));
      const difference = alphaDifference(baseline, image);
      if (difference.changedFraction <= 0.01) violations.push(`${label}: body change <=1%`);
      if (signatures.has(signature)) violations.push(`${label}: duplicate source/preset alpha`);
      signatures.add(signature);
      metrics.defaultBodies.push({ font: font.key, text, id, ...difference });
      images.push({ id, image });
    }
    let closest = { changedFraction: Infinity };
    for (let i = 0; i < images.length; i++) for (let j = i + 1; j < images.length; j++) {
      const difference = alphaDifference(images[i].image, images[j].image);
      if (difference.changedFraction < closest.changedFraction) closest = { first: images[i].id, second: images[j].id, ...difference };
      if (difference.changedFraction <= 0.005) violations.push(`${font.key}/${text}: ${images[i].id}/${images[j].id} differ <=0.5%`);
    }
    console.log(`BODY ONLY ${font.key}/${text}: 10/10 different; closest pair ${(closest.changedFraction * 100).toFixed(2)}%`);
  }
  assert.deepEqual(violations, []);
});

test('balanced strength sweep uses every font and every preset at 0, .35, default .65, and 1', async () => {
  const examples = [cases[0], cases[2], cases[4], cases[5], cases[6]];
  for (let i = 0; i < examples.length; i++) for (const id of [ids[i], ids[i + 5]]) {
    const { font, text, input } = examples[i], signatures = new Set();
    for (const amount of [0, 0.35, 0.65, 1]) {
      const output = applyLetterform(input, id, amount), image = await pixels(centeredBody(output));
      validateFinite(output, `${font.key}/${id}/${amount}`);
      signatures.add(hash(visibleAndUnclipped(image, `${font.key}/${id}/${amount}`)));
      assert.deepEqual(clearLetterform(output), input);
      metrics.strengths.push({ font: font.key, text, id, amount });
    }
    assert.equal(signatures.size, 4, `${font.key}/${id}: all four body strengths differ`);
  }
});

test('real generated bodies and terminals stay editable, roundtrip exactly, and have independent paint', async () => {
  const colors = ['#a12b3c', '#287a40', '#325bad', '#823a9e', '#af661f', '#246e73'];
  for (const [index, id] of ids.entries()) {
    const font = fonts[index % fonts.length], input = makeLayer(font, font.chinese ? '回田日' : 'AbgOB8', { kind: 'path' });
    input.glyphs.forEach((g, i) => { g.paint = { fill: colors[i % colors.length], stroke: 'none', opacity: 1, silhouette: false }; });
    const pristine = structuredClone(input), output = applyLetterform(input, id);
    assert.deepEqual(input, pristine);
    assert.ok(output.glyphs.length > input.glyphs.length, `${id}: editable terminal glyphs`);
    const allPaints = [...input.glyphs, ...output.glyphs, ...output.letterform.sourceGlyphs].map(g => g.paint);
    assert.equal(new Set(allPaints).size, allPaints.length, `${id}: no shared paint`);
    for (const glyph of output.glyphs) {
      const original = input.glyphs.find(g => glyph.id === g.id || glyph.id.startsWith(`${g.id}:letterform:`));
      assert.ok(original, `${id}/${glyph.id}: original part`);
      assert.deepEqual(glyph.paint, original.paint);
    }
    const before = await pixels(output);
    for (const color of input.glyphs.map(g => g.paint.fill)) {
      const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      let count = 0;
      for (let p = 0; p < before.data.length; p += 4) if (before.data[p + 3] === 255 && rgb.every((v, c) => before.data[p + c] === v)) count++;
      assert.ok(count > 5, `${id}: visible part color ${color}`);
    }
    const edited = structuredClone(output);
    for (const glyph of [edited.glyphs.find(g => g.id === input.glyphs[0].id), edited.glyphs.find(g => !input.glyphs.some(source => source.id === g.id))]) {
      let selected = -1, longest = -1;
      for (let i = 1; i < glyph.commands.length; i++) {
        const c = glyph.commands[i], p = glyph.commands[i - 1];
        if (!['L', 'Q', 'C'].includes(c.type) || p.x === undefined) continue;
        const length = Math.hypot(c.x - p.x, c.y - p.y);
        if (length > longest) { longest = length; selected = i; }
      }
      assert.ok(selected >= 1, `${id}: selectable path segment`);
      const oldLength = glyph.commands.length;
      glyph.commands = splitCommand(glyph.commands, selected);
      assert.equal(glyph.commands.length, oldLength + 1, `${id}: split path node`);
      const point = glyph.commands[selected], previous = glyph.commands[selected - 1], next = glyph.commands[selected + 1];
      const dx = next.x - previous.x, dy = next.y - previous.y, length = Math.hypot(dx, dy) || 1;
      point.x -= dy / length * 12; point.y += dx / length * 12;
    }
    const saved = project(edited), parsed = parseProject(JSON.stringify(saved));
    assert.deepEqual(parsed, saved, `${id}: project roundtrip`);
    const after = await pixels(parsed.layers[0]), difference = alphaDifference(before, after);
    assert.ok(difference.different > 5, `${id}: edited nodes change actual render`);
    assert.deepEqual(clearLetterform(parsed.layers[0]), pristine, `${id}: restore after editing and reload`);
    edited.glyphs[0].paint.fill = '#ffffff';
    assert.deepEqual(edited.letterform.sourceGlyphs[0].paint, pristine.glyphs[0].paint);
    const restored = clearLetterform(output); restored.glyphs[0].paint.fill = '#000000';
    assert.deepEqual(output.letterform.sourceGlyphs, pristine.glyphs);
    assert.deepEqual(input, pristine);
    metrics.editing.push({ font: font.key, id, changedPixels: difference.different, glyphs: output.glyphs.length });
  }
});

test('actual multiline, vertical text, and glyph/layer rotations survive representative transforms and saved projects', async () => {
  const setups = [
    { font: fonts[1], text: '月相\n明暗', changes: { fontSize: 100 }, presets: [ids[0], ids[5]] },
    { font: fonts[0], text: '杨桂', changes: { rotation: 17, scaleX: 0.85, scaleY: 0.91 }, presets: [ids[2], ids[8]], rotateGlyphs: true },
    { font: fonts[2], text: '回田日', changes: { layout: 'vertical', fontSize: 100 }, presets: [ids[3], ids[7]] },
    { font: fonts[3], text: 'Abg\nOB8', changes: { fontSize: 100 }, presets: [ids[1], ids[6]] },
  ];
  for (const setup of setups) {
    const input = makeLayer(setup.font, setup.text, { ...setup.changes, x: 512, y: 384 });
    if (setup.rotateGlyphs) { input.glyphs[0].rotation = -28; input.glyphs.at(-1).rotation = 23; }
    if (setup.text.includes('\n')) {
      assert.equal(input.glyphs.length, setup.text.replace('\n', '').length);
      assert.ok(Math.max(...input.glyphs.map(g => g.y)) - Math.min(...input.glyphs.map(g => g.y)) > input.fontSize);
    }
    for (const id of setup.presets) {
      const result = applyLetterform(input, id), p = { ...project(result), height: 768 };
      validateFinite(result, `${setup.font.key}/${id}`);
      assert.deepEqual([result.x, result.y, result.rotation, result.scaleX, result.scaleY], [input.x, input.y, input.rotation, input.scaleX, input.scaleY]);
      assert.deepEqual(clearLetterform(result), input);
      const parsed = parseProject(JSON.stringify(p));
      assert.deepEqual(parsed, p);
      const image = await sharp(Buffer.from(engine.projectSvg(parsed, { crop: false, scale: 1 }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      visibleAndUnclipped(image, `${setup.font.key}/${id}/layout`);
      if (setup.font.chinese || setup.changes.layout === 'vertical' || setup.rotateGlyphs) assert.ok(!result.glyphs.some(g => g.id.includes(':join:')));
      metrics.layouts.push({ font: setup.font.key, text: setup.text, id, rotation: input.rotation, layout: input.layout });
    }
  }
});

test('font outlines carry nonzero semantics through body transforms and the renderer honors them', async () => {
  for (const { input, font, text } of cases) {
    assert.ok(input.glyphs.every(g => g.fillRule === 'nonzero'), `${font.key}/${text}: font source fill rule`);
    for (const id of ids) {
      const result = bodyOnly(applyLetterform(input, id));
      assert.ok(result.glyphs.every(g => g.fillRule === 'nonzero'), `${id}: body fill rule`);
      assert.deepEqual(parseProject(JSON.stringify(project(result))), project(result));
    }
  }
  const source = makeLayer(fonts[1], '月相明暗');
  for (const where of ['glyphs', 'sourceGlyphs']) {
    const invalid = project(applyLetterform(source, 'gothic-spire'));
    const glyphs = where === 'glyphs' ? invalid.layers[0].glyphs : invalid.layers[0].letterform.sourceGlyphs;
    glyphs[0].fillRule = 'invalid';
    assert.throws(() => parseProject(JSON.stringify(invalid)), /字形填充规则不正确/, `${where}: reject invalid fill rule`);
  }
  for (const [name, layer] of [['source', source], ['spire body', bodyOnly(applyLetterform(source, 'gothic-spire'))]]) {
    const svg = engine.projectSvg(project(layer), { crop: false, scale: 1 });
    const nonzero = svg.replaceAll('fill-rule="evenodd"', 'fill-rule="nonzero"').replaceAll('clip-rule="evenodd"', 'clip-rule="nonzero"');
    const evenodd = svg.replaceAll('fill-rule="nonzero"', 'fill-rule="evenodd"').replaceAll('clip-rule="nonzero"', 'clip-rule="evenodd"');
    const raster = async text => sharp(Buffer.from(text)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const actual = await raster(svg), expected = await raster(nonzero), diagnostic = await raster(evenodd);
    assert.deepEqual(actual.data, expected.data, `${name}: overlapping same-winding strokes stay filled`);
    assert.ok(alphaDifference(expected, diagnostic).different > 100, `${name}: fixture exercises genuine overlapping strokes`);
  }
});

test('same-winding contained strokes in real Noto Sans 相 thin instead of being expanded as counters', async () => {
  const input = makeLayer(fonts[1], '相');
  input.glyphs.forEach(g => { g.fillRule = 'nonzero'; });
  const source = centeredBody(input), result = centeredBody(applyLetterform(input, 'gothic-spire'));
  async function scanBars(layer) {
    const svg = engine.projectSvg(project(layer), { crop: false, scale: 1 }).replaceAll('fill-rule="evenodd"', 'fill-rule="nonzero"').replaceAll('clip-rule="evenodd"', 'clip-rule="nonzero"');
    const image = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const x = Math.round(layer.x + layer.width * 0.25), bars = [];
    let start = -1;
    for (let y = 0; y <= image.info.height; y++) {
      const ink = y < image.info.height && image.data[(y * image.info.width + x) * 4 + 3] > 96;
      if (ink && start < 0) start = y;
      if (!ink && start >= 0) { bars.push(y - start); start = -1; }
    }
    return bars;
  }
  const before = await scanBars(source), after = await scanBars(result);
  console.log(`Noto Sans 相 inner horizontal scan: source ${before.join('/')} px; spire ${after.join('/')} px.`);
  assert.equal(before.length, 4, 'real 目 component has four visible horizontal strokes');
  assert.equal(after.length, 4, 'all four visible horizontal strokes remain');
  for (let i = 1; i < before.length; i++) assert.ok(after[i] / result.height < before[i] / source.height * 0.8, `inner horizontal ${i} must become thinner, not be mistaken for a counter`);
  metrics.sameWindingStroke = { before, after };
});

after(async () => {
  metrics.sourceHashes = { before: beforeHashes, after: Object.fromEntries(await Promise.all(protectedFiles.map(async name => [name, await digest(new URL(`../${name}`, import.meta.url))]))) };
  await writeFile(new URL('../verification/letterform-refresh/independent/test-metrics.json', import.meta.url), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Independent coverage: ${metrics.defaultBodies.length} default bodies, ${metrics.strengths.length} strengths, ${metrics.editing.length} editable roundtrips, ${metrics.layouts.length} layout cases.`);
});
