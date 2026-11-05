import type { Glyph } from './types';

export type Point = { x: number; y: number };
export type GlyphCorner = 0 | 1 | 2 | 3;

export const MIN_GLYPH_SCALE = 0.05;
export const MAX_GLYPH_SCALE = 20;

const finite = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function clampGlyphScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_GLYPH_SCALE, Math.max(MIN_GLYPH_SCALE, value));
}

export function glyphScale(glyph: Glyph): Point {
  return { x: clampGlyphScale(finite(glyph.scaleX, 1)), y: clampGlyphScale(finite(glyph.scaleY, 1)) };
}

/** Maps an unscaled glyph-local point (0..width, 0..height) into layer space. */
export function glyphBoxPoint(glyph: Glyph, x: number, y: number): Point {
  const scale = glyphScale(glyph);
  const centerX = finite(glyph.width, 0) / 2;
  const centerY = finite(glyph.height, 0) / 2;
  const radians = finite(glyph.rotation, 0) * Math.PI / 180;
  const dx = (x - centerX) * scale.x;
  const dy = (y - centerY) * scale.y;
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians) + centerX + finite(glyph.x, 0),
    y: dx * Math.sin(radians) + dy * Math.cos(radians) + centerY + finite(glyph.y, 0),
  };
}

/** The four corners of the glyph box, clockwise from the top-left, in layer space. */
export function glyphCorners(glyph: Glyph): Point[] {
  const width = Math.max(0, finite(glyph.width, 0));
  const height = Math.max(0, finite(glyph.height, 0));
  return [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => glyphBoxPoint(glyph, x, y));
}

/** Layer-space point back into the glyph's own unscaled coordinates (0..width, 0..height). */
export function layerToGlyphLocal(glyph: Glyph, point: Point): Point {
  const scale = glyphScale(glyph);
  const centerX = finite(glyph.width, 0) / 2;
  const centerY = finite(glyph.height, 0) / 2;
  const radians = -finite(glyph.rotation, 0) * Math.PI / 180;
  const dx = point.x - finite(glyph.x, 0) - centerX;
  const dy = point.y - finite(glyph.y, 0) - centerY;
  return {
    x: (dx * Math.cos(radians) - dy * Math.sin(radians)) / scale.x + centerX,
    y: (dx * Math.sin(radians) + dy * Math.cos(radians)) / scale.y + centerY,
  };
}

/**
 * Scale and offset of the glyph while `corner` is dragged to `point`, keeping the opposite corner fixed.
 * `uniform` locks both axes to whichever one the pointer moved further along.
 */
export function resizeGlyph(glyph: Glyph, corner: GlyphCorner, point: Point, uniform = false): { scaleX: number; scaleY: number; x: number; y: number } {
  const width = Math.max(1, finite(glyph.width, 1));
  const height = Math.max(1, finite(glyph.height, 1));
  const handle = [[0, 0], [width, 0], [width, height], [0, height]][corner];
  const anchor = [[width, height], [0, height], [0, 0], [width, 0]][corner];
  const local = layerToGlyphLocal(glyph, point);
  const base = glyphScale(glyph);
  const ratio = (value: number, from: number, to: number) =>
    Math.abs(to - from) < 1e-6 ? 1 : (value - from) / (to - from);
  let factorX = ratio(local.x, anchor[0], handle[0]);
  let factorY = ratio(local.y, anchor[1], handle[1]);
  if (uniform) {
    const factor = Math.abs(factorX) > Math.abs(factorY) ? factorX : factorY;
    factorX = factor;
    factorY = factor;
  }
  const scaleX = clampGlyphScale(base.x * factorX);
  const scaleY = clampGlyphScale(base.y * factorY);
  const before = glyphBoxPoint(glyph, anchor[0], anchor[1]);
  const after = glyphBoxPoint({ ...glyph, scaleX, scaleY }, anchor[0], anchor[1]);
  return {
    scaleX,
    scaleY,
    x: Math.round((finite(glyph.x, 0) + before.x - after.x) * 1000) / 1000,
    y: Math.round((finite(glyph.y, 0) + before.y - after.y) * 1000) / 1000,
  };
}

/** Rotation of the glyph while its handle is dragged from `start` to `current` (both layer space). */
export function rotateGlyph(glyph: Glyph, start: Point, current: Point, snap = false): number {
  const centerX = finite(glyph.x, 0) + finite(glyph.width, 0) / 2;
  const centerY = finite(glyph.y, 0) + finite(glyph.height, 0) / 2;
  const angle = (point: Point) => Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI;
  let rotation = finite(glyph.rotation, 0) + (angle(current) - angle(start));
  if (snap) rotation = Math.round(rotation / 15) * 15;
  rotation %= 360;
  if (rotation > 180) rotation -= 360;
  if (rotation <= -180) rotation += 360;
  return Math.round(rotation * 1000) / 1000;
}
