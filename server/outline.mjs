export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateOutline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, '请求必须为 JSON 对象');
  if (typeof value.fontId !== 'string' || !value.fontId || value.fontId.length > 128) throw new ApiError(400, 'fontId 无效');
  if (typeof value.text !== 'string' || value.text.length > 4096) throw new ApiError(400, 'text 必须为不超过 4096 字符的字符串');
  for (const [key, min, max] of [['fontSize', 1, 2048], ['letterSpacing', -1024, 2048], ['lineHeight', 0.1, 10]]) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new ApiError(400, `${key} 必须在 ${min} 到 ${max} 之间`);
  }
  if (!['left', 'center', 'right'].includes(value.align)) throw new ApiError(400, 'align 无效');
  if (!['horizontal', 'vertical'].includes(value.layout)) throw new ApiError(400, 'layout 无效');
  return value;
}

const round = value => Math.round(value * 10000) / 10000;
const ignorable = /[\p{Default_Ignorable_Code_Point}\s]/u;
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function convertPath(glyph, scale) {
  const path = glyph.path;
  if (!path.commands.length) return { commands: [], left: 0, top: 0, width: 0, height: 0 };
  const box = path.bbox;
  if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) throw new ApiError(422, '字体轮廓含无效坐标');
  const x = value => round((value - box.minX) * scale);
  const y = value => round((box.maxY - value) * scale);
  const commands = path.commands.map(({ command, args }) => {
    if (!args.every(Number.isFinite)) throw new ApiError(422, '字体轮廓含无效坐标');
    switch (command) {
      case 'moveTo': return { type: 'M', x: x(args[0]), y: y(args[1]) };
      case 'lineTo': return { type: 'L', x: x(args[0]), y: y(args[1]) };
      case 'quadraticCurveTo': return { type: 'Q', x1: x(args[0]), y1: y(args[1]), x: x(args[2]), y: y(args[3]) };
      case 'bezierCurveTo': return { type: 'C', x1: x(args[0]), y1: y(args[1]), x2: x(args[2]), y2: y(args[3]), x: x(args[4]), y: y(args[5]) };
      case 'closePath': return { type: 'Z' };
      default: throw new ApiError(422, `未知轮廓命令: ${command}`);
    }
  });
  return { commands, left: box.minX * scale, top: -box.maxY * scale, width: (box.maxX - box.minX) * scale, height: (box.maxY - box.minY) * scale };
}

function layoutWithSource(font, text, features) {
  const original = font.getGlyph;
  const own = Object.hasOwn(font, 'getGlyph');
  // Fontkit caches by glyph ID; distinct missing characters share ID 0.
  font.getGlyph = function (id, codePoints = []) {
    const glyph = original.call(this, id, codePoints);
    return glyph && Object.create(glyph, { codePoints: { value: [...codePoints], enumerable: true } });
  };
  try { return font.layout(text, features); }
  finally { if (own) font.getGlyph = original; else delete font.getGlyph; }
}

export function outlineFont(font, request) {
  const { fontId, text, fontSize, letterSpacing, lineHeight, align, layout } = validateOutline(request);
  const scale = fontSize / font.unitsPerEm;
  if (!Number.isFinite(scale) || scale <= 0) throw new ApiError(422, '字体单位无效');
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const missing = new Set();
  const vertical = layout === 'vertical';
  const output = [];
  const groups = [];
  let commandCount = 0;
  let sequence = 0;
  const shapeCache = new Map();
  const shape = glyph => {
    if (!shapeCache.has(glyph.id)) shapeCache.set(glyph.id, convertPath(glyph, scale));
    return shapeCache.get(glyph.id);
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    for (const char of line) if (!ignorable.test(char) && !font.hasGlyphForCodePoint(char.codePointAt(0))) missing.add(char);
    let cursor = 0;
    const items = [];
    const segments = [...segmenter.segment(line)].map(item => item.segment);
    if (vertical) {
      for (let i = 0; i < segments.length; i++) {
        const char = segments[i];
        const run = layoutWithSource(font, char, { vert: true, vrt2: true });
        const cluster = [];
        let horizontal = 0;
        for (let j = 0; j < run.glyphs.length; j++) {
          const glyph = run.glyphs[j];
          const geometry = shape(glyph);
          const position = run.positions[j];
          const blank = geometry.commands.length === 0;
          cluster.push({ id: `g${sequence++}`, char: String.fromCodePoint(...glyph.codePoints) || char, x: horizontal + position.xOffset * scale + geometry.left, y: -position.yOffset * scale + geometry.top, width: geometry.width, height: geometry.height, commands: geometry.commands, fillRule: 'nonzero' });
          if (blank && !ignorable.test(char)) missing.add(char);
          horizontal += position.xAdvance * scale;
        }
        const minX = Math.min(...cluster.map(glyph => glyph.x), 0);
        const maxX = Math.max(...cluster.map(glyph => glyph.x + glyph.width), 0);
        const visible = cluster.filter(glyph => glyph.commands.length);
        const left = visible.length ? Math.min(...visible.map(glyph => glyph.x)) : minX;
        const right = visible.length ? Math.max(...visible.map(glyph => glyph.x + glyph.width)) : maxX;
        const top = visible.length ? Math.min(...visible.map(glyph => glyph.y)) : 0;
        const bottom = visible.length ? Math.max(...visible.map(glyph => glyph.y + glyph.height)) : 0;
        for (const glyph of cluster) {
          glyph.x += (fontSize - (right - left)) / 2 - left;
          glyph.y += cursor + (fontSize - (bottom - top)) / 2 - top;
          items.push(glyph);
        }
        cursor += fontSize + (i + 1 < segments.length ? letterSpacing : 0);
      }
    } else {
      const run = layoutWithSource(font, line, letterSpacing ? { liga: false, clig: false } : undefined);
      const sourceClusters = (run.direction === 'rtl' ? [...segments].reverse() : segments).flatMap((segment, index) => Array.from(segment, () => index));
      let consumed = 0;
      for (let i = 0; i < run.glyphs.length; i++) {
        const glyph = run.glyphs[i];
        const position = run.positions[i];
        const geometry = shape(glyph);
        const char = String.fromCodePoint(...glyph.codePoints);
        const advance = position.xAdvance * scale;
        const blank = geometry.commands.length === 0;
        const clusterIndex = sourceClusters[Math.min(consumed, sourceClusters.length - 1)] || 0;
        items.push({ id: `g${sequence++}`, char, x: cursor + clusterIndex * letterSpacing + position.xOffset * scale + geometry.left, y: -position.yOffset * scale + geometry.top, width: blank ? Math.max(0, advance) : geometry.width, height: geometry.height, commands: geometry.commands, fillRule: 'nonzero' });
        if (blank && char && !ignorable.test(char)) missing.add(char);
        consumed += glyph.codePoints.length;
        cursor += advance;
      }
      cursor += Math.max(0, segments.length - 1) * letterSpacing;
    }
    const axis = vertical ? 'y' : 'x';
    const extent = vertical ? 'height' : 'width';
    const min = Math.min(0, cursor, ...items.map(g => g[axis]));
    const max = Math.max(0, cursor, ...items.map(g => g[axis] + g[extent]));
    groups.push({ items, min, length: max - min });
  }
  const maximum = Math.max(0, ...groups.map(group => group.length));
  const alignFactor = align === 'center' ? 0.5 : align === 'right' ? 1 : 0;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const alignment = (maximum - group.length) * alignFactor - group.min;
    for (const glyph of group.items) {
      glyph.x += vertical ? (groups.length - index - 1) * fontSize * lineHeight : alignment;
      glyph.y += vertical ? alignment : index * fontSize * lineHeight;
      commandCount += glyph.commands.length;
      if (commandCount > 250000) throw new ApiError(413, '轮廓过于复杂，请减少文字数量');
      output.push(glyph);
    }
  }
  // Include advances and blank lines while expanding for italic overhangs and descenders.
  let minX = 0;
  let maxX = vertical ? Math.max(fontSize, (groups.length - 1) * fontSize * lineHeight + fontSize) : maximum;
  let minY = vertical ? 0 : -fontSize * 0.8;
  let maxY = vertical ? maximum : (groups.length - 1) * fontSize * lineHeight + fontSize * 0.2;
  for (const glyph of output) {
    minX = Math.min(minX, glyph.x);
    maxX = Math.max(maxX, glyph.x + glyph.width);
    minY = Math.min(minY, glyph.y);
    maxY = Math.max(maxY, glyph.y + glyph.height);
  }
  for (const glyph of output) {
    glyph.x = round(glyph.x - minX);
    glyph.y = round(glyph.y - minY);
    glyph.width = round(glyph.width);
    glyph.height = round(glyph.height);
  }
  return { fontId, glyphs: output, width: Math.max(1, round(maxX - minX)), height: Math.max(1, round(maxY - minY)), missing: [...missing] };
}
