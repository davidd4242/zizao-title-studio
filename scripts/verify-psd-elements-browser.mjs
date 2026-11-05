import * as engine from '/src/engine.ts';
import { exportPsd, estimatePsdSize } from '/src/psd.ts';
import { BASE_LAYER, DEFAULT_STYLE } from '/src/types.ts';
import { exportPsd as legacyExportPsd } from '/verification/psd-1.4/psd-legacy.ts';

const flat = { ...DEFAULT_STYLE, gradient: false, fill: '#f05c82', fill2: '#5c85f0', strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false, material: 'none', opacity: 1 };
const opts = { scale: 1, crop: false, padding: 0, psdMode: 'elements' };
const rect = (x, y, w, h) => [{ type: 'M', x, y }, { type: 'L', x: x + w, y }, { type: 'L', x: x + w, y: y + h }, { type: 'L', x, y: y + h }, { type: 'Z' }];
const glyph = (id, char, x, y, width = 48, height = 50, hole = false) => ({ id, char, x, y, width, height, fillRule: 'evenodd', commands: [...rect(0, 0, width, height), ...(hole ? rect(width / 3, height / 3, width / 3, height / 3) : [])] });
const layer = (id, glyphs, changes = {}) => ({ ...BASE_LAYER, id, name: id, kind: 'text', text: glyphs.map(g => g.char).join(''), fontId: '', x: 120, y: 100, width: 150, height: 80, glyphs, style: { ...flat }, ...changes });
const project = (layers, changes = {}) => ({ version: 1, name: 'PSD 逐元素验证', width: 300, height: 240, layers, ...changes });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height);
const fromData = data => { const c = canvas(data.width, data.height); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0); return c; };
const dataUrl = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
const rootOf = source => new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
function sameFrame(body, frame) { const root = frame.cloneNode(false), inner = rootOf(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`); for (const node of Array.from(inner.childNodes)) root.appendChild(node); return new XMLSerializer().serializeToString(root); }
async function render(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try { const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; }); const c = canvas(image.naturalWidth, image.naturalHeight); c.getContext('2d').drawImage(image, 0, 0); return c; }
  finally { URL.revokeObjectURL(url); }
}
function compare(a, b) {
  let maxAlpha = 0, maxPremultiplied = 0, differentPixels = 0;
  if (a.length !== b.length) throw new Error(`Pixel length mismatch: ${a.length} / ${b.length}`);
  for (let i = 0; i < a.length; i += 4) {
    const da = Math.abs(a[i + 3] - b[i + 3]); maxAlpha = Math.max(maxAlpha, da); let changed = da !== 0;
    for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] * a[i + 3] / 255 - b[i + k] * b[i + 3] / 255); maxPremultiplied = Math.max(maxPremultiplied, d); changed ||= d !== 0; }
    if (changed) differentPixels++;
  }
  return { maxAlpha, maxPremultiplied, differentPixels };
}
const meta = item => ({ name: item.name, hidden: !!item.hidden, locked: !!item.protected?.all, opacity: item.opacity, blendMode: item.blendMode, left: item.left, top: item.top, right: item.right, bottom: item.bottom, ...(item.children ? { children: item.children.map(meta) } : {}) });
function compose(children, width, height) {
  const c = canvas(width, height), context = c.getContext('2d');
  for (const child of children) {
    if (child.hidden) continue;
    context.globalAlpha = child.opacity ?? 1;
    if (child.children) context.drawImage(compose(child.children, width, height), 0, 0);
    else if (child.imageData) context.drawImage(fromData(child.imageData), child.left, child.top);
  }
  return c;
}
function regionFor(p, l, indices, frame) {
  const subset = l.kind === 'image' ? l : { ...l, glyphs: indices.map(index => l.glyphs[index]), style: { ...l.style, opacity: 1 } };
  const b = engine.contentBounds({ ...p, layers: [{ ...subset, visible: true }] });
  if (!b.width || !b.height) return { left: 0, top: 0, right: 0, bottom: 0 };
  const [x, y, vw, vh] = frame.getAttribute('viewBox').split(/\s+/).map(Number), width = +frame.getAttribute('width'), height = +frame.getAttribute('height');
  const scale = Math.min(width / vw, height / vh), ox = (width - vw * scale) / 2, oy = (height - vh * scale) / 2;
  const clampX = value => Math.max(0, Math.min(width, value)), clampY = value => Math.max(0, Math.min(height, value));
  const region = { left: clampX(Math.floor((b.x - x) * scale + ox) - 2), top: clampY(Math.floor((b.y - y) * scale + oy) - 2), right: clampX(Math.ceil((b.x + b.width - x) * scale + ox) + 2), bottom: clampY(Math.ceil((b.y + b.height - y) * scale + oy) + 2) };
  // An empty leaf has empty channels; ag-psd preserves its origin and stores zero width and height.
  if (region.left === region.right || region.top === region.bottom) { region.right = region.left; region.bottom = region.top; }
  return region;
}
async function runCase(id, p, options = opts, selections, artifacts = false) {
  const before = JSON.stringify(p), source = engine.projectSvg(p, options), frame = rootOf(source);
  const legacy = await render(source), reference = canvas(legacy.width, legacy.height), referenceContext = reference.getContext('2d');
  const started = performance.now(), blob = await exportPsd(p, options), durationMs = performance.now() - started;
  const buffer = await blob.arrayBuffer(), decoded = window.agPsd.readPsd(buffer, { useImageData: true, skipThumbnail: true });
  const leaves = [], expectedTree = [];
  for (const [sourceIndex, l] of p.layers.entries()) {
    const selected = selections?.[sourceIndex] ?? (l.kind === 'image' ? [[]] : l.glyphs.map((_, index) => [index]));
    const group = canvas(decoded.width, decoded.height), groupContext = group.getContext('2d');
    const actualGroup = decoded.children[sourceIndex], actualLeaves = l.kind === 'image' ? [actualGroup] : actualGroup?.children ?? [];
    const expectedLeaves = [];
    for (const [index, indices] of selected.entries()) {
      const parent = { ...l, visible: true, ...(l.kind === 'image' ? {} : { style: { ...l.style, opacity: 1 } }) };
      const body = engine.layerSubsetSvg(parent, indices, options.scale);
      // Full viewport rendering is independent of the exporter's bbox canvas implementation.
      const expected = await render(sameFrame(body, frame));
      groupContext.drawImage(expected, 0, 0);
      const actual = actualLeaves[index], placed = canvas(decoded.width, decoded.height);
      if (actual?.imageData) placed.getContext('2d').drawImage(fromData(actual.imageData), actual.left, actual.top);
      const bounds = regionFor(p, l, indices, frame);
      const first = l.glyphs[indices[0]], label = first?.char.trim() || (first?.char ? '空白' : l.kind === 'sticker' ? '部件' : '路径');
      const expectedName = l.kind === 'image' ? l.name : `${label} · ${index + 1}`;
      expectedLeaves.push({ name: expectedName, ...bounds, opacity: 1, hidden: l.kind === 'image' ? !l.visible : false, locked: l.locked, blendMode: 'normal' });
      leaves.push({ source: l.name, name: actual?.name, expectedName, glyphIndices: indices, actual: actual ? meta(actual) : null, expectedBounds: bounds, difference: compare(pixels(placed).data, pixels(expected).data), nonzeroAlpha: pixels(expected).data.filter((value, i) => i % 4 === 3 && value > 0).length });
    }
    const opacity = l.kind === 'image' ? 1 : Math.round(Math.min(1, Math.max(0, Number.isFinite(l.style.opacity) ? l.style.opacity : 1)) * 255) / 255;
    if (l.visible) { referenceContext.globalAlpha = opacity; referenceContext.drawImage(group, 0, 0); }
    expectedTree.push(l.kind === 'image' ? expectedLeaves[0] : { name: l.name, hidden: !l.visible, locked: l.locked, opacity, blendMode: 'normal', children: expectedLeaves });
  }
  const reconstructed = compose(decoded.children, decoded.width, decoded.height);
  const referencePixels = pixels(reference).data, reconstructedPixels = pixels(reconstructed).data, legacyPixels = pixels(legacy).data;
  const layersBlob = await exportPsd(p, { ...options, psdMode: 'layers' });
  const layersMode = window.agPsd.readPsd(await layersBlob.arrayBuffer(), { useImageData: true, skipThumbnail: true });
  const elementsVsLayersMerged = compare(reconstructedPixels, layersMode.imageData.data);
  const mergedModesDifference = compare(decoded.imageData.data, layersMode.imageData.data);
  const estimate = estimatePsdSize(p, options), leafPixels = leaves.map(item => (item.expectedBounds.right - item.expectedBounds.left) * (item.expectedBounds.bottom - item.expectedBounds.top));
  const groups = p.layers.filter(l => l.kind !== 'image').length;
  const independentlyEstimatedBytes = decoded.width * decoded.height * 40 + leafPixels.reduce((sum, size) => sum + size, 0) * 20 + Math.max(0, ...leafPixels) * 16 + source.length * 2 + (leaves.length + groups * 2) * 4096 + 8 * 1024 * 1024;
  const result = { id, width: decoded.width, height: decoded.height, durationMs, byteLength: buffer.byteLength, estimate, independentlyEstimatedBytes, tree: decoded.children.map(meta), expectedTree, leaves, elementsVsLayersMerged, mergedModesDifference, independentElementsVsLayersMerged: compare(referencePixels, layersMode.imageData.data), unchanged: before === JSON.stringify(p), composite: compare(decoded.imageData.data, referencePixels), reconstructed: compare(reconstructedPixels, referencePixels), legacyDifference: compare(reconstructedPixels, legacyPixels), independentLegacyDifference: compare(referencePixels, legacyPixels) };
  if (artifacts) result.files = { psd: await dataUrl(blob), reference: reference.toDataURL(), legacy: legacy.toDataURL(), merged: fromData(decoded.imageData).toDataURL(), recomposed: reconstructed.toDataURL(), project: p };
  return result;
}

export async function probeDisjoint() {
  const variants = [
    ['flat', {}], ['gradient', { gradient: true }], ['shadow', { shadowBlur: 2, shadowX: 5, shadowY: 8 }],
    ['depth', { depth: 7 }], ['stroke', { outerWidth: 3, strokeWidth: 2 }],
    ['gradient-shadow', { gradient: true, shadowBlur: 2, shadowX: 5, shadowY: 8 }],
    ['gradient-depth-stroke', { gradient: true, depth: 7, outerWidth: 3, strokeWidth: 2 }],
    ['all', { gradient: true, shadowBlur: 2, shadowX: 5, shadowY: 8, depth: 7, outerWidth: 3, strokeWidth: 2 }],
  ];
  const results = [];
  for (const [id, style] of variants) {
    const l = layer('无重叠', [glyph('d1', '分', 0, 0, 45, 50), glyph('d2', '离', 185, 20, 40, 45)], { x: 180, y: 135, width: 250, height: 100, style: { ...flat, ...style } });
    const p = project([l], { width: 420, height: 300 }), source = engine.projectSvg(p, opts), frame = rootOf(source), whole = await render(source);
    const expected = canvas(420, 300), parentFilters = canvas(420, 300);
    for (let index = 0; index < 2; index++) {
      const body = engine.layerSubsetSvg(l, [index], 1);
      expected.getContext('2d').drawImage(await render(sameFrame(body, frame)), 0, 0);
      const sub = rootOf(sameFrame(body, frame));
      for (const filter of sub.querySelectorAll('filter')) {
        const original = [...frame.querySelectorAll('filter')].find(item => item.id === filter.id);
        if (original) filter.replaceWith(original.cloneNode(true));
      }
      parentFilters.getContext('2d').drawImage(await render(new XMLSerializer().serializeToString(sub)), 0, 0);
    }
    results.push({ id, legacy: compare(pixels(whole).data, pixels(expected).data), parentFilters: compare(pixels(whole).data, pixels(parentFilters).data) });
  }
  return results;
}

export async function runElementChecks({ reproOnly = false, artifacts = false } = {}) {
  const overlap = [];
  for (const [id, changes] of [['flat', {}], ['shadow', { shadowX: 12, shadowY: 9, shadowBlur: 3 }], ['depth', { depth: 12 }], ['opacity-naive', { opacity: 0.5 }], ['material', { material: 'jelly', materialStrength: 0.8 }]]) {
    const l = layer('overlap', [glyph('A', 'A', 0, 0, 70, 70), glyph('B', 'B', 48, -20, 70, 70)], { width: 118, height: 90, style: { ...flat, ...changes } });
    const p = project([l]), combined = await render(engine.projectSvg(p, opts)), separate = canvas(300, 240);
    for (let i = 0; i < 2; i++) separate.getContext('2d').drawImage(await render(sameFrame(engine.layerSubsetSvg(l, [i], 1), rootOf(engine.projectSvg(p, opts)))), 0, 0);
    overlap.push({ id, ...compare(pixels(combined).data, pixels(separate).data), parentFrameAPI: true, ...(artifacts ? { combined: combined.toDataURL(), separated: separate.toDataURL() } : {}) });
  }
  if (reproOnly) return { overlap };
  const a = glyph('a', '字', 0, 0, 35, 45, true), b = glyph('b', '造', 100, 35, 30, 40);
  const p = project([layer('标题', [a, b], { locked: true }), layer('隐藏', [glyph('h', '藏', 20, 0)], { visible: false, locked: true })]);
  const cases = [await runCase('metadata', p)];
  const noOverlap = layer('无重叠', [glyph('d1', '分', 0, 0, 45, 50), glyph('d2', '离', 185, 20, 40, 45)], { x: 180, y: 135, width: 250, height: 100, style: { ...flat, shadowBlur: 2, shadowX: 5, shadowY: 8, depth: 7, outerWidth: 3, strokeWidth: 2, gradient: true } });
  const disjointProject = project([noOverlap], { width: 420, height: 300 });
  cases.push(await runCase('disjoint-filter-rounding', disjointProject, opts, undefined, artifacts));
  cases.push(await runCase('disjoint', { ...disjointProject, layers: [{ ...noOverlap, style: { ...noOverlap.style, shadowBlur: 0, shadowX: 0, shadowY: 0 } }] }, opts, undefined, artifacts));
  for (const [id, changes] of [['shadow', { shadowX: 12, shadowY: 9, shadowBlur: 3 }], ['depth', { depth: 12 }], ['jelly', { material: 'jelly', materialStrength: 0.8 }], ['opacity', { opacity: 0.5 }]]) {
    const l = layer(`重叠-${id}`, [glyph('A', 'A', 0, 0, 70, 70), glyph('B', 'B', 48, -20, 70, 70)], { width: 118, height: 90, style: { ...flat, ...changes } });
    cases.push(await runCase(`overlap-${id}`, project([l]), opts, undefined, artifacts && id === 'shadow'));
  }
  const ornament = layer('花体', [glyph('srcA', 'A', 0, 0, 45, 60), glyph('srcA:letterform:flourish-slanted:0', '', -15, -5, 17, 8), glyph('srcB', 'B', 65, 0, 40, 60), glyph('srcA:letterform:join:srcB', '', 40, 43, 30, 5), glyph('srcB:letterform:flourish-slanted:0', '', 103, 50, 21, 6)], { kind: 'path', width: 130, height: 70, rotation: -13, scaleX: -1.1, scaleY: 0.82, style: { ...flat, gradient: true, outerWidth: 4, strokeWidth: 2, shadowBlur: 1, shadowX: 3, shadowY: 5 }, letterform: { presetId: 'flourish-slanted', amount: 0.7, sourceGlyphs: [glyph('srcA', 'A', 0, 0), glyph('srcB', 'B', 65, 0)], sourceWidth: 130, sourceHeight: 70, sourceKind: 'text' } });
  cases.push(await runCase('letterform', project([ornament]), { ...opts, scale: 1.3, crop: true, padding: 13 }, [[[0, 1, 3], [2, 4]]], artifacts));
  const image = canvas(30, 24), ctx = image.getContext('2d'); ctx.fillStyle = '#79b7d8'; ctx.fillRect(2, 2, 25, 20); ctx.clearRect(12, 9, 6, 7);
  const curves = [{ type: 'M', x: -8, y: 4 }, { type: 'C', x1: 10, y1: -20, x2: 60, y2: 5, x: 56, y: 30 }, { type: 'Q', x1: 70, y1: 65, x: 3, y: 55 }, { type: 'Q', x1: -20, y1: 37, x: -8, y: 4 }, { type: 'Z' }];
  const text = layer('多行旋转字形', [{ ...glyph('t1', '字', -10, 0, 55, 60, true), rotation: 17 }, { ...glyph('t2', '造', 90, 12), commands: curves }, { ...glyph('t3', '新', 40, 100, 48, 65, true), rotation: -21 }], { x: 200.3, y: 175.7, width: 200, height: 175, rotation: 23, scaleX: -0.92, scaleY: 1.07, locked: true, style: { ...flat, gradient: true, gradientGeometry: { type: 'linear', start: { x: -0.2, y: 0.15 }, end: { x: 1.2, y: 0.8 } }, gradientStops: [{ offset: 0, color: '#e95f99', midpoint: 0.3 }, { offset: 0.4, color: '#f9d574', midpoint: 0.75 }, { offset: 1, color: '#587bc7' }], opacity: 0.73, outerWidth: 5, strokeWidth: 2, shadowX: -7, shadowY: 5, shadowBlur: 2.3, depth: 6, texture: 'dots', textureOpacity: 0.28, gloss: true, material: 'glass', materialStrength: 0.6 } });
  const sticker = layer('分色贴纸', [{ ...glyph('s0', '', 0, 0, 60, 60, true), paint: { fill: 'primary', stroke: 'ink', strokeWidth: 4 } }, { ...glyph('s1', '', 11, 25, 48, 12), paint: { fill: 'secondary', strokeWidth: 0, opacity: 0.72, silhouette: false } }, { ...glyph('s2', '', 22, 7, 10, 8), paint: { fill: 'paper', strokeWidth: 0, silhouette: false } }, glyph('s3', '', 68, 0, 25, 36)], { kind: 'sticker', x: 365, y: 105, width: 95, height: 70, rotation: -12, style: { ...flat, opacity: 0.61, gradient: true, strokeWidth: 2, outerWidth: 3, shadowX: 3, shadowY: 4, shadowBlur: 2, material: 'jelly' } });
  const bitmap = layer('图片保持单层', [], { kind: 'image', x: 370, y: 275, width: 90, height: 72, rotation: 16, scaleX: -1, imageSrc: image.toDataURL(), style: { ...flat, opacity: 0.7, shadowX: 3, shadowY: 4, shadowBlur: 2 } });
  const hidden = layer('隐藏锁定路径', [glyph('h0', '藏', 0, 0, 30, 40), glyph('h1', '层', 45, 12, 30, 30)], { kind: 'path', x: 90, y: 360, width: 90, height: 55, visible: false, locked: true, style: { ...flat, depth: 5 } });
  const complex = project([bitmap, text, sticker, hidden], { width: 500, height: 430 });
  cases.push(await runCase('sample', complex, opts, undefined, artifacts));
  cases.push(await runCase('sample-crop', complex, { ...opts, crop: true, scale: 1.35, padding: 17 }, undefined, artifacts));
  for (const material of ['none', 'metal', 'glass', 'jelly', 'paper', 'neon']) {
    const l = layer(`材质-${material}`, [glyph('m0', '甲', 0, 0, 65, 65, true), glyph('m1', '乙', 110, 40, 42, 50)], { width: 160, height: 100, rotation: 11, style: { ...flat, gradient: true, gradientGeometry: { type: 'radial', center: { x: 0.28, y: 0.3 }, radiusX: 0.7, radiusY: 0.9 }, material, materialStrength: 0.75, gloss: true, texture: 'stripes', textureOpacity: 0.22 } });
    cases.push(await runCase(`material-${material}`, project([l]), { ...opts, crop: true, scale: 0.73, padding: 8 }));
  }
  const edgecases = project([layer('透明组', [glyph('z0', '透', 0, 0), glyph('z1', '明', 55, 0)], { style: { ...flat, opacity: 0 } }), layer('画外', [glyph('out', '外', 0, 0)], { x: 2000, y: 2000 }), layer('空白字符', [{ ...glyph('space', ' ', 0, 0), commands: [] }]), layer('空组', []), { ...bitmap, id: 'image-hidden', name: '隐藏图片', visible: false, locked: true }]);
  cases.push(await runCase('edgecases', edgecases, opts, undefined, artifacts));
  const emptyBlob = await exportPsd(project([], { width: 40, height: 30 }), opts), empty = window.agPsd.readPsd(await emptyBlob.arrayBuffer(), { useImageData: true });
  const invalid = [];
  const tooMany = project([layer('hidden-count', Array.from({ length: 513 }, (_, i) => glyph(`g${i}`, '字', 0, 0, 1, 1)), { visible: false })]);
  const accepted512 = estimatePsdSize({ ...tooMany, layers: [{ ...tooMany.layers[0], glyphs: tooMany.layers[0].glyphs.slice(0, 512) }] }, opts);
  const largeLeaves = project([layer('memory', Array.from({ length: 40 }, (_, i) => glyph(`big${i}`, '大', 0, 0, 900, 900)), { x: 500, y: 500, width: 900, height: 900, visible: false })], { width: 1000, height: 1000 });
  const memory = { elements: estimatePsdSize(largeLeaves, opts), layers: estimatePsdSize(largeLeaves, { ...opts, psdMode: 'layers' }) };
  for (const [id, fixture] of [['leaf-limit', tooMany], ['leaf-memory', largeLeaves]]) { try { await exportPsd(fixture, opts); invalid.push({ id, error: null }); } catch (error) { invalid.push({ id, error: error.message, name: error.name }); } }
  const legacyBytes = [];
  for (const [id, fixture, options] of [['complex', complex, { scale: 1, crop: false, padding: 0 }], ['crop', complex, { scale: 0.7, crop: true, padding: 9 }], ['empty', project([], { width: 40, height: 30 }), { scale: 1, crop: false, padding: 0 }]]) {
    const expected = new Uint8Array(await (await legacyExportPsd(fixture, options)).arrayBuffer()), actual = new Uint8Array(await (await exportPsd(fixture, options)).arrayBuffer()), explicit = new Uint8Array(await (await exportPsd(fixture, { ...options, psdMode: 'layers' })).arrayBuffer());
    legacyBytes.push({ id, expectedLength: expected.length, actualLength: actual.length, exact: expected.length === actual.length && expected.every((value, i) => value === actual[i]), explicitExact: expected.length === explicit.length && expected.every((value, i) => value === explicit[i]) });
  }
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { flushSync } = await import('react-dom');
  const { default: ExportControls } = await import('/src/ExportControls.tsx');
  const host = document.createElement('div'); document.body.append(host); const uiRoot = createRoot(host);
  let activeProject = p, activeOptions = { scale: 1, crop: false, padding: 0 }, selectedFormat = null;
  const mount = () => flushSync(() => uiRoot.render(React.createElement(ExportControls, { project: activeProject, selected: activeProject.layers[0], options: activeOptions, onOptions: value => { activeOptions = value; mount(); }, pngMode: 'selected', onPngMode: () => {}, busy: false, photoshop: true, onExport: value => { selectedFormat = value; } })));
  const estimateText = () => host.querySelector('[data-testid="psd-estimate"]').textContent;
  mount(); const initial = { mode: host.querySelector('[aria-label="PSD分层方式"]').value, text: estimateText() };
  const select = host.querySelector('[aria-label="PSD分层方式"]'); select.value = 'elements'; select.dispatchEvent(new Event('change', { bubbles: true }));
  const switched = { mode: activeOptions.psdMode, text: estimateText(), note: host.querySelector('[data-testid="psd-elements-note"]')?.textContent };
  host.querySelector('[data-testid="download-psd"]').click();
  activeProject = tooMany; mount(); const limitUI = { text: estimateText(), disabled: host.querySelector('[data-testid="download-psd"]').disabled, alert: host.querySelector('[role="alert"]')?.textContent };
  activeProject = largeLeaves; mount(); const memoryUI = { text: estimateText(), disabled: host.querySelector('[data-testid="download-psd"]').disabled, alert: host.querySelector('[role="alert"]')?.textContent };
  uiRoot.unmount(); host.remove();
  return { overlap, cases, estimate: cases[0].estimate, tree: cases[0].tree, invalid, accepted512, memory, legacyBytes, ui: { initial, switched, selectedFormat, limitUI, memoryUI }, empty: { width: empty.width, height: empty.height, children: empty.children.length, nonzero: empty.imageData.data.some(value => value !== 0) }, userAgent: navigator.userAgent };
}
