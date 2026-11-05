import { zipSync } from 'fflate';
import { contentBounds, newId, projectSvg } from './engine';
import { BASE_LAYER, DEFAULT_STYLE } from './types';
import type { ExportOptions, Layer, Project } from './types';

const MAX_SIDE = 32767;
const MAX_LAYERS = 512;
const MEMORY_BUDGET = 512 * 1024 * 1024;
type Frame = { opening: string; width: number; height: number };

function assertDimensions(width: number, height: number, retainedBytes = 0): void {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_SIDE)) {
    throw new RangeError('图片宽高请保持在 1–32767 像素内。');
  }
  if (width * height * 16 + retainedBytes * 3 > MEMORY_BUDGET) {
    throw new RangeError('图片预计超过 512 MB 处理预算，请降低导出倍数、缩小画布或减少图层。');
  }
}

function exportFrame(project: Project, options: ExportOptions): Frame {
  if (![project.width, project.height].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('画布宽高必须大于 0。');
  if (!Number.isFinite(options.scale) || options.scale <= 0) throw new RangeError('导出倍数必须是大于 0 的有限数值。');
  if (!Number.isFinite(options.padding) || options.padding < 0) throw new RangeError('导出留白必须是非负有限数值。');
  const source = projectSvg(project, options);
  const opening = source.match(/^<svg\b[^>]*>/)?.[0];
  const width = Number(opening?.match(/\bwidth="([^"]+)"/)?.[1]);
  const height = Number(opening?.match(/\bheight="([^"]+)"/)?.[1]);
  if (!opening) throw new Error('导出图像缺少 SVG 画幅。');
  assertDimensions(width, height);
  return { opening, width, height };
}

function pngSource(project: Project, layer: Layer, options: ExportOptions, frame: Frame): string {
  const single = projectSvg({ ...project, layers: [layer] }, { ...options, crop: false });
  // Reuse the complete project viewport, including fractional crop alignment.
  return single.replace(/^<svg\b[^>]*>/, frame.opening);
}

async function rasterPng(source: string, frame: Frame, offsetX = 0, offsetY = 0, overflowSource?: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const images: HTMLImageElement[] = [];
  const urls: string[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  async function load(svg: string): Promise<HTMLImageElement> {
    const image = new Image();
    images.push(image);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    urls.push(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('图层渲染超时，请检查导入图片或缩小画布。')), 30000);
      timers.push(timeout);
      image.onload = () => { clearTimeout(timeout); resolve(); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('图层图像解码失败，请检查导入图片是否完整。')); };
      image.src = url;
    });
    return image;
  }
  try {
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('导出需要浏览器 Canvas 2D 支持。');
    if (overflowSource) {
      const overflow = await load(overflowSource);
      context.drawImage(overflow, 0, 0, frame.width, frame.height);
    }
    const image = await load(source);
    if (overflowSource) {
      // Replace only the original viewport; the expanded render retains off-canvas artwork.
      context.save();
      context.beginPath();
      context.rect(offsetX, offsetY, image.naturalWidth, image.naturalHeight);
      context.clip();
      context.clearRect(0, 0, frame.width, frame.height);
    }
    context.drawImage(image, offsetX, offsetY, image.naturalWidth, image.naturalHeight);
    if (overflowSource) context.restore();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图层 PNG 编码失败。')), 'image/png');
    });
  } finally {
    timers.forEach(clearTimeout);
    for (const image of images) { image.onload = null; image.onerror = null; image.src = ''; }
    urls.forEach(url => URL.revokeObjectURL(url));
    canvas.width = 1;
    canvas.height = 1;
  }
}

function filename(name: string, index: number): string {
  const clean = name.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/, '');
  const basename = Array.from(clean || '图层').slice(0, 64).join('').replace(/[. ]+$/, '') || '图层';
  // An ordinal keeps duplicate names unique and avoids Windows reserved basenames.
  return `${String(index + 1).padStart(3, '0')}-${basename}.png`;
}

/** Visible layers share the composite export frame and retain bottom-to-top order. */
export async function exportLayerPngs(project: Project, options: ExportOptions): Promise<Blob> {
  const layers = project.layers.filter(layer => layer.visible);
  if (!layers.length) throw new Error('请先显示需要导出的图层。');
  if (layers.length > MAX_LAYERS) throw new RangeError(`逐层导出每次最多 ${MAX_LAYERS} 层。`);
  const frame = exportFrame(project, options);
  const entries: Record<string, Uint8Array> = Object.create(null);
  let retainedBytes = 0;
  for (let index = 0; index < layers.length; index += 1) {
    assertDimensions(frame.width, frame.height, retainedBytes);
    const blob = await rasterPng(pngSource(project, layers[index], options, frame), frame);
    retainedBytes += blob.size;
    assertDimensions(frame.width, frame.height, retainedBytes);
    entries[filename(layers[index].name, index)] = new Uint8Array(await blob.arrayBuffer());
  }
  const archive = zipSync(entries, { level: 0 });
  return new Blob([new Uint8Array(archive)], { type: 'application/zip' });
}

async function dataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('合并图片编码失败。'));
    reader.onerror = () => reject(new Error('合并图片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

/** Bake selected artwork at the canvas pixel grid; effects are already in the bitmap. */
export async function mergeLayers(project: Project, ids: string[]): Promise<Project> {
  const selectedIds = new Set(ids);
  if (selectedIds.size < 2) throw new Error('请勾选至少两个图层再合并。');
  const selected = project.layers.filter(layer => selectedIds.has(layer.id));
  if (selected.length !== selectedIds.size) throw new Error('选中图层已变化，请重新选择。');
  if (selected.length > MAX_LAYERS) throw new RangeError(`每次最多合并 ${MAX_LAYERS} 层。`);
  if (selected.some(layer => !layer.visible)) throw new Error('请先显示选中图层，再合并。');
  if (selected.some(layer => layer.locked)) throw new Error('请先解锁选中图层，再合并。');
  const bounds = contentBounds({ ...project, layers: selected });
  if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('选中图层没有可合并的图像内容。');
  // Integer world coordinates preserve the original pixel grid when re-embedded.
  const left = Math.floor(bounds.x);
  const top = Math.floor(bounds.y);
  const width = Math.ceil(bounds.x + bounds.width) - left;
  const height = Math.ceil(bounds.y + bounds.height) - top;
  assertDimensions(width, height);
  const selectedProject = { ...project, layers: selected };
  const options = { scale: 1, crop: false, padding: 0 };
  const originalFrame = exportFrame(selectedProject, options);
  assertDimensions(width, height, originalFrame.width * originalFrame.height * 4);
  const frame = { opening: '', width, height };
  const overflow = left < 0 || top < 0 || left + width > originalFrame.width || top + height > originalFrame.height;
  const overflowSource = overflow ? projectSvg({ ...project, width, height, layers: selected.map(layer => ({ ...layer, x: layer.x - left, y: layer.y - top })) }, options) : undefined;
  const image = await rasterPng(projectSvg(selectedProject, options), frame, -left, -top, overflowSource);
  const merged: Layer = {
    ...BASE_LAYER, id: newId(), name: `合并 · ${selected.length} 个图层`, kind: 'image', fontId: '', text: '',
    x: left + width / 2, y: top + height / 2, width, height, rotation: 0, scaleX: 1, scaleY: 1,
    visible: true, locked: false, glyphs: [], imageSrc: await dataUrl(image),
    style: { ...DEFAULT_STYLE, gradient: false, material: 'none', materialStrength: 0, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', textureOpacity: 0, gloss: false, opacity: 1 },
  };
  const highest = selected.at(-1)!.id;
  const layers = project.layers.flatMap(layer => layer.id === highest ? [merged] : selectedIds.has(layer.id) ? [] : [layer]);
  return { ...project, layers };
}
