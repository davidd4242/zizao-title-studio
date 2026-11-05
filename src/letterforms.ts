import type { Command, Glyph, Layer, LetterformState } from './types';
import { reshapeOutline } from './letterform-geometry';

type Point = { x: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number };
type Preset = { id: string; name: string; category: 'flourish' | 'gothic'; description: string };
type Profile = { width: number; height: number; slant: number };

export const LETTERFORM_PRESETS: Preset[] = [
  { id: 'flourish-slanted', name: '斜连笔', category: 'flourish', description: '右倾粗干与细横，词首尾舒展收笔；同排相邻拉丁字形轻连笔。' },
  { id: 'flourish-swash', name: '卷尾花体', category: 'flourish', description: '柔曲字身与从词尾笔端伸出的长回卷，保留主体字腔。' },
  { id: 'flourish-royal', name: '华丽回旋', category: 'flourish', description: '高对比粗细与上挑笔端，首尾反向长弧，中间字保持克制。' },
  { id: 'flourish-ribbon', name: '丝带花体', category: 'flourish', description: '宽重斜身，局部宽窄随笔势变化，词尾宽弧渐细收尖。' },
  { id: 'flourish-vine', name: '藤蔓花体', category: 'flourish', description: '细长流动字身与词边细弧，粗根部渐收为轻盈长尖。' },
  { id: 'gothic-spire', name: '紧凑尖顶', category: 'gothic', description: '窄长粗竖配细横，外露笔端形成内凹弧与上挑尖顶。' },
  { id: 'gothic-fraktur', name: '黑体折角', category: 'gothic', description: '按弯肩分配折角，保留长侧笔，外露笔端形成斜旗锋口。' },
  { id: 'gothic-diamond', name: '菱角衬线', category: 'gothic', description: '宽直粗干与细横，外露笔端形成短菱尖衬线。' },
  { id: 'gothic-textura', name: '经文窄体', category: 'gothic', description: '窄高负形、直侧笔与切角弯肩，笔端短平收锋。' },
  { id: 'gothic-inscription', name: '碑铭楔饰', category: 'gothic', description: '宽骨架、粗竖细横，外露笔端伸出内凹宽锋口。' },
];
const profiles: Record<string, Profile> = {
  'flourish-slanted': { width: 0.94, height: 1.03, slant: 0.28 },
  'flourish-swash': { width: 1.02, height: 0.98, slant: 0.17 },
  'flourish-royal': { width: 0.94, height: 1.1, slant: 0.14 },
  'flourish-ribbon': { width: 1.1, height: 0.97, slant: 0.3 },
  'flourish-vine': { width: 0.9, height: 1.12, slant: 0.12 },
  'gothic-spire': { width: 0.78, height: 1.16, slant: 0.015 },
  'gothic-fraktur': { width: 0.9, height: 1.05, slant: 0.07 },
  'gothic-diamond': { width: 0.98, height: 1.05, slant: 0 },
  'gothic-textura': { width: 0.68, height: 1.2, slant: 0.02 },
  'gothic-inscription': { width: 1.1, height: 1.02, slant: -0.04 },
};
const coordinatePairs = [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']] as const;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const cloneGlyph = (glyph: Glyph): Glyph => ({ ...glyph, ...(glyph.paint ? { paint: { ...glyph.paint } } : {}), commands: glyph.commands.map(command => ({ ...command })) });
const cloneGlyphs = (glyphs: Glyph[]): Glyph[] => glyphs.map(cloneGlyph);
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
const end = (command: Command): Point => ({ x: command.x ?? 0, y: command.y ?? 0 });

function mapCommands(commands: Command[], map: (point: Point) => Point): Command[] {
  return commands.map(command => {
    const result = { ...command };
    for (const [x, y] of coordinatePairs) if (command[x] !== undefined && command[y] !== undefined) {
      const point = map({ x: command[x], y: command[y] });
      result[x] = point.x; result[y] = point.y;
    }
    return result;
  });
}
function bounds(commands: Command[]): Box | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const command of commands) for (const [x, y] of coordinatePairs) {
    if (command[x] === undefined || command[y] === undefined) continue;
    left = Math.min(left, command[x]); right = Math.max(right, command[x]);
    top = Math.min(top, command[y]); bottom = Math.max(bottom, command[y]);
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : undefined;
}
function hasArea(commands: Command[]): boolean {
  let origin: Point = { x: 0, y: 0 }, direction: Point | undefined;
  for (const command of commands) {
    if (command.type === 'M') { origin = end(command); direction = undefined; continue; }
    if (command.type === 'Z') continue;
    for (const [x, y] of coordinatePairs) {
      if (command[x] === undefined || command[y] === undefined) continue;
      const delta = { x: command[x] - origin.x, y: command[y] - origin.y };
      if (!direction) {
        if (delta.x !== 0 || delta.y !== 0) direction = delta;
      } else if (Math.abs(direction.x * delta.y - direction.y * delta.x) > 1e-10 * Math.max(1, Math.hypot(direction.x, direction.y) * Math.hypot(delta.x, delta.y))) return true;
    }
  }
  return false;
}
function sampleCurve(points: Point[], count = 40): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    let row = points;
    while (row.length > 1) row = row.slice(1).map((point, i) => lerp(row[i], point, index / count));
    return row[0];
  });
}
function edgeAnchor(points: Point[], top: boolean, fraction: number): Point {
  let left = Infinity, right = -Infinity, upper = Infinity, lower = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    upper = Math.min(upper, point.y); lower = Math.max(lower, point.y);
  }
  const edge = top ? upper : lower, target = mix(left, right, fraction);
  const tolerance = Math.max(0.000001, (lower - upper) * 0.005);
  let best = points[0], distance = Infinity;
  for (const point of points) if (Math.abs(point.y - edge) <= tolerance) {
    const candidateDistance = Math.abs(point.x - target);
    if (candidateDistance < distance) { best = point; distance = candidateDistance; }
  }
  return best;
}
function polygon(points: Point[]): Command[] {
  return [...points.map((point, i): Command => ({ type: i ? 'L' : 'M', ...point })), { type: 'Z' }];
}
function ribbon(points: Point[], thickness: number, taper = false): Command[] {
  const side = (sign: number): Point[] => points.map((point, i) => {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(next.x - previous.x, next.y - previous.y) || 1, t = i / (points.length - 1);
    const weight = taper ? Math.max(0.015, (0.65 + Math.sin(Math.PI * t) * 0.55) * (1 - t) ** 0.45) : 0.2 + 0.8 * Math.sin(Math.PI * t) ** 0.6;
    const radius = thickness * weight / 2;
    return { x: point.x - sign * (next.y - previous.y) / length * radius, y: point.y + sign * (next.x - previous.x) / length * radius };
  });
  return polygon([...side(1), ...side(-1).reverse()]);
}
function decoration(commands: Command[], id: string, place: (point: Point) => Point, paint?: Glyph['paint']): Glyph {
  const mapped = mapCommands(commands, place), box = bounds(mapped) ?? { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    id, char: '', x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top,
    ...(paint ? { paint: { ...paint } } : {}),
    commands: mapCommands(mapped, point => ({ x: point.x - box.left, y: point.y - box.top })),
  };
}
function wordFinish(id: string, points: Point[], size: number, amount: number, direction: number): Command[] {
  const gothic = id.startsWith('gothic-'), upper = gothic || id === 'flourish-royal' && direction < 0;
  const anchor = edgeAnchor(points, upper, direction < 0 ? 0.2 : 0.8), s = size * amount;
  if (gothic) {
    const kind = id.slice(7), width = kind === 'inscription' ? 0.12 : 0.065, height = kind === 'textura' ? 0.055 : 0.13;
    const a = { x: anchor.x - s * width, y: anchor.y + s * 0.002 }, b = { x: anchor.x + s * width, y: anchor.y + s * 0.002 };
    if (kind === 'diamond') return polygon([a, { x: anchor.x, y: anchor.y - s * 0.115 }, b]);
    if (kind === 'fraktur' || kind === 'textura') return polygon([a, { x: anchor.x - s * 0.02, y: anchor.y - s * height }, { x: anchor.x + s * width, y: anchor.y - s * height * 0.55 }, b]);
    return [{ type: 'M', ...a }, { type: 'Q', x1: anchor.x + s * width * 0.65, y1: anchor.y - s * 0.005, x: anchor.x + s * width, y: anchor.y - s * height }, { type: 'Q', x1: anchor.x + s * width * 1.25, y1: anchor.y - s * 0.015, ...b }, { type: 'Z' }];
  }
  const sign = upper ? -1 : 1;
  const at = (x: number, y: number): Point => ({ x: anchor.x + direction * x * s, y: anchor.y + sign * y * s });
  let curves: Point[][], thickness = 0.035;
  switch (id) {
    case 'flourish-swash':
      curves = [[at(0, -0.003), at(0.2, 0.2), at(0.9, 0.3), at(0.8, 0.5)], [at(0.8, 0.5), at(0.68, 0.7), at(0.37, 0.4), at(0.61, 0.35)]];
      thickness = 0.045; break;
    case 'flourish-royal':
      curves = [[at(0, -0.003), at(0.15, 0.31), at(0.94, 0.08), at(0.79, 0.4)], [at(0.79, 0.4), at(0.63, 0.64), at(0.3, 0.4), at(0.5, 0.25)]];
      thickness = 0.045; break;
    case 'flourish-ribbon':
      curves = [[at(0, -0.003), at(0.2, 0.39), at(0.84, 0.35), at(0.77, 0.09)]];
      thickness = 0.09; break;
    case 'flourish-vine':
      curves = [[at(0, -0.003), at(0.16, 0.35), at(0.65, 0.22), at(0.66, 0.48)], [at(0.66, 0.48), at(0.7, 0.64), at(0.91, 0.41), at(0.83, 0.31)]];
      thickness = 0.022; break;
    default:
      curves = [[at(0, -0.003), at(0.15, 0.3), at(0.84, 0.27), at(0.69, 0.04)]];
  }
  const samples = curves.flatMap((curve, index) => sampleCurve(curve).slice(index ? 1 : 0));
  return ribbon(samples, s * thickness, true);
}
function validateSource(source: LetterformState): void {
  if (![source.sourceWidth, source.sourceHeight].every(value => Number.isFinite(value) && value >= 0)) throw new RangeError('字形尺寸必须是有限的非负数');
  for (const glyph of source.sourceGlyphs) {
    if (![glyph.x, glyph.y, glyph.width, glyph.height, glyph.rotation ?? 0].every(Number.isFinite)) throw new RangeError('字形位置必须是有限数值');
    for (const command of glyph.commands) for (const [x, y] of coordinatePairs) {
      if ((command[x] !== undefined && !Number.isFinite(command[x])) || (command[y] !== undefined && !Number.isFinite(command[y]))) throw new RangeError('字形轮廓必须是有限数值');
    }
  }
}

export function applyLetterform(layer: Layer, presetId: string, amount = 0.65): Layer {
  if (layer.kind !== 'text' && layer.kind !== 'path') return structuredClone(layer);
  const profile = profiles[presetId];
  if (!profile || !LETTERFORM_PRESETS.some(preset => preset.id === presetId)) throw new RangeError(`未知字形样式：${presetId}`);
  if (!Number.isFinite(amount)) throw new RangeError('字形强度必须是有限数值');
  const strength = Math.max(0, Math.min(1, amount));
  const source: LetterformState = layer.letterform
    ? { ...layer.letterform, presetId, amount: strength, sourceGlyphs: cloneGlyphs(layer.letterform.sourceGlyphs) }
    : { presetId, amount: strength, sourceGlyphs: cloneGlyphs(layer.glyphs), sourceWidth: layer.width, sourceHeight: layer.height, sourceKind: layer.kind };
  validateSource(source);
  const result = structuredClone(layer);
  result.kind = 'path'; result.letterform = source;
  result.width = source.sourceWidth; result.height = source.sourceHeight; result.glyphs = cloneGlyphs(source.sourceGlyphs);
  if (strength === 0 || !source.sourceGlyphs.some(glyph => hasArea(glyph.commands))) return result;

  const hasCjk = source.sourceGlyphs.some(glyph => cjk.test(glyph.char));
  const spacing = mix(1, hasCjk ? Math.max(0.85, profile.width) : profile.width, strength * 0.65);
  const glyphs: Glyph[] = [], joins: { source: Glyph; index: number; bottom: Point; size: number }[] = [];
  const active = source.sourceGlyphs.map(glyph => hasArea(glyph.commands) && !/^\s+$/u.test(glyph.char));
  for (const [index, glyph] of source.sourceGlyphs.entries()) {
    const isCjk = cjk.test(glyph.char);
    const width = mix(1, isCjk ? Math.max(0.82, profile.width) : profile.width, strength);
    const height = mix(1, profile.height, strength * (isCjk ? 0.7 : 1));
    const slant = profile.slant * strength * (isCjk ? 0.7 : 1);
    const center = { x: (glyph.x + glyph.width / 2) * spacing, y: glyph.y + glyph.height / 2 };
    const angle = (glyph.rotation ?? 0) * Math.PI / 180;
    const place = (point: Point): Point => ({ x: center.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: center.y + point.x * Math.sin(angle) + point.y * Math.cos(angle) });
    if (!hasArea(glyph.commands)) { glyphs.push({ ...cloneGlyph(glyph), x: glyph.x * spacing, width: glyph.width * spacing }); continue; }
    const designed = reshapeOutline(glyph.commands, glyph.width, glyph.height, presetId, strength, glyph.fillRule);
    const shapePoint = (point: Point): Point => ({ x: (point.x - glyph.width / 2) * width - slant * (point.y - glyph.height / 2), y: (point.y - glyph.height / 2) * height });
    const commands = mapCommands(designed.commands.length ? designed.commands : glyph.commands, shapePoint);
    const body = decoration(commands, glyph.id, place, glyph.paint); body.char = glyph.char;
    if (glyph.fillRule !== undefined) body.fillRule = glyph.fillRule;
    glyphs.push(body);
    const points = designed.points.map(shapePoint);
    if (points.length < 2 || glyph.height <= 0 || glyph.width <= 0 || !active[index]) continue;
    const size = Math.min(glyph.height, glyph.width * 1.6);
    const neighbor = (otherIndex: number): boolean => {
      const other = source.sourceGlyphs[otherIndex];
      return !!other && active[otherIndex] && !glyph.rotation && !other.rotation && layer.layout === 'horizontal'
        && Math.abs(other.y + other.height / 2 - glyph.y - glyph.height / 2) < Math.max(other.height, glyph.height) * 0.45;
    };
    const first = !neighbor(index - 1), last = !neighbor(index + 1), gothic = presetId.startsWith('gothic-');
    const extras = designed.terminals.map(path => mapCommands(path, shapePoint));
    const swashEnd = presetId === 'flourish-swash' || presetId === 'flourish-ribbon';
    const finish = swashEnd ? last : first || last;
    if (!gothic && finish) {
      const direction = presetId === 'flourish-vine' ? (first ? -1 : 1) : last ? 1 : -1;
      extras.push(wordFinish(presetId, points, size, strength, direction));
      if (first && last && presetId === 'flourish-royal') extras.push(wordFinish(presetId, points, size, strength, -1));
    } else if (gothic && !extras.length && (first || last)) extras.push(wordFinish(presetId, points, size, strength, 1));
    extras.forEach((path, extraIndex) => glyphs.push(decoration(path, `${glyph.id}:letterform:${presetId}:${extraIndex}`, place, glyph.paint)));
    if (presetId === 'flourish-slanted' && !isCjk && !glyph.rotation) joins.push({ source: glyph, index, bottom: place(edgeAnchor(points, false, 0.65)), size });
  }
  if (layer.layout === 'horizontal') for (let i = 1; i < joins.length; i++) {
    const previous = joins[i - 1], next = joins[i], size = Math.min(previous.size, next.size);
    const gap = next.source.x - previous.source.x - previous.source.width;
    if (next.index !== previous.index + 1 || gap < 0 || gap > size * 0.45 || Math.abs(previous.bottom.y - next.bottom.y) > size * 0.22 || next.bottom.x <= previous.bottom.x) continue;
    const bridge = sampleCurve([previous.bottom, { x: mix(previous.bottom.x, next.bottom.x, 0.33), y: Math.max(previous.bottom.y, next.bottom.y) + size * 0.12 * strength }, { x: mix(previous.bottom.x, next.bottom.x, 0.67), y: Math.max(previous.bottom.y, next.bottom.y) + size * 0.12 * strength }, next.bottom], 32);
    glyphs.push(decoration(ribbon(bridge, size * 0.018 * strength), `${previous.source.id}:letterform:join:${next.source.id}`, point => point, previous.source.paint));
  }
  let left = 0, top = 0, right = source.sourceWidth * spacing, bottom = source.sourceHeight;
  for (const glyph of glyphs) {
    left = Math.min(left, glyph.x); top = Math.min(top, glyph.y);
    right = Math.max(right, glyph.x + glyph.width); bottom = Math.max(bottom, glyph.y + glyph.height);
  }
  result.width = Math.max(0, right - left); result.height = Math.max(0, bottom - top);
  result.glyphs = glyphs.map(glyph => ({ ...glyph, x: glyph.x - left, y: glyph.y - top }));
  return result;
}

export function clearLetterform(layer: Layer): Layer {
  const result = structuredClone(layer);
  if (!result.letterform) return result;
  const source = result.letterform;
  result.kind = source.sourceKind; result.width = source.sourceWidth; result.height = source.sourceHeight;
  result.glyphs = cloneGlyphs(source.sourceGlyphs); delete result.letterform;
  return result;
}
