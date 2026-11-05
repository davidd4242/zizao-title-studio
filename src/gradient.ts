import type { Bounds, GradientGeometry, GradientPoint, GradientStop, TextStyle } from './types';
import { gradientGeometryToPixels, resolveGradientGeometry } from './engine';

export type GradientHandle = 'start' | 'end' | 'center' | 'radiusX' | 'radiusY';
export const normalizedPoint = (p: GradientPoint, frame: Bounds): GradientPoint => ({ x: (p.x - frame.x) / frame.width, y: (p.y - frame.y) / frame.height });
export function gradientMetrics(style: TextStyle, frame: Bounds) {
  const g = gradientGeometryToPixels(resolveGradientGeometry(style, frame), frame);
  if (g.type === 'radial') return { angle: g.rotation ?? 0, length: g.radiusX * 2, center: g.center, radiusX: g.radiusX, radiusY: g.radiusY };
  return { angle: (Math.atan2(g.end.y - g.start.y, g.end.x - g.start.x) * 180 / Math.PI + 360) % 360, length: Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y), center: { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 }, radiusX: 0, radiusY: 0 };
}
export function gradientPatch(geometry: GradientGeometry, frame: Bounds): Partial<TextStyle> {
  return { gradientGeometry: geometry, gradientType: geometry.type, ...(geometry.type === 'linear' ? { gradientAngle: gradientMetrics({ gradientGeometry: geometry } as TextStyle, frame).angle } : {}) };
}
export function setGradientMetrics(style: TextStyle, frame: Bounds, patch: Partial<{ angle: number; length: number; centerX: number; centerY: number; radiusX: number; radiusY: number }>): Partial<TextStyle> {
  const geometry = resolveGradientGeometry(style, frame), metrics = gradientMetrics(style, frame);
  const center = { x: patch.centerX ?? metrics.center.x, y: patch.centerY ?? metrics.center.y };
  if (geometry.type === 'radial') return gradientPatch({ ...geometry, rotation: patch.angle ?? geometry.rotation, center: normalizedPoint(center, frame), radiusX: (patch.radiusX ?? metrics.radiusX) / frame.width, radiusY: (patch.radiusY ?? metrics.radiusY) / frame.height }, frame);
  const a = (patch.angle ?? metrics.angle) * Math.PI / 180, half = (patch.length ?? metrics.length) / 2;
  return gradientPatch({ type: 'linear', start: normalizedPoint({ x: center.x - Math.cos(a) * half, y: center.y - Math.sin(a) * half }, frame), end: normalizedPoint({ x: center.x + Math.cos(a) * half, y: center.y + Math.sin(a) * half }, frame) }, frame);
}
export function gradientHandlePoint(geometry: GradientGeometry, handle: GradientHandle): GradientPoint {
  if (geometry.type === 'linear') return handle === 'start' ? geometry.start : geometry.end;
  const angle = (geometry.rotation ?? 0) * Math.PI / 180;
  return handle === 'radiusX' ? { x: geometry.center.x + Math.cos(angle) * geometry.radiusX, y: geometry.center.y + Math.sin(angle) * geometry.radiusX } : handle === 'radiusY' ? { x: geometry.center.x - Math.sin(angle) * geometry.radiusY, y: geometry.center.y + Math.cos(angle) * geometry.radiusY } : { ...geometry.center };
}
export function moveGradientHandle(style: TextStyle, frame: Bounds, handle: GradientHandle, p: GradientPoint, snap = false): Partial<TextStyle> {
  const geometry = resolveGradientGeometry(style, frame), pixels = gradientGeometryToPixels(geometry, frame);
  if (geometry.type === 'linear' && pixels.type === 'linear' && (handle === 'start' || handle === 'end')) {
    const anchor = handle === 'start' ? pixels.end : pixels.start;
    const length = Math.max(0.01, Math.hypot(p.x - anchor.x, p.y - anchor.y));
    let angle = Math.atan2(p.y - anchor.y, p.x - anchor.x);
    if (snap) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
    geometry[handle] = normalizedPoint({ x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length }, frame);
  } else if (geometry.type === 'radial' && pixels.type === 'radial') {
    if (handle === 'center') geometry.center = normalizedPoint(p, frame);
    if (handle === 'radiusX' || handle === 'radiusY') {
      const length = Math.max(0.01, Math.hypot(p.x - pixels.center.x, p.y - pixels.center.y));
      let angle = Math.atan2(p.y - pixels.center.y, p.x - pixels.center.x) - (handle === 'radiusY' ? Math.PI / 2 : 0);
      if (snap) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
      geometry.rotation = (angle * 180 / Math.PI + 360) % 360;
      if (handle === 'radiusX') {
        geometry.radiusX = length / frame.width;
        geometry.radiusY *= length / pixels.radiusX;
      } else geometry.radiusY = length / frame.height;
    }
  }
  return gradientPatch(geometry, frame);
}
export function reverseGradientStops(stops: GradientStop[]): GradientStop[] {
  const mirror = (value: number) => Math.round((1 - value) * 1e6) / 1e6;
  return stops.map((stop, index) => {
    const previous = stops[index - 1];
    return { offset: mirror(stop.offset), color: stop.color, ...(previous?.midpoint !== undefined ? { midpoint: mirror(previous.midpoint) } : {}) };
  }).reverse();
}
