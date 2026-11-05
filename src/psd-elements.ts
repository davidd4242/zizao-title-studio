import type { Layer, Project } from './types';

export type PsdElement = { name: string; glyphIndices: number[] };
export type PsdElementGroup = { layer: Layer; elements: PsdElement[] };

/** Indices preserve duplicate glyph ids; letterform strokes stay with their source character. */
export function psdElementGroups(project: Project): PsdElementGroup[] {
  return project.layers.map(layer => {
    if (layer.kind === 'image') return { layer, elements: [{ name: layer.name, glyphIndices: [] }] };
    const owners = layer.letterform?.sourceGlyphs.map(glyph => glyph.id).sort((a, b) => b.length - a.length) ?? [];
    const ownerId = (id: string) => owners.find(owner => id.startsWith(`${owner}:letterform:`));
    const elements: PsdElement[] = [];
    const bodies = new Map<string, PsdElement>();
    for (const [index, glyph] of layer.glyphs.entries()) {
      if (ownerId(glyph.id)) continue;
      const label = glyph.char.trim() || (glyph.char ? '空白' : layer.kind === 'sticker' ? '部件' : '路径');
      const element = { name: `${label} · ${elements.length + 1}`, glyphIndices: [index] };
      elements.push(element);
      bodies.set(glyph.id, element);
    }
    for (const [index, glyph] of layer.glyphs.entries()) {
      const owner = ownerId(glyph.id);
      if (!owner) continue;
      const element = bodies.get(owner);
      if (element) element.glyphIndices.push(index);
      else elements.push({ name: `装饰 · ${elements.length + 1}`, glyphIndices: [index] });
    }
    for (const element of elements) element.glyphIndices.sort((a, b) => a - b);
    return { layer, elements };
  });
}

export function psdGroupOpacity(layer: Layer): number {
  const opacity = Number.isFinite(layer.style.opacity) ? layer.style.opacity : 1;
  return Math.round(Math.min(1, Math.max(0, opacity)) * 255) / 255;
}
