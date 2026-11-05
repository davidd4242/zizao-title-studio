import * as engine from '/src/engine.ts';
import { parseProject } from '/src/project.ts';
import { BASE_LAYER, DEFAULT_STYLE } from '/src/types.ts';
import { glyphCorners } from '/src/glyph-transform.ts';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Canvas from '/src/Canvas.tsx';

export { engine, parseProject };

const box = (x, y, w, h) => [{ type: 'M', x, y }, { type: 'L', x: x + w, y }, { type: 'L', x: x + w, y: y + h }, { type: 'L', x, y: y + h }, { type: 'Z' }];
const glyph = (id, char, x) => ({ id, char, x, y: 0, width: 110, height: 150, commands: box(0, 0, 110, 150) });

export function makeFixture() {
  const style = { ...DEFAULT_STYLE, fill: '#ff3481', gradient: false, strokeWidth: 0, outerWidth: 0, shadowBlur: 0, shadowX: 0, shadowY: 0, depth: 0, texture: 'none', gloss: false };
  return {
    version: 1, name: 'Glyph transform verification', width: 960, height: 540,
    layers: [{ ...BASE_LAYER, id: 'glyph-text', name: '你好呀', kind: 'text', fontId: 'fixture-existing-paths', text: '你好呀', width: 400, height: 170, x: 480, y: 270, rotation: 0, scaleX: 1, scaleY: 1, style, glyphs: [glyph('你', '你', 0), glyph('好', '好', 130), glyph('呀', '呀', 260)] }],
  };
}

export const layerDocument = project => `<svg xmlns="http://www.w3.org/2000/svg" width="${project.width}" height="${project.height}" viewBox="0 0 ${project.width} ${project.height}">${engine.layerSvg(project.layers.at(-1))}</svg>`;

export async function pixels(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } finally { URL.revokeObjectURL(url); }
}

export function difference(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Raster dimensions differ');
  let maxAlpha = 0, maxPremultiplied = 0, differentPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false;
    const alpha = Math.abs(a.data[i + 3] - b.data[i + 3]);
    maxAlpha = Math.max(maxAlpha, alpha);
    changed = alpha !== 0;
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs(a.data[i + c] * a.data[i + 3] / 255 - b.data[i + c] * b.data[i + 3] / 255);
      maxPremultiplied = Math.max(maxPremultiplied, delta);
      changed ||= delta !== 0;
    }
    if (changed) differentPixels += 1;
  }
  return { maxAlpha, maxPremultiplied, differentPixels };
}

function mount(project, editing) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(Canvas, {
    project, selectedId: project.layers[0].id, setSelectedId() {}, mode: 'glyph',
    glyphIndex: 0, setGlyphIndex() {}, glyphEditing: editing, setGlyphEditing() {},
    node: null, setNode() {}, zoom: 1, onDraft() {}, onCommit() {}, checker: false, referenceVisible: false,
  })));
  return { host, root };
}

const screenOf = node => {
  const m = node.getScreenCTM(), x = +node.getAttribute('x'), y = +node.getAttribute('y'), w = +node.getAttribute('width'), h = +node.getAttribute('height');
  return { local: { x: x + w / 2, y: y + h / 2 }, screen: { x: m.a * (x + w / 2) + m.c * (y + h / 2) + m.e, y: m.b * (x + w / 2) + m.d * (y + h / 2) + m.f }, painted: node.getBoundingClientRect() };
};

/** Real Canvas, glyph selected: every handle position against the glyph geometry, in layer and screen space. */
export function frameSnapshot(project) {
  const { host, root } = mount(project, true);
  try {
    const g = project.layers[0].glyphs[0], corners = glyphCorners(g);
    const handles = [...host.querySelectorAll('[data-testid^="glyph-scale-handle-"]')].map(node => ({ ...screenOf(node), focusable: node.tabIndex === 0 }));
    const knobNode = host.querySelector('[data-testid="glyph-rotate-handle"]');
    const knob = { ...screenOf(knobNode), focusable: knobNode.tabIndex === 0, radius: +knobNode.getAttribute('r'), cx: +knobNode.getAttribute('cx'), cy: +knobNode.getAttribute('cy') };
    for (const handle of handles) Object.assign(handle, { cssX: handle.painted.x + handle.painted.width / 2, cssY: handle.painted.y + handle.painted.height / 2 });
    Object.assign(knob, { cssX: knob.painted.x + knob.painted.width / 2, cssY: knob.painted.y + knob.painted.height / 2 });
    return { corners, handles, knob, frames: host.querySelectorAll('.glyph-frame').length, dashes: host.querySelectorAll('.glyph-target').length };
  } finally { root.unmount(); host.remove(); }
}

/** Frames drawn on the canvas before any double-click. */
export function idleFrameCount(project) {
  const { host, root } = mount(project, false);
  try { return { frames: host.querySelectorAll('.glyph-frame').length, handles: host.querySelectorAll('[data-testid^="glyph-scale-handle-"]').length, dashes: host.querySelectorAll('.glyph-target').length }; }
  finally { root.unmount(); host.remove(); }
}
