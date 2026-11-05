import type { Layer as PsdLayer } from 'ag-psd';
import { contentBounds, layerSubsetSvg, projectSvg } from './engine';
import { psdElementGroups, psdGroupOpacity } from './psd-elements';
import type { Bounds, ExportOptions, Layer, Project } from './types';

const MAX_SIDE = 30000;
const MAX_LAYERS = 512;
const MEMORY_BUDGET = 512 * 1024 * 1024;

type Frame = { root: Element; width: number; height: number; x: number; y: number; zoom: number; offsetX: number; offsetY: number };
export type PsdSizeEstimate = { width: number; height: number; layerCount: number; groupCount: number; estimatedBytes: number; estimatedSeconds: { min: number; max: number } };
type ElementRegion = { name: string; glyphIndices: number[]; region: Bounds };
type ElementGroup = { layer: Layer; elements: ElementRegion[] };

function timeEstimate(layerCount: number, pixels: number): { min: number; max: number } {
  // A planning range, not a benchmark: browser, effects and embedded images determine actual time.
  const min = Math.max(1, Math.ceil(layerCount * 0.025 + pixels / 12000000));
  return { min, max: Math.max(min + 2, Math.ceil(layerCount * 0.15 + pixels / 2000000)) };
}

function svgRoot(source: string): Element {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('PSD 导出失败：图层 SVG 数据格式有误。');
  return doc.documentElement;
}

function layerRegion(project: Project, layer: Layer, frame: Frame): Bounds {
  const bounds = contentBounds({ ...project, layers: [{ ...layer, visible: true }] });
  if (!bounds.width || !bounds.height) return { x: 0, y: 0, width: 0, height: 0 };
  const x = (bounds.x - frame.x) * frame.zoom + frame.offsetX;
  const y = (bounds.y - frame.y) * frame.zoom + frame.offsetY;
  // Keep a pixel guard around the engine's rounded SVG coordinates and antialiasing.
  const left = Math.max(0, Math.min(frame.width, Math.floor(x) - 2));
  const top = Math.max(0, Math.min(frame.height, Math.floor(y) - 2));
  const right = Math.max(0, Math.min(frame.width, Math.ceil(x + bounds.width * frame.zoom) + 2));
  const bottom = Math.max(0, Math.min(frame.height, Math.ceil(y + bounds.height * frame.zoom) + 2));
  if (![left, top, right, bottom].every(Number.isFinite)) throw new RangeError('PSD 图层尺寸异常，请检查缩放、旋转和效果参数。');
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function prepare(project: Project, options: ExportOptions) {
  if (!Number.isFinite(options.scale) || options.scale <= 0) throw new RangeError('PSD 导出倍数必须是大于 0 的有限数值。');
  if (![project.width, project.height].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('PSD 画布宽高必须是大于 0 的有限数值。');
  if (!Number.isFinite(options.padding)) throw new RangeError('PSD 留白必须是有限数值。');
  const elementMode = options.psdMode === 'elements';
  if (!elementMode && project.layers.length > MAX_LAYERS) throw new RangeError(`PSD 图层数超过 ${MAX_LAYERS} 层，请拆分工程后导出。`);
  const elementPlan = elementMode ? psdElementGroups(project) : [];
  const leafCount = elementPlan.reduce((count, group) => count + group.elements.length, 0);
  if (elementMode && leafCount > MAX_LAYERS) throw new RangeError(`PSD 逐元素共 ${leafCount} 个叶层（含隐藏元素），超过 ${MAX_LAYERS} 层上限。请拆分图层到不同工程后分别导出。`);
  const source = projectSvg(project, options);
  const root = svgRoot(source);
  const width = Number(root.getAttribute('width'));
  const height = Number(root.getAttribute('height'));
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_SIDE)) {
    throw new RangeError(`PSD 宽高上限为 ${MAX_SIDE} 像素，请降低导出倍数或缩小画布。`);
  }
  const [x, y, viewWidth, viewHeight] = root.getAttribute('viewBox')!.split(/\s+/).map(Number);
  if (![x, y, viewWidth, viewHeight].every(Number.isFinite) || viewWidth <= 0 || viewHeight <= 0) throw new RangeError('PSD 导出区域过小或尺寸异常，请调整画布或图层缩放。');
  const zoom = Math.min(width / viewWidth, height / viewHeight);
  const frame: Frame = { root, width, height, x, y, zoom, offsetX: (width - viewWidth * zoom) / 2, offsetY: (height - viewHeight * zoom) / 2 };
  const elementGroups: ElementGroup[] = elementPlan.map(({ layer, elements }) => ({ layer, elements: elements.map(element => {
    const subset = layer.kind === 'image' ? layer : { ...layer, glyphs: element.glyphIndices.map(index => layer.glyphs[index]), style: { ...layer.style, opacity: 1 } };
    const region = layerRegion(project, subset, frame);
    if (!region.width || !region.height) { region.width = 0; region.height = 0; }
    return { ...element, region };
  }) }));
  const regions = elementMode ? elementGroups.flatMap(group => group.elements.map(element => element.region)) : project.layers.map(layer => layerRegion(project, layer, frame));
  const pixels = regions.map(region => region.width * region.height);
  const layerCount = elementMode ? leafCount : project.layers.length;
  const groupCount = elementGroups.filter(group => group.layer.kind !== 'image').length;
  // Includes retained RGBA leaves, SVG/canvas scratch space, RLE growth, groups and Blob copies.
  const estimatedBytes = width * height * (elementMode ? 40 : 32) + pixels.reduce((sum, value) => sum + value, 0) * 20
    + Math.max(0, ...pixels) * 16 + source.length * 2 + (layerCount + groupCount * 2) * 4096 + 8 * 1024 * 1024;
  const rasterPixels = width * height * (1 + (elementMode ? pixels.filter(value => value > 0).length : 0));
  const estimate: PsdSizeEstimate = { width, height, layerCount, groupCount, estimatedBytes, estimatedSeconds: timeEstimate(layerCount, rasterPixels + pixels.reduce((sum, value) => sum + value, 0)) };
  return { source, frame, regions, elementGroups, estimate };
}

export function estimatePsdSize(project: Project, options: ExportOptions): PsdSizeEstimate {
  return prepare(project, options).estimate;
}

async function raster(source: string, frame: Frame, region: Bounds, fullViewport = false): Promise<ImageData> {
  const canvas = document.createElement('canvas');
  const image = new Image();
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('PSD 图层渲染超时，请缩小图片或降低导出倍数。')), 30000);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('PSD 图层渲染失败，请检查导入图片是否完整。'));
      image.src = url;
    });
    canvas.width = fullViewport ? frame.width : region.width;
    canvas.height = fullViewport ? frame.height : region.height;
    // Match exportPng's backend; willReadFrequently changes SVG antialiasing in Chromium.
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('PSD 导出需要浏览器 Canvas 2D 支持，请重新打开编辑器。');
    // Element gradients and filters need the same raster target, not just the same SVG viewBox.
    context.drawImage(image, fullViewport ? 0 : -region.x, fullViewport ? 0 : -region.y, frame.width, frame.height);
    return context.getImageData(fullViewport ? region.x : 0, fullViewport ? region.y : 0, region.width, region.height);
  } finally {
    clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
    canvas.width = 1;
    canvas.height = 1;
  }
}

function layerSource(project: Project, layer: Layer, options: ExportOptions, frame: Frame): string {
  const single = svgRoot(projectSvg({ ...project, layers: [{ ...layer, visible: true }] }, { ...options, crop: false }));
  const root = frame.root.cloneNode(false);
  for (const node of Array.from(single.childNodes)) root.appendChild(node);
  return new XMLSerializer().serializeToString(root);
}

function elementSource(layer: Layer, element: ElementRegion, options: ExportOptions, frame: Frame): string {
  const parent = { ...layer, visible: true, style: { ...layer.style, opacity: 1 } };
  const body = layerSubsetSvg(parent, element.glyphIndices, options.scale);
  const single = svgRoot(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  const root = frame.root.cloneNode(false);
  for (const node of Array.from(single.childNodes)) root.appendChild(node);
  return new XMLSerializer().serializeToString(root);
}

async function renderElements(project: Project, options: ExportOptions, frame: Frame, groups: ElementGroup[]): Promise<{ children: PsdLayer[]; imageData: ImageData }> {
  const merged = document.createElement('canvas');
  const isolated = document.createElement('canvas');
  const scratch = document.createElement('canvas');
  merged.width = isolated.width = frame.width;
  merged.height = isolated.height = frame.height;
  const mergedContext = merged.getContext('2d', { alpha: true });
  const groupContext = isolated.getContext('2d', { alpha: true });
  if (!mergedContext || !groupContext) throw new Error('PSD 导出需要浏览器 Canvas 2D 支持，请重新打开编辑器。');
  const children: PsdLayer[] = [];
  try {
    for (const { layer, elements } of groups) {
      groupContext.clearRect(0, 0, frame.width, frame.height);
      const leaves: PsdLayer[] = [];
      for (const element of elements) {
        const region = element.region;
        const pixels = region.width && region.height ? await raster(layer.kind === 'image' ? layerSource(project, layer, options, frame) : elementSource(layer, element, options, frame), frame, region, true) : undefined;
        leaves.push({ name: element.name, left: region.x, top: region.y, right: region.x + region.width, bottom: region.y + region.height,
          hidden: layer.kind === 'image' ? !layer.visible : false, opacity: 1, blendMode: 'normal', protected: { all: layer.locked }, ...(pixels ? { imageData: pixels } : {}) });
        if (pixels && layer.visible) {
          scratch.width = pixels.width; scratch.height = pixels.height;
          const context = scratch.getContext('2d', { alpha: true });
          if (!context) throw new Error('PSD 导出需要浏览器 Canvas 2D 支持，请重新打开编辑器。');
          context.putImageData(pixels, 0, 0);
          groupContext.drawImage(scratch, region.x, region.y);
        }
      }
      const opacity = layer.kind === 'image' ? 1 : psdGroupOpacity(layer);
      if (layer.kind === 'image') children.push(...leaves);
      else children.push({ name: layer.name, children: leaves, opened: true, hidden: !layer.visible, protected: { all: layer.locked }, opacity, blendMode: 'normal' });
      if (layer.visible) {
        mergedContext.globalAlpha = opacity;
        mergedContext.drawImage(isolated, 0, 0);
      }
    }
    return { children, imageData: mergedContext.getImageData(0, 0, frame.width, frame.height) };
  } finally {
    for (const canvas of [merged, isolated, scratch]) { canvas.width = 1; canvas.height = 1; }
  }
}

export async function exportPsd(project: Project, options: ExportOptions): Promise<Blob> {
  try {
    const { source, frame, regions, elementGroups, estimate } = prepare(project, options);
    if (estimate.estimatedBytes > MEMORY_BUDGET) {
      throw new RangeError(`PSD 预计占用约 ${Math.ceil(estimate.estimatedBytes / 1024 / 1024)} MB，超过 512 MB 导出预算。请降低倍数、开启裁边或减少图层。`);
    }
    const elements = options.psdMode === 'elements' ? await renderElements(project, options, frame, elementGroups) : undefined;
    const children: PsdLayer[] = elements?.children ?? [];
    for (let index = 0; !elements && index < project.layers.length; index += 1) {
      const layer = project.layers[index];
      const region = regions[index];
      const pixels = region.width && region.height
        ? await raster(layerSource(project, layer, options, frame), frame, region)
        : undefined;
      children.push({
        name: layer.name, left: region.x, top: region.y,
        right: region.x + region.width, bottom: region.y + region.height,
        hidden: !layer.visible, opacity: 1, blendMode: 'normal',
        protected: { all: layer.locked },
        ...(pixels ? { imageData: pixels } : {}),
      });
    }
    const imageData = elements?.imageData ?? await raster(source, frame, { x: 0, y: 0, width: frame.width, height: frame.height });
    // ag-psd writes children in PSD record order, bottom-to-top (verified in native Photoshop).
    // Keep the engine's paint order; Photoshop's layer panel presents its reverse.
    const { writePsd } = await import('ag-psd');
    const buffer = writePsd({ width: frame.width, height: frame.height, imageData, children }, {
      noBackground: true, trimImageData: false, generateThumbnail: false,
    });
    return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PSD')) throw error;
    throw new Error(`PSD 导出失败：${error instanceof Error ? error.message : '请降低导出倍数后重试。'}`, { cause: error });
  }
}
