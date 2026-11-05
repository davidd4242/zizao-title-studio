import type { Bounds, Command, ExportOptions, Glyph, GradientGeometry, GradientStop, Layer, Project, TextStyle } from './types';

type Point = { x: number; y: number };
type Rect = { minX: number; minY: number; maxX: number; maxY: number };

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 2;
const DEPTH_X = 0.65;
let sequence = 0;

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positive(value: number | undefined): number {
  return Math.max(0, finite(value));
}

function unit(value: number | undefined, fallback = 1): number {
  return Math.max(0, Math.min(1, finite(value, fallback)));
}

function number(value: number): string {
  return String(Math.round(finite(value) * 10000) / 10000);
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

function idPrefix(id: string): string {
  return `layer-${id.replace(/[^a-zA-Z0-9-]/g, character => `_${character.charCodeAt(0).toString(16)}_`)}`;
}

export function commandPath(commands: Command[]): string {
  return commands.map(command => {
    const end = `${number(finite(command.x))} ${number(finite(command.y))}`;
    switch (command.type) {
      case 'M': return `M${end}`;
      case 'L': return `L${end}`;
      case 'Q': return `Q${number(finite(command.x1))} ${number(finite(command.y1))} ${end}`;
      case 'C': return `C${number(finite(command.x1))} ${number(finite(command.y1))} ${number(finite(command.x2))} ${number(finite(command.y2))} ${end}`;
      case 'Z': return 'Z';
    }
  }).join(' ');
}

export function layerTransform(layer: Layer): string {
  return `translate(${number(layer.x)} ${number(layer.y)}) rotate(${number(layer.rotation)}) scale(${number(finite(layer.scaleX, 1))} ${number(finite(layer.scaleY, 1))}) translate(${number(-layer.width / 2)} ${number(-layer.height / 2)})`;
}

function rotate(point: Point, degrees: number): Point {
  const radians = finite(degrees) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

function glyphPoint(glyph: Glyph, x: number, y: number): Point {
  const centerX = finite(glyph.width) / 2;
  const centerY = finite(glyph.height) / 2;
  const scaled = {
    x: (x - centerX) * finite(glyph.scaleX, 1),
    y: (y - centerY) * finite(glyph.scaleY, 1),
  };
  const point = rotate(scaled, finite(glyph.rotation));
  return { x: point.x + centerX + finite(glyph.x), y: point.y + centerY + finite(glyph.y) };
}

function worldPoint(layer: Layer, point: Point): Point {
  const result = rotate({
    x: (point.x - finite(layer.width) / 2) * finite(layer.scaleX, 1),
    y: (point.y - finite(layer.height) / 2) * finite(layer.scaleY, 1),
  }, layer.rotation);
  return { x: result.x + finite(layer.x), y: result.y + finite(layer.y) };
}

export function screenToLayer(layer: Layer, x: number, y: number): Point {
  const scaleX = finite(layer.scaleX, 1);
  const scaleY = finite(layer.scaleY, 1);
  if (Math.abs(scaleX) < Number.EPSILON || Math.abs(scaleY) < Number.EPSILON) {
    throw new RangeError('A layer with zero scale has no inverse transform.');
  }
  const point = rotate({ x: x - finite(layer.x), y: y - finite(layer.y) }, -layer.rotation);
  return { x: point.x / scaleX + finite(layer.width) / 2, y: point.y / scaleY + finite(layer.height) / 2 };
}

function emptyRect(): Rect {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function include(rect: Rect, point: Point): void {
  rect.minX = Math.min(rect.minX, point.x);
  rect.minY = Math.min(rect.minY, point.y);
  rect.maxX = Math.max(rect.maxX, point.x);
  rect.maxY = Math.max(rect.maxY, point.y);
}

function hasRect(rect: Rect): boolean {
  return Number.isFinite(rect.minX) && Number.isFinite(rect.minY);
}

function expand(rect: Rect, amount: number): Rect {
  return { minX: rect.minX - amount, minY: rect.minY - amount, maxX: rect.maxX + amount, maxY: rect.maxY + amount };
}

function merge(a: Rect, b: Rect): Rect {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function shifted(rect: Rect, x: number, y: number): Rect {
  return { minX: rect.minX + x, minY: rect.minY + y, maxX: rect.maxX + x, maxY: rect.maxY + y };
}

function quadraticAt(p0: number, p1: number, p2: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * p0 + 2 * inverse * t * p1 + t * t * p2;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * p0 + 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t ** 3 * p3;
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function drawable(glyph: Glyph): boolean {
  return glyph.commands.some(command => command.type === 'L' || command.type === 'Q' || command.type === 'C');
}

function glyphBounds(glyph: Glyph): Rect {
  const rect = emptyRect();
  let current: Point = glyphPoint(glyph, 0, 0);
  let start = current;
  for (const command of glyph.commands) {
    const end = glyphPoint(glyph, finite(command.x), finite(command.y));
    if (command.type === 'M') {
      current = end;
      start = end;
      continue;
    }
    if (command.type === 'Z') {
      include(rect, start);
      include(rect, current);
      current = start;
      continue;
    }
    include(rect, current);
    include(rect, end);
    if (command.type === 'Q' || command.type === 'C') {
      const control1 = glyphPoint(glyph, finite(command.x1), finite(command.y1));
      if (command.type === 'Q') {
        for (const axis of ['x', 'y'] as const) {
          const denominator = current[axis] - 2 * control1[axis] + end[axis];
          if (Math.abs(denominator) < 1e-12) continue;
          const t = (current[axis] - control1[axis]) / denominator;
          if (t > 0 && t < 1) include(rect, {
            x: quadraticAt(current.x, control1.x, end.x, t),
            y: quadraticAt(current.y, control1.y, end.y, t),
          });
        }
      } else {
        const control2 = glyphPoint(glyph, finite(command.x2), finite(command.y2));
        for (const axis of ['x', 'y'] as const) {
          for (const t of cubicExtrema(current[axis], control1[axis], control2[axis], end[axis])) {
            if (t > 0 && t < 1) include(rect, {
              x: cubicAt(current.x, control1.x, control2.x, end.x, t),
              y: cubicAt(current.y, control1.y, control2.y, end.y, t),
            });
          }
        }
      }
    }
    current = end;
  }
  return rect;
}

function localGeometry(layer: Layer): Rect {
  if (layer.kind === 'image') {
    return layer.imageSrc && positive(layer.width) > 0 && positive(layer.height) > 0
      ? { minX: 0, minY: 0, maxX: positive(layer.width), maxY: positive(layer.height) }
      : emptyRect();
  }
  return layer.glyphs.filter(drawable).reduce((rect, glyph) => merge(rect, glyphBounds(glyph)), emptyRect());
}

function bodyBounds(layer: Layer, geometry: Rect): Rect {
  if (layer.kind === 'image') return geometry;
  const localStroke = layer.glyphs.some(glyph => glyph.paint)
    ? Math.max(positive(layer.style.strokeWidth), ...layer.glyphs.map(glyph => positive(glyph.paint?.strokeWidth)))
    : positive(layer.style.strokeWidth);
  const stroke = localStroke / 2 + positive(layer.style.outerWidth);
  const front = expand(geometry, stroke);
  const depth = positive(layer.style.depth);
  return merge(front, shifted(front, depth * DEPTH_X, depth));
}

function renderedBounds(layer: Layer, geometry: Rect): Rect {
  const body = bodyBounds(layer, geometry);
  const blur = positive(layer.style.shadowBlur) * 4;
  const shadow = expand(shifted(body, finite(layer.style.shadowX), finite(layer.style.shadowY)), blur);
  return expand(merge(body, shadow), MARGIN);
}

function paintable(layer: Layer): boolean {
  return layer.visible && unit(layer.style.opacity) > 0
    && finite(layer.scaleX, 1) !== 0 && finite(layer.scaleY, 1) !== 0;
}

export function contentBounds(project: Project): Bounds {
  let all = emptyRect();
  for (const layer of project.layers) {
    if (!paintable(layer)) continue;
    const geometry = localGeometry(layer);
    if (!hasRect(geometry)) continue;
    const rect = renderedBounds(layer, geometry);
    const transformed = emptyRect();
    for (const x of [rect.minX, rect.maxX]) {
      for (const y of [rect.minY, rect.maxY]) include(transformed, worldPoint(layer, { x, y }));
    }
    all = merge(all, transformed);
  }
  return hasRect(all)
    ? { x: all.minX, y: all.minY, width: all.maxX - all.minX, height: all.maxY - all.minY }
    : { x: 0, y: 0, width: 0, height: 0 };
}

function shapeMarkup(layer: Layer): string {
  return layer.glyphs.filter(drawable).map(glyph => {
    const commands = glyph.commands.map(command => {
      const transformed = { ...command };
      for (const [xKey, yKey] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']] as const) {
        if (command[xKey] !== undefined && command[yKey] !== undefined) {
          const point = glyphPoint(glyph, finite(command[xKey]), finite(command[yKey]));
          transformed[xKey] = point.x;
          transformed[yKey] = point.y;
        }
      }
      return transformed;
    });
    const fillRule = glyph.fillRule === 'nonzero' ? 'nonzero' : 'evenodd';
    return `<path d="${commandPath(commands)}" fill-rule="${fillRule}" clip-rule="${fillRule}"/>`;
  }).join('');
}

export function layerGeometryBounds(layer: Layer): Bounds {
  const rect = localGeometry(layer);
  return hasRect(rect) ? { x: rect.minX, y: rect.minY, width: Math.max(0.001, rect.maxX - rect.minX), height: Math.max(0.001, rect.maxY - rect.minY) }
    : { x: 0, y: 0, width: Math.max(0.001, layer.width), height: Math.max(0.001, layer.height) };
}

export function validateGradientStyle(style: TextStyle): void {
  const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000;
  const point = (p: unknown): p is Point => !!p && typeof p === 'object' && !Array.isArray(p) && coordinate((p as Point).x) && coordinate((p as Point).y);
  const g = style.gradientGeometry;
  if (g !== undefined) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('渐变几何不正确');
    if (g.type === 'linear') {
      if (!point(g.start) || !point(g.end) || Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) < 1e-6) throw new Error('渐变端点不正确');
    } else if (g.type === 'radial') {
      if (!point(g.center) || !coordinate(g.radiusX) || !coordinate(g.radiusY) || g.radiusX < 1e-6 || g.radiusY < 1e-6 || (g.rotation !== undefined && (typeof g.rotation !== 'number' || !Number.isFinite(g.rotation) || Math.abs(g.rotation) > 36000))) throw new Error('渐变半径不正确');
    } else throw new Error('渐变几何类型不正确');
    if (style.gradientType !== undefined && style.gradientType !== g.type) throw new Error('渐变几何与类型不一致');
  }
  if (style.gradientStops !== undefined) {
    if (!Array.isArray(style.gradientStops) || style.gradientStops.length < 2 || style.gradientStops.length > 6) throw new Error('渐变色标数量不正确');
    for (const stop of style.gradientStops) {
      if (!stop || typeof stop !== 'object' || !Number.isFinite(stop.offset) || stop.offset < 0 || stop.offset > 1 || typeof stop.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(stop.color)) throw new Error('渐变色标不正确');
      if (stop.midpoint !== undefined && (typeof stop.midpoint !== 'number' || !Number.isFinite(stop.midpoint) || stop.midpoint <= 0 || stop.midpoint >= 1)) throw new Error('渐变中点不正确');
    }
  }
}

export function resolveGradientGeometry(style: TextStyle, frame: Bounds): GradientGeometry {
  validateGradientStyle(style);
  if (style.gradientGeometry) return structuredClone(style.gradientGeometry);
  if (style.gradientType === 'radial') return { type: 'radial', center: { x: 0.5, y: 0.5 }, radiusX: 0.5, radiusY: 0.5 };
  const width = Math.max(0.001, frame.width), height = Math.max(0.001, frame.height);
  const angle = finite(style.gradientAngle) * Math.PI / 180, dx = Math.cos(angle), dy = Math.sin(angle);
  const half = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  return { type: 'linear', start: { x: 0.5 - dx * half / width, y: 0.5 - dy * half / height }, end: { x: 0.5 + dx * half / width, y: 0.5 + dy * half / height } };
}

export function gradientGeometryToPixels(geometry: GradientGeometry, frame: Bounds): GradientGeometry {
  const point = (p: Point): Point => ({ x: frame.x + p.x * Math.max(0.001, frame.width), y: frame.y + p.y * Math.max(0.001, frame.height) });
  return geometry.type === 'linear' ? { type: 'linear', start: point(geometry.start), end: point(geometry.end) }
    : { ...geometry, type: 'radial', center: point(geometry.center), radiusX: geometry.radiusX * Math.max(0.001, frame.width), radiusY: geometry.radiusY * Math.max(0.001, frame.height) };
}

export function gradientStops(style: TextStyle): GradientStop[] {
  validateGradientStyle(style);
  const stops = (style.gradientStops ?? []).map(stop => ({ ...stop })).sort((a, b) => a.offset - b.offset);
  return stops.length >= 2 ? stops : [{ offset: 0, color: style.fill }, { offset: 1, color: style.fill2 }];
}

export function gradientRenderStops(style: TextStyle): GradientStop[] {
  const stops = gradientStops(style), output: GradientStop[] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i], next = stops[i + 1];
    output.push(stop);
    if (next && stop.midpoint !== undefined && stop.midpoint !== 0.5 && next.offset > stop.offset) {
      const color = '#' + [1, 3, 5].map(c => Math.round((parseInt(stop.color.slice(c, c + 2), 16) + parseInt(next.color.slice(c, c + 2), 16)) / 2).toString(16).padStart(2, '0')).join('');
      output.push({ offset: stop.offset + (next.offset - stop.offset) * stop.midpoint, color });
    }
  }
  return output;
}

function gradientMarkup(id: string, style: TextStyle, geometry: Rect): string {
  const centerX = (geometry.minX + geometry.maxX) / 2;
  const centerY = (geometry.minY + geometry.maxY) / 2;
  const width = Math.max(0.001, geometry.maxX - geometry.minX);
  const height = Math.max(0.001, geometry.maxY - geometry.minY);
  const stops = gradientRenderStops(style).map(stop => `<stop offset="${number(stop.offset)}" stop-color="${xml(stop.color)}"/>`).join('');
  if (style.gradientGeometry) {
    const mapped = gradientGeometryToPixels(style.gradientGeometry, { x: geometry.minX, y: geometry.minY, width, height });
    if (mapped.type === 'radial') return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${number(mapped.center.x)} ${number(mapped.center.y)})${mapped.rotation ? ` rotate(${number(mapped.rotation)})` : ''} scale(${number(mapped.radiusX)} ${number(mapped.radiusY)})">${stops}</radialGradient>`;
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${number(mapped.start.x)}" y1="${number(mapped.start.y)}" x2="${number(mapped.end.x)}" y2="${number(mapped.end.y)}">${stops}</linearGradient>`;
  }
  if (style.gradientType === 'radial') {
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${number(centerX)} ${number(centerY)}) scale(${number(width / 2)} ${number(height / 2)})">${stops}</radialGradient>`;
  }
  const angle = finite(style.gradientAngle) * Math.PI / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const length = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${number(centerX - dx * length)}" y1="${number(centerY - dy * length)}" x2="${number(centerX + dx * length)}" y2="${number(centerY + dy * length)}">${stops}</linearGradient>`;
}

function materialGrain(id: string, paper: boolean): string {
  let seed = 0x4f1bbcdc;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let marks = '';
  for (let i = 0; i < 48; i += 1) {
    const x = random() * 64;
    const y = random() * 64;
    const opacity = 0.15 + random() * 0.5;
    const color = paper && i % 3 ? '#30251d' : '#ffffff';
    if (paper && i % 4 === 0) {
      marks += `<path d="M${number(x)} ${number(y)}l${number(1 + random() * 4)} ${number(random() * 1.2 - 0.6)}" stroke="${color}" stroke-width="0.45" opacity="${number(opacity)}"/>`;
    } else {
      marks += `<circle cx="${number(x)}" cy="${number(y)}" r="${number(0.25 + random() * 0.65)}" fill="${color}" opacity="${number(opacity)}"/>`;
    }
  }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="64" height="64">${marks}</pattern>`;
}

function materialMarkup(prefix: string, style: TextStyle, geometry: Rect, shapeId: string): { defs: string; paint: string } {
  const kind = style.material ?? 'none';
  const strength = unit(style.materialStrength, 0.8);
  if (kind === 'none' || strength === 0) return { defs: '', paint: '' };
  const width = Math.max(0.001, geometry.maxX - geometry.minX);
  const height = Math.max(0.001, geometry.maxY - geometry.minY);
  const edge = Math.max(0.75, Math.min(14, Math.min(width, height) * 0.045));
  const lightId = `${prefix}-material-light`;
  const grainId = `${prefix}-material-grain`;
  const glowId = `${prefix}-material-glow`;
  const rect = (fill: string, opacity = 1): string => `<rect x="${number(geometry.minX)}" y="${number(geometry.minY)}" width="${number(width)}" height="${number(height)}" fill="${fill}" opacity="${number(opacity)}"/>`;
  const use = (attributes: string): string => `<use href="#${shapeId}"${attributes}/>`;
  const stops = (values: [number, string, number][]): string => values.map(([offset, color, opacity]) => `<stop offset="${number(offset)}" stop-color="${color}" stop-opacity="${number(opacity)}"/>`).join('');
  const band = (values: [number, string, number][], diagonal = false): string => `<linearGradient id="${lightId}" gradientUnits="userSpaceOnUse" x1="${number(geometry.minX)}" y1="${number(geometry.minY)}" x2="${number(diagonal ? geometry.maxX : geometry.minX)}" y2="${number(geometry.maxY)}">${stops(values)}</linearGradient>`;
  let defs = '';
  let paint = '';
  switch (kind) {
    case 'metal':
      defs = band([[0, '#ffffff', 0.65], [0.18, '#081322', 0.65], [0.38, '#ffffff', 0.3], [0.46, '#ffffff', 0.95], [0.5, '#081322', 0.8], [0.64, '#081322', 0.15], [0.86, '#ffffff', 0.65], [1, '#081322', 0.65]]);
      defs += `<pattern id="${grainId}" patternUnits="userSpaceOnUse" width="7" height="4"><path d="M0 0.8H7" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.5"/><path d="M0 2.8H7" stroke="#182437" stroke-opacity="0.22" stroke-width="0.45"/></pattern>`;
      paint = rect(`url(#${lightId})`) + rect(`url(#${grainId})`, 0.5) + use(` fill="none" stroke="#ffffff" stroke-width="${number(edge * 0.4)}" opacity="0.5"`);
      break;
    case 'glass':
      defs = band([[0, '#ffffff', 0.55], [0.26, '#ffffff', 0.12], [0.34, '#ffffff', 0.8], [0.43, '#ffffff', 0.05], [0.7, '#16283c', 0.18], [0.83, '#ffffff', 0.45], [1, '#ffffff', 0.08]], true) + materialGrain(grainId, false);
      paint = rect('#ffffff', 0.12) + rect(`url(#${lightId})`) + rect(`url(#${grainId})`, 0.65) + use(` fill="none" stroke="#ffffff" stroke-width="${number(edge * 1.25)}" opacity="0.65"`) + use(` fill="none" stroke="#172f4b" stroke-width="${number(edge * 0.35)}" opacity="0.35"`);
      break;
    case 'jelly':
      defs = `<radialGradient id="${lightId}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${number(geometry.minX + width * 0.35)} ${number(geometry.minY + height * 0.2)}) scale(${number(width * 0.8)} ${number(height * 0.95)})">${stops([[0, '#ffffff', 0.95], [0.13, '#ffffff', 0.55], [0.32, '#ffffff', 0], [0.72, '#38094f', 0.08], [1, '#310346', 0.48]])}</radialGradient>`;
      paint = rect(`url(#${lightId})`) + use(` fill="none" stroke="#300c48" stroke-width="${number(edge * 2.4)}" opacity="0.2"`) + use(` fill="none" stroke="#ffffff" stroke-width="${number(edge * 0.55)}" opacity="0.65"`) + `<ellipse cx="${number(geometry.minX + width * 0.28)}" cy="${number(geometry.minY + height * 0.19)}" rx="${number(width * 0.18)}" ry="${number(height * 0.045)}" fill="#ffffff" opacity="0.65"/>`;
      break;
    case 'paper':
      defs = materialGrain(grainId, true);
      paint = rect('#eee4cf', 0.15) + rect(`url(#${grainId})`, 0.85) + use(` fill="none" stroke="#635440" stroke-width="${number(edge * 0.5)}" opacity="0.22"`);
      break;
    case 'neon': {
      const blur = edge * 1.2;
      defs = `<filter id="${glowId}" filterUnits="userSpaceOnUse" x="${number(geometry.minX - blur * 4)}" y="${number(geometry.minY - blur * 4)}" width="${number(width + blur * 8)}" height="${number(height + blur * 8)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${number(blur)}"/></filter>`;
      defs += band([[0, '#ffffff', 0.35], [0.24, '#ffffff', 0.02], [0.51, '#ffffff', 0.45], [0.6, '#ffffff', 0], [1, '#ffffff', 0.15]], true);
      paint = rect('#060718', 0.62) + use(` fill="none" stroke="${xml(style.fill2)}" stroke-width="${number(edge * 5)}" filter="url(#${glowId})" opacity="0.95"`) + use(` fill="none" stroke="${xml(style.fill)}" stroke-width="${number(edge * 1.8)}"`) + use(` fill="none" stroke="#ffffff" stroke-width="${number(edge * 0.5)}" opacity="0.95"`) + rect(`url(#${lightId})`, 0.3);
      break;
    }
  }
  return { defs, paint: `<g opacity="${number(strength)}" data-material="${kind}">${paint}</g>` };
}

function embeddedImage(source: string): string {
  if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(source)) {
    throw new Error('Image layers must use an embedded base64 image data URL.');
  }
  return xml(source.replace(/\s/g, ''));
}

function paintedLayerSvg(layer: Layer, outputScale: number, geometry: Rect): string {
  const style = layer.style, prefix = idPrefix(layer.id);
  const bodyGlyphs = layer.glyphs.filter(glyph => glyph.paint?.silhouette !== false && unit(glyph.paint?.opacity) > 0 && (glyph.paint?.fill !== 'none' || glyph.paint.stroke !== 'none' && positive(glyph.paint.strokeWidth ?? style.strokeWidth) > 0));
  const silhouetteId = `${prefix}-paint-silhouette`, gradientId = `${prefix}-paint-gradient`;
  const shadowId = `${prefix}-paint-shadow`, maskId = `${prefix}-paint-surface`;
  const silhouettes = bodyGlyphs.map(glyph => {
    const shape = shapeMarkup({ ...layer, glyphs: [glyph] });
    return glyph.paint?.fill === 'none' ? shape.replace('/>', ' fill="none"/>') : shape;
  }).join('');
  const bounds = renderedBounds(layer, localGeometry(layer));
  const area = `x="${number(bounds.minX)}" y="${number(bounds.minY)}" width="${number(bounds.maxX - bounds.minX)}" height="${number(bounds.maxY - bounds.minY)}"`;
  const maxStroke = Math.max(positive(style.strokeWidth), ...bodyGlyphs.map(glyph => positive(glyph.paint?.strokeWidth)));
  const outerWidth = maxStroke + positive(style.outerWidth) * 2;
  const use = (attributes: string): string => `<use href="#${silhouetteId}"${attributes}/>`;
  const color = (value: string | undefined, gradient = false): string => {
    if (value === 'none') return 'none';
    if (!value || value === 'primary') return gradient && style.gradient ? `url(#${gradientId})` : xml(style.fill);
    if (value === 'secondary') return xml(style.fill2);
    if (value === 'ink') return xml(style.stroke);
    if (value === 'paper') return xml(style.outerStroke);
    return xml(value);
  };
  const shadowEnabled = positive(style.shadowBlur) > 0 || finite(style.shadowX) !== 0 || finite(style.shadowY) !== 0;
  const shadow = `<filter id="${shadowId}" filterUnits="userSpaceOnUse" ${area} color-interpolation-filters="sRGB"><feDropShadow dx="${number(style.shadowX)}" dy="${number(style.shadowY)}" stdDeviation="${number(positive(style.shadowBlur))}" flood-color="${xml(style.shadowColor)}"/></filter>`;
  const material = materialMarkup(`${prefix}-paint`, style, geometry, silhouetteId);
  const inset = Math.max(0.5, 1.5 / Math.max(0.000001, Math.min(Math.abs(finite(layer.scaleX, 1)), Math.abs(finite(layer.scaleY, 1))) * outputScale));
  const surfaceMask = `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" ${area}>${use(` fill="#ffffff" stroke="#000000" stroke-width="${number(inset * 2)}"`)}</mask>`;
  let artwork = '';
  const depth = positive(style.depth);
  if (depth > 0 && silhouettes) {
    const steps = Math.max(1, Math.min(128, Math.ceil(depth)));
    for (let step = steps; step > 0; step -= 1) {
      const offset = depth * step / steps;
      artwork += use(` transform="translate(${number(offset * DEPTH_X)} ${number(offset)})" fill="${xml(style.depthColor)}" stroke="${xml(style.depthColor)}" stroke-width="${number(outerWidth)}"`);
    }
  }
  if (positive(style.outerWidth) > 0 && silhouettes) artwork += use(` fill="${xml(style.outerStroke)}" stroke="${xml(style.outerStroke)}" stroke-width="${number(outerWidth)}"`);
  for (const glyph of layer.glyphs.filter(drawable)) {
    const paint = glyph.paint;
    const stroke = paint?.stroke ?? (paint?.silhouette === false ? 'none' : 'ink');
    const strokeWidth = paint?.strokeWidth === undefined ? positive(style.strokeWidth) : positive(paint.strokeWidth);
    const attributes = ` data-part-id="${xml(glyph.id)}" fill="${color(paint?.fill, true)}" stroke="${color(stroke)}" stroke-width="${number(strokeWidth)}" opacity="${number(unit(paint?.opacity))}" paint-order="stroke fill"`;
    artwork += shapeMarkup({ ...layer, glyphs: [glyph] }).replace('/>', `${attributes}/>`);
  }
  let overlay = '';
  if (style.texture !== 'none' && unit(style.textureOpacity, 0) > 0) overlay += `<rect ${area} fill="url(#${prefix}-paint-texture)" opacity="${number(unit(style.textureOpacity, 0))}"/>`;
  if (style.gloss) overlay += `<rect ${area} fill="url(#${prefix}-paint-gloss)"/>`;
  overlay += material.paint;
  if (overlay) artwork += `<g mask="url(#${maskId})">${overlay}</g>`;
  const texture = style.texture === 'stripes'
    ? `<pattern id="${prefix}-paint-texture" patternUnits="userSpaceOnUse" width="13" height="13" patternTransform="rotate(-35)"><path d="M3 0V13" fill="none" stroke="${xml(style.textureColor)}" stroke-width="4"/></pattern>`
    : `<pattern id="${prefix}-paint-texture" patternUnits="userSpaceOnUse" width="16" height="16"><circle cx="4" cy="4" r="1.7" fill="${xml(style.textureColor)}"/><circle cx="12" cy="12" r="1.7" fill="${xml(style.textureColor)}"/></pattern>`;
  const gloss = `<linearGradient id="${prefix}-paint-gloss" gradientUnits="userSpaceOnUse" x1="0" y1="${number(geometry.minY)}" x2="0" y2="${number(geometry.maxY)}"><stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="0.48" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`;
  return `<g data-layer-id="${xml(layer.id)}" transform="${layerTransform(layer)}" opacity="${number(unit(style.opacity))}"><defs><g id="${silhouetteId}">${silhouettes}</g>${gradientMarkup(gradientId, style, geometry)}${shadow}${texture}${gloss}${surfaceMask}${material.defs}</defs><g stroke-linejoin="round" stroke-linecap="round"${shadowEnabled ? ` filter="url(#${shadowId})"` : ''}>${artwork}</g></g>`;
}

function renderLayerSvg(parent: Layer, outputScale: number, glyphIndices?: readonly number[]): string {
  validateGradientStyle(parent.style);
  const geometry = localGeometry(parent);
  const layer = glyphIndices ? { ...parent, glyphs: glyphIndices.map(index => {
    if (!Number.isInteger(index) || index < 0 || index >= parent.glyphs.length) throw new RangeError('Glyph selection index is out of range.');
    return parent.glyphs[index];
  }) } : parent;
  if (!paintable(layer) || !hasRect(localGeometry(layer)) || !hasRect(geometry)) return '';
  if (layer.kind !== 'image' && parent.glyphs.some(glyph => glyph.paint)) return paintedLayerSvg(layer, outputScale, geometry);
  const style = layer.style;
  const prefix = idPrefix(layer.id);
  const shapeId = `${prefix}-shape`;
  const shadowId = `${prefix}-shadow`;
  const gradientId = `${prefix}-gradient`;
  const textureId = `${prefix}-texture`;
  const clipId = `${prefix}-clip`;
  const glossId = `${prefix}-gloss`;
  const bounds = renderedBounds(layer, localGeometry(layer));
  const shadow = `<filter id="${shadowId}" filterUnits="userSpaceOnUse" x="${number(bounds.minX)}" y="${number(bounds.minY)}" width="${number(bounds.maxX - bounds.minX)}" height="${number(bounds.maxY - bounds.minY)}" color-interpolation-filters="sRGB"><feDropShadow dx="${number(style.shadowX)}" dy="${number(style.shadowY)}" stdDeviation="${number(positive(style.shadowBlur))}" flood-color="${xml(style.shadowColor)}"/></filter>`;
  const attributes = `data-layer-id="${xml(layer.id)}" transform="${layerTransform(layer)}" opacity="${number(unit(style.opacity))}"`;
  const shadowEnabled = positive(style.shadowBlur) > 0 || finite(style.shadowX) !== 0 || finite(style.shadowY) !== 0;
  const filter = shadowEnabled ? ` filter="url(#${shadowId})"` : '';
  if (layer.kind === 'image') {
    return `<g ${attributes}><defs>${shadow}</defs><image x="0" y="0" width="${number(layer.width)}" height="${number(layer.height)}" preserveAspectRatio="none" href="${embeddedImage(layer.imageSrc!)}"${filter}/></g>`;
  }

  const shapes = shapeMarkup(layer);
  const gradient = gradientMarkup(gradientId, style, geometry);
  const material = materialMarkup(prefix, style, geometry, shapeId);
  const gloss = `<linearGradient id="${glossId}" gradientUnits="userSpaceOnUse" x1="0" y1="${number(geometry.minY)}" x2="0" y2="${number(geometry.maxY)}"><stop offset="0" stop-color="#fff" stop-opacity="0.76"/><stop offset="0.36" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.52" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const texture = style.texture === 'stripes'
    ? `<pattern id="${textureId}" patternUnits="userSpaceOnUse" width="13" height="13" patternTransform="rotate(-35)"><path d="M3 0V13" fill="none" stroke="${xml(style.textureColor)}" stroke-width="4"/></pattern>`
    : `<pattern id="${textureId}" patternUnits="userSpaceOnUse" width="16" height="16"><circle cx="4" cy="4" r="1.7" fill="${xml(style.textureColor)}"/><circle cx="12" cy="12" r="1.7" fill="${xml(style.textureColor)}"/></pattern>`;
  const surfaceMaskId = `${prefix}-surface-alpha`;
  const surfacePadding = Math.max(2, 2 / Math.max(0.000001, Math.min(Math.abs(finite(layer.scaleX, 1)), Math.abs(finite(layer.scaleY, 1))) * outputScale));
  const surfaceArea = `x="${number(geometry.minX - surfacePadding)}" y="${number(geometry.minY - surfacePadding)}" width="${number(geometry.maxX - geometry.minX + surfacePadding * 2)}" height="${number(geometry.maxY - geometry.minY + surfacePadding * 2)}"`;
  const surfaceMask = material.paint ? `<mask id="${surfaceMaskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" ${surfaceArea}><use href="#${shapeId}" fill="#ffffff"/></mask>` : '';
  const defs = `<defs><g id="${shapeId}">${shapes}</g><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shapes}</clipPath>${gradient}${shadow}${texture}${gloss}${material.defs}${surfaceMask}</defs>`;
  const use = (attributes: string): string => `<use href="#${shapeId}"${attributes}/>`;
  const strokeWidth = positive(style.strokeWidth);
  const outerWidth = strokeWidth + positive(style.outerWidth) * 2;
  const depth = positive(style.depth);
  let artwork = '';
  if (depth > 0) {
    const steps = Math.max(1, Math.min(128, Math.ceil(depth)));
    for (let step = steps; step > 0; step -= 1) {
      const offset = depth * step / steps;
      artwork += use(` transform="translate(${number(offset * DEPTH_X)} ${number(offset)})" fill="${xml(style.depthColor)}" stroke="${xml(style.depthColor)}" stroke-width="${number(outerWidth)}"`);
    }
  }
  if (positive(style.outerWidth) > 0) {
    artwork += use(` fill="${xml(style.outerStroke)}" stroke="${xml(style.outerStroke)}" stroke-width="${number(outerWidth)}"`);
  }
  if (strokeWidth > 0) {
    artwork += use(` fill="${xml(style.stroke)}" stroke="${xml(style.stroke)}" stroke-width="${number(strokeWidth)}"`);
  }
  const surface = (fill: string, opacity = 1): string => material.paint
    ? `<rect ${surfaceArea} fill="${fill}" opacity="${number(opacity)}"/>`
    : use(` fill="${fill}"${opacity === 1 ? '' : ` opacity="${number(opacity)}"`}`);
  let face = surface(style.gradient ? `url(#${gradientId})` : xml(style.fill));
  if (style.texture !== 'none' && unit(style.textureOpacity, 0) > 0) {
    const paint = surface(`url(#${textureId})`, unit(style.textureOpacity, 0));
    face += material.paint ? paint : `<g clip-path="url(#${clipId})">${paint}</g>`;
  }
  if (style.gloss) face += surface(`url(#${glossId})`);
  face += material.paint;
  artwork += material.paint ? `<g mask="url(#${surfaceMaskId})">${face}</g>` : face;
  return `<g ${attributes}>${defs}<g stroke-linejoin="round" stroke-linecap="round"${filter}>${artwork}</g></g>`;
}

export function layerSvg(layer: Layer): string {
  return renderLayerSvg(layer, 1);
}

export function layerSubsetSvg(layer: Layer, glyphIndices: readonly number[], outputScale = 1): string {
  if (!Number.isFinite(outputScale) || outputScale <= 0) throw new RangeError('Export scale must be a positive finite number.');
  if (new Set(glyphIndices).size !== glyphIndices.length) throw new RangeError('Glyph selection indices must be unique.');
  return renderLayerSvg(layer, outputScale, glyphIndices);
}

function exportArea(project: Project, options: Partial<ExportOptions>): Bounds {
  if (options.crop) {
    const bounds = contentBounds(project);
    if (bounds.width > 0 && bounds.height > 0) {
      const padding = positive(options.padding);
      return { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
    }
  }
  return { x: 0, y: 0, width: Math.max(1, finite(project.width, 1)), height: Math.max(1, finite(project.height, 1)) };
}

function exportScale(options: Partial<ExportOptions>): number {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Export scale must be a positive finite number.');
  return scale;
}

export function projectSvg(project: Project, options: Partial<ExportOptions> = {}): string {
  const area = exportArea(project, options);
  const scale = exportScale(options);
  const width = Math.max(1, Math.ceil(area.width * scale));
  const height = Math.max(1, Math.ceil(area.height * scale));
  return `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${number(area.x)} ${number(area.y)} ${number(area.width)} ${number(area.height)}" preserveAspectRatio="xMidYMid meet"><title>${xml(project.name)}</title>${project.layers.filter(paintable).map(layer => renderLayerSvg(layer, scale)).join('')}</svg>`;
}

export async function exportPng(project: Project, options: ExportOptions): Promise<Blob> {
  const area = exportArea(project, options);
  const scale = exportScale(options);
  const width = Math.max(1, Math.ceil(area.width * scale));
  const height = Math.max(1, Math.ceil(area.height * scale));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 32767 || height > 32767 || width * height > 268435456) {
    throw new RangeError('The export exceeds the canvas size limit. Reduce the export scale.');
  }
  const source = new Blob([projectSvg(project, options)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The SVG could not be decoded for PNG export.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('A 2D canvas context is required for PNG export.');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The canvas did not produce a PNG.')), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Revocation after the click lets browsers finish consuming the download URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function newId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  sequence += 1;
  return `layer-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneLayer(layer: Layer): Layer {
  const glyphIds = new Map<string, string>();
  const copyGlyph = (glyph: Glyph): Glyph => {
    let id = glyphIds.get(glyph.id);
    if (!id) { id = newId(); glyphIds.set(glyph.id, id); }
    return { ...glyph, id, ...(glyph.paint ? { paint: { ...glyph.paint } } : {}), commands: glyph.commands.map(command => ({ ...command })) };
  };
  return {
    ...layer,
    id: newId(),
    name: `${layer.name} 副本`,
    x: finite(layer.x) + 24,
    y: finite(layer.y) + 24,
    style: structuredClone(layer.style),
    ...(layer.letterform ? { letterform: { ...structuredClone(layer.letterform), sourceGlyphs: layer.letterform.sourceGlyphs.map(copyGlyph) } } : {}),
    glyphs: layer.glyphs.map(copyGlyph),
  };
}
