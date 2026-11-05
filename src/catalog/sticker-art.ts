import type { Command, GlyphPaint, PaintColor, TextStyle } from '../types';

export type ArtPart = { label: string; commands: Command[]; paint: GlyphPaint };
export type StickerArt = { parts: ArtPart[]; style?: Partial<TextStyle> };

type Shape = Command[];
type Point = [number, number];
type Palette = { fill: `#${string}`; fill2: `#${string}`; ink: `#${string}`; shade: `#${string}`; accent: `#${string}`; depth: `#${string}` };
const PINK: Palette = { fill: '#ffb7cf', fill2: '#ffe7ab', ink: '#a45f87', shade: '#ed82ac', accent: '#a9ded4', depth: '#bd6b96' };
const GOLD: Palette = { fill: '#ffe39b', fill2: '#ffbdcc', ink: '#bd884b', shade: '#efb866', accent: '#a8dcd1', depth: '#cf9656' };
const MINT: Palette = { fill: '#ace1d7', fill2: '#ffe4b3', ink: '#598e99', shade: '#76c2c2', accent: '#f7a6c4', depth: '#69a5b3' };
const LILAC: Palette = { fill: '#d0b7ee', fill2: '#ffd9ac', ink: '#8863ab', shade: '#ae8ad4', accent: '#ffacc7', depth: '#9a75bd' };
const MILK: Palette = { fill: '#fff2da', fill2: '#e0c9f3', ink: '#97709f', shade: '#dec3df', accent: '#ffafca', depth: '#af8bb6' };
const CREAM = '#fff9ec';
const ROSE = '#ef83a9';
const COCOA = '#785774';
const LEAF = '#a2d9bd';

function path(data: string): Shape {
  const tokens = data.match(/[MLQCZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) ?? [];
  const keys = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] } as const;
  const commands: Shape = [];
  for (let i = 0; i < tokens.length;) {
    const type = tokens[i++] as Command['type'];
    if (!(type in keys)) throw new Error(`Invalid candy-art command: ${type}`);
    const command: Command = { type };
    for (const key of keys[type]) {
      const value = Number(tokens[i++]);
      if (!Number.isFinite(value)) throw new Error(`Invalid candy-art coordinate in ${data}`);
      command[key] = value;
    }
    commands.push(command);
  }
  return commands;
}
function transform(shape: Shape, x: number, y: number, sx = 1, sy = sx, angle = 0): Shape {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return shape.map(command => {
    const next = { ...command };
    for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']] as const) {
      if (command[kx] === undefined || command[ky] === undefined) continue;
      next[kx] = x + command[kx]! * sx * c - command[ky]! * sy * s;
      next[ky] = y + command[kx]! * sx * s + command[ky]! * sy * c;
    }
    return next;
  });
}
function ellipse(x: number, y: number, rx: number, ry = rx): Shape {
  const k = 0.5522847498307936;
  return path(`M${x + rx} ${y} C${x + rx} ${y + ry * k} ${x + rx * k} ${y + ry} ${x} ${y + ry} C${x - rx * k} ${y + ry} ${x - rx} ${y + ry * k} ${x - rx} ${y} C${x - rx} ${y - ry * k} ${x - rx * k} ${y - ry} ${x} ${y - ry} C${x + rx * k} ${y - ry} ${x + rx} ${y - ry * k} ${x + rx} ${y} Z`);
}
function box(x: number, y: number, w: number, h: number, r: number): Shape {
  return path(`M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`);
}
function heart(x: number, y: number, size: number): Shape {
  return transform(path('M0 -18 C-12 -39 -44 -31 -43 -7 C-42 12 -18 29 -4 39 Q0 42 4 39 C22 27 44 9 43 -9 C41 -33 12 -39 0 -18 Z'), x, y, size / 86);
}
function softStar(x: number, y: number, r: number, tips = 5, inner = 0.58, angle = -90): Shape {
  const points: Point[] = Array.from({ length: tips * 2 }, (_, i) => {
    const a = (angle + i * 180 / tips) * Math.PI / 180;
    const radius = r * (i % 2 ? inner : 1);
    return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
  });
  const toward = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * 0.19, a[1] + (b[1] - a[1]) * 0.19];
  const start = toward(points[0], points[points.length - 1]);
  const out: Shape = [{ type: 'M', x: start[0], y: start[1] }];
  points.forEach((p, i) => {
    const exit = toward(p, points[(i + 1) % points.length]);
    const entry = toward(points[(i + 1) % points.length], p);
    out.push({ type: 'Q', x1: p[0], y1: p[1], x: exit[0], y: exit[1] }, { type: 'L', x: entry[0], y: entry[1] });
  });
  out.push({ type: 'Z' });
  return out;
}
function flower(x: number, y: number, r: number, petals: number): Shape {
  const point = (angle: number, radius: number): Point => [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
  const half = Math.PI / petals, first = point(-Math.PI / 2 - half, r * 0.59);
  const out: Shape = [{ type: 'M', x: first[0], y: first[1] }];
  for (let i = 0; i < petals; i++) {
    const a = -Math.PI / 2 + i * half * 2, radius = r * (1 + (i % 3 - 1) * 0.025);
    const c1 = point(a - half * 0.83, radius * 1.06), c2 = point(a - half * 0.32, radius * 1.1), tip = point(a, radius);
    const c3 = point(a + half * 0.32, radius * 1.1), c4 = point(a + half * 0.83, radius * 1.06), end = point(a + half, r * 0.59);
    out.push({ type: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: tip[0], y: tip[1] }, { type: 'C', x1: c3[0], y1: c3[1], x2: c4[0], y2: c4[1], x: end[0], y: end[1] });
  }
  out.push({ type: 'Z' });
  return out;
}
function leaf(x: number, y: number, scale = 1, angle = 0): Shape {
  return transform(path('M0 0 C-18 1 -26 -12 -25 -26 C-10 -27 4 -18 0 0 Z'), x, y, scale, scale, angle);
}
function crescent(x: number, y: number, size: number): Shape {
  return transform(path('M10 -33 C-22 -32 -37 -8 -25 18 C-15 40 17 41 32 19 C10 29 -6 17 -9 1 C-12 -14 -3 -26 10 -33 Z'), x, y, size / 67);
}
// Reverse the inner contour so openings survive both nonzero and even-odd renderers.
function hole(outer: Shape, inner: Shape): Shape {
  const start = inner[0];
  if (start.type !== 'M') throw new Error('Candy-art hole requires a closed contour');
  let previous: Point = [start.x!, start.y!];
  const segments: { from: Point; command: Command }[] = [];
  for (const command of inner.slice(1)) {
    if (command.type === 'Z') continue;
    segments.push({ from: previous, command });
    previous = [command.x!, command.y!];
  }
  const reversed: Shape = [{ type: 'M', x: previous[0], y: previous[1] }];
  for (const { from, command } of segments.reverse()) {
    if (command.type === 'C') reversed.push({ type: 'C', x1: command.x2, y1: command.y2, x2: command.x1, y2: command.y1, x: from[0], y: from[1] });
    else if (command.type === 'Q') reversed.push({ type: 'Q', x1: command.x1, y1: command.y1, x: from[0], y: from[1] });
    else reversed.push({ type: 'L', x: from[0], y: from[1] });
  }
  reversed.push({ type: 'Z' });
  return [...outer, ...reversed];
}
function body(label: string, commands: Shape, fill: PaintColor = 'primary', width = 3.2): ArtPart {
  return { label, commands, paint: { fill, stroke: 'ink', strokeWidth: width, silhouette: true } };
}
function detail(label: string, commands: Shape, fill: PaintColor, strokeWidth = 0): ArtPart {
  return { label, commands, paint: { fill, stroke: strokeWidth ? 'ink' : 'none', strokeWidth, silhouette: false } };
}
function line(label: string, commands: Shape, color: PaintColor = 'ink', width = 1.7): ArtPart {
  return { label, commands, paint: { fill: 'none', stroke: color, strokeWidth: width, silhouette: false } };
}
const shine = (commands: Shape): ArtPart => detail('随形宽高光', commands, CREAM);
const dot = (x: number, y: number, r = 2): ArtPart => detail('糖光点', ellipse(x, y, r), CREAM);
function art(parts: ArtPart[], p: Palette): StickerArt {
  return { parts, style: { fill: p.fill, fill2: p.fill2, stroke: p.ink, strokeWidth: 0, outerStroke: '#fffaf5', outerWidth: 4.2, depth: 3.2, depthColor: p.depth, shadowColor: '#c399ad', shadowX: 1.2, shadowY: 2.2, shadowBlur: 0, gradient: false, material: 'none', texture: 'none', textureOpacity: 0, gloss: false, opacity: 1 } };
}
function face(x: number, y: number, mood: number, scale = 1): ArtPart[] {
  const at = (commands: Shape) => transform(commands, x, y, scale);
  const eyes = mood === 2 ? [...heart(-10, -2, 12), ...heart(10, -2, 12)] : mood === 1 ? path('M-16 0 Q-11 -9 -6 0 L-6 3 Q-11 -2 -16 3 Z M6 0 Q11 -9 16 0 L16 3 Q11 -2 6 3 Z') : mood === 3 ? [...path('M-16 -3 Q-11 -6 -6 -2 Q-5 1 -8 1 L-16 0 Z'), ...ellipse(11, -1, 3.1, 4.6)] : [...ellipse(-11, -1, 3.1, 4.6), ...ellipse(11, -1, 3.1, 4.6)];
  return [detail('实心表情眼', at(eyes), mood === 2 ? ROSE : COCOA), detail('左腮红', at(ellipse(-18, 8, 5, 2.7)), '#f9b0ca'), detail('右腮红', at(ellipse(18, 8, 5, 2.7)), '#f9b0ca'), line('微笑嘴', at(path('M-4 8 Q0 14 4 8')), COCOA, 1.8 * scale)];
}
function tinyBow(x: number, y: number, scale = 1): ArtPart[] {
  const at = (commands: Shape) => transform(commands, x, y, scale);
  return [body('小结左翼', at(path('M-3 -2 C-13 -12 -20 -12 -19 -3 L-18 8 Q-12 13 -2 3 Z')), 'secondary', 2.8), body('小结右翼', at(path('M3 -2 C12 -13 20 -10 19 1 L18 9 Q11 12 2 3 Z')), 'secondary', 2.8), detail('小结实心折面', at(path('M-15 -2 Q-7 0 -3 2 L-12 7 Z M4 2 L15 -2 L13 7 Z')), '#e992af'), body('小结中心', at(box(-5, -6, 10, 14, 4)), 'primary', 2.8)];
}

function starburst(v: number): StickerArt {
  const p = GOLD;
  if (v === 0) return art([
    body('空心软糖五角星', hole(softStar(50, 50, 44, 5, 0.62), softStar(50, 50, 22, 5, 0.6))),
    detail('右下糖壳', path('M73 45 Q78 42 84 42 L72 56 Q70 60 71 65 L76 78 Q74 81 70 79 L60 73 L59 65 L65 59 L66 49 Z'), p.shade),
    shine(path('M42 24 Q46 13 50 15 Q54 16 51 23 L47 33 Q45 37 41 34 Q38 31 42 24 Z')),
    dot(32, 43, 2.4),
  ], p);
  if (v === 1) return art([
    body('八芒胖放射星', softStar(50, 50, 43, 8, 0.6)),
    detail('蜂蜜下半糖面', path('M35 52 Q52 63 71 50 Q75 54 70 58 L66 61 L70 70 L60 65 L53 76 L50 68 L42 74 L39 62 L30 66 L34 56 Z'), p.shade),
    detail('奶油心面', ellipse(48, 46, 17, 15), 'secondary'),
    shine(path('M29 38 Q33 26 42 25 Q48 25 44 30 Q37 32 35 40 Q33 45 30 43 Q27 42 29 38 Z')),
    dot(50, 24),
  ], p);
  if (v === 2) return art([
    body('星环圆糖圈', hole(ellipse(49, 51, 43, 38), ellipse(49, 51, 36, 31)), 'secondary', 2.8),
    body('六芒奶油星', softStar(49, 51, 31, 6, 0.63)),
    detail('六芒右下糖面', path('M42 55 Q55 62 65 48 L65 55 L67 63 L59 62 L50 75 L46 65 L39 63 L35 61 Z'), p.shade),
    body('绕行小星', softStar(84, 23, 11, 4, 0.53), p.accent, 2.8),
    shine(path('M36 39 Q38 31 44 32 Q48 33 44 37 L40 44 Q37 47 35 44 Z')),
    dot(28, 51, 1.8),
  ], p);
  return art([
    body('上弯桃色星尾', path('M35 37 C55 42 66 66 94 68 Q100 69 95 75 C71 86 48 65 26 48 Z'), 'secondary'),
    body('下弯薄荷星尾', path('M29 44 C45 56 50 78 80 87 Q87 90 80 94 C56 99 32 72 20 53 Z'), p.accent),
    detail('星尾折光', path('M46 52 Q65 71 90 72 Q70 78 52 65 Z'), '#ee8fb2'),
    body('流光星头', softStar(29, 30, 27, 5, 0.63)),
    detail('星头糖面', path('M29 41 Q39 39 48 29 L46 40 L48 49 L37 45 L29 52 L25 43 Z'), p.shade),
    shine(path('M20 23 Q23 15 27 17 Q30 18 27 23 L24 28 Q19 31 18 28 Z')),
    dot(35, 25, 1.8),
  ], p);
}

function heartToken(v: number): StickerArt {
  const p = PINK;
  if (v === 0) return art([
    body('镂空厚糖爱心', hole(heart(50, 44, 85), heart(50, 44, 48))),
    detail('爱心右瓣糖面', path('M76 21 C89 25 92 38 84 52 Q72 69 53 81 L48 77 Q71 59 77 46 Q83 33 76 21 Z'), p.shade),
    shine(path('M18 36 C17 26 24 21 32 23 Q39 25 34 29 Q25 27 25 36 Q23 43 19 41 Z')),
    dot(37, 31, 2.3),
  ], p);
  if (v === 1) return art([
    body('左依草莓心', transform(heart(0, 0, 64), 35, 42, 1, 1, -13)),
    detail('左心下糖面', path('M14 47 Q28 60 49 59 L39 74 Q20 63 14 47 Z'), p.shade),
    body('右依奶油心', transform(heart(0, 0, 60), 65, 53, 1, 1, 12), 'secondary'),
    detail('右心蜜糖面', path('M84 45 Q90 61 64 80 L57 75 Q78 61 84 45 Z'), '#efbc77'),
    shine(path('M14 30 Q17 19 27 23 Q32 26 27 29 Q21 26 20 34 Q15 38 14 30 Z')),
    dot(48, 48, 2.2),
  ], p);
  if (v === 2) return art([
    body('左侧心动光', path('M12 36 Q5 31 8 27 Q11 23 17 29 L20 35 Q20 40 16 39 Z'), 'secondary', 2.8),
    body('右上心动光', path('M77 16 Q79 7 84 10 Q88 12 83 20 Q80 25 77 22 Z'), 'secondary', 2.8),
    body('右侧心动光', path('M87 38 Q97 33 98 38 Q99 43 89 45 Q84 45 85 41 Z'), p.accent, 2.8),
    body('怦然胖爱心', heart(51, 50, 72)),
    detail('草莓奶油分面', path('M22 52 Q34 62 52 55 Q66 50 82 48 C78 63 61 76 51 83 Q35 71 22 52 Z'), 'secondary'),
    shine(path('M26 40 Q25 31 34 30 Q41 30 39 35 Q32 35 32 42 Q29 47 26 44 Z')),
    dot(44, 37),
  ], p);
  return art([
    body('碎心左拼片', path('M44 27 C29 7 8 23 12 43 Q16 61 43 80 L50 64 L39 54 L51 41 Z')),
    body('碎心右拼片', path('M56 27 C70 8 94 22 89 43 Q85 63 56 82 L63 62 L53 53 L63 40 Z'), 'secondary'),
    detail('左片软糖暗面', path('M17 48 Q30 60 43 61 L47 65 L42 74 Q24 62 17 48 Z'), p.shade),
    detail('右片蜜糖暗面', path('M81 31 Q93 48 61 75 L65 64 Q78 49 81 31 Z'), '#efbc77'),
    shine(path('M20 33 Q23 23 32 25 Q37 28 31 30 Q25 29 25 36 Q21 41 20 33 Z')),
    dot(72, 29, 2.3),
  ], p);
}

function classicBow(v: number): StickerArt {
  const p = v === 2 ? LILAC : PINK;
  const parts: ArtPart[] = [];
  if (v === 1 || v === 3) {
    parts.push(body('左侧弯曲长尾', path(v === 1 ? 'M43 47 C35 61 20 72 17 87 Q28 83 35 89 Q39 71 51 54 Z' : 'M43 45 C24 58 32 80 9 87 Q26 95 38 82 Q41 72 51 54 Z'), 'secondary'));
    parts.push(body('右侧翻卷长尾', path(v === 1 ? 'M54 47 C61 62 75 70 85 81 Q75 81 72 91 C56 82 51 69 48 54 Z' : 'M55 45 C70 49 70 73 91 77 Q86 90 74 83 C60 74 61 61 48 54 Z'), 'secondary'));
    parts.push(detail('长尾内折面', path('M51 52 C42 64 39 75 35 86 L31 83 Q35 62 44 50 Z M55 53 Q60 68 73 81 Q64 77 58 71 L51 57 Z'), '#ed9ab0'));
  }
  if (v === 2) {
    parts.push(body('叠翼左后瓣', path('M44 39 Q20 5 13 16 Q5 27 21 49 L45 53 Z'), 'secondary'));
    parts.push(body('叠翼右后瓣', path('M55 39 Q77 2 86 17 Q94 31 77 50 L54 54 Z'), 'secondary'));
  }
  parts.push(body('左翼鼓起缎面', path('M44 42 C29 29 8 17 8 34 L10 59 Q12 75 44 53 Z')));
  parts.push(body('右翼鼓起缎面', path('M55 42 C76 24 93 25 92 39 L89 65 Q85 76 55 53 Z')));
  parts.push(detail('左翼实心折面', path('M39 44 Q25 38 18 38 Q20 49 32 53 L42 50 Z'), p.shade));
  parts.push(detail('右翼奶油折面', path('M59 45 Q76 36 83 37 Q82 53 65 56 L57 51 Z'), 'secondary'));
  parts.push(detail('右翼下缘暗面', path('M66 58 Q79 63 88 50 L86 64 Q81 70 65 60 Z'), p.shade));
  parts.push(body('饱满结芯', box(41, 36, 18, 24, 7), 'secondary', 3));
  if (v === 2) parts.push(detail('叠翼星扣', softStar(50, 48, 8, 5, 0.6), '#fff1b8', 1.5));
  if (v === 3) parts.push(detail('心扣', heart(50, 47, 13), '#f080ab', 1.4));
  parts.push(shine(path('M15 33 Q17 28 25 32 L34 38 Q38 43 32 42 L23 38 Q17 37 15 40 Q12 39 15 33 Z')));
  parts.push(dot(48, 41, 1.8));
  return art(parts, p);
}

function gardenFlower(v: number): StickerArt {
  const p = v % 2 ? GOLD : PINK, petals = [4, 6, 8, 10][v];
  const parts: ArtPart[] = [
    body('弯曲嫩茎', path('M48 53 Q57 71 51 91 Q48 95 45 91 Q51 73 43 58 Z'), LEAF, 2.8),
    body('左侧胖叶', leaf(47, 79, 0.92, -10), LEAF, 2.8),
    detail('左叶暖面', path('M23 58 Q36 60 43 75 Q28 73 23 58 Z'), '#d8edbc'),
  ];
  if (v > 0) parts.push(body('右侧胖叶', transform(leaf(0, 0, 0.86), 52, 81, -1, 1, 10), '#b4e0c2', 2.8), detail('右叶叶面', path('M76 61 Q70 74 56 78 Q60 65 76 61 Z'), '#d9edbf'));
  parts.push(body(`${petals}瓣圆软花冠`, flower(49, 38, 30, petals)));
  parts.push(detail('右下花瓣糖面', path(v === 0 ? 'M54 42 C69 39 77 43 72 51 Q66 58 58 54 Q59 67 48 66 Q39 64 43 53 Z' : 'M53 42 Q65 38 70 44 Q73 50 65 53 Q65 62 57 60 Q52 69 45 63 Q38 65 36 57 Q49 57 53 42 Z'), p.shade));
  parts.push(body('奶油花蕊', ellipse(49, 39, v === 3 ? 12 : 10), 'secondary', 2.8));
  parts.push(detail('花蕊下糖面', path('M40 41 Q49 47 58 39 Q57 49 49 49 Q42 49 40 41 Z'), v % 2 ? '#f39db7' : '#efbf73'));
  if (v === 3) parts.push(detail('花蕊花粉', [...ellipse(45, 35, 1.5), ...ellipse(53, 35, 1.5), ...ellipse(49, 41, 1.5)], '#bd884b'));
  parts.push(shine(path('M32 25 Q34 17 40 18 Q45 19 40 23 Q36 25 36 29 Q31 33 30 29 Z')));
  parts.push(dot(46, 18, 1.8));
  return art(parts, p);
}

function layerCake(v: number): StickerArt {
  const p = PINK, parts: ArtPart[] = [];
  const lower = v === 2 ? 58 : 45;
  parts.push(body('奶油蛋糕胚', path(`M19 ${lower} Q50 ${lower - 8} 81 ${lower} L81 80 Q81 90 51 91 Q20 90 19 81 Z`), 'secondary'));
  parts.push(detail('蛋糕右下烤面', path(`M72 ${lower + 6} L78 ${lower + 5} L78 79 Q76 87 53 88 L28 85 L23 78 Q48 84 71 78 Z`), '#eab37c'));
  parts.push(detail('草莓夹心层', path('M22 68 Q49 75 78 67 L78 74 Q51 81 22 74 Z'), '#ee91b0'));
  parts.push(body('不对称淋面奶油', path(`M19 ${lower} C23 ${lower - 9} 72 ${lower - 10} 81 ${lower} L81 ${lower + 11} Q78 ${lower + 18} 72 ${lower + 11} Q69 ${lower + 7} 64 ${lower + 13} C58 ${lower + 23} 52 ${lower + 18} 52 ${lower + 11} Q45 ${lower + 7} 40 ${lower + 13} Q33 ${lower + 19} 28 ${lower + 9} Q19 ${lower + 15} 19 ${lower + 6} Z`)));
  if (v === 2) {
    parts.push(body('上层小蛋糕', path('M30 37 Q51 31 72 37 L72 56 Q71 63 51 64 Q30 63 30 56 Z'), 'secondary'));
    parts.push(detail('上层右烤面', path('M65 41 L69 40 L69 55 Q63 61 38 59 L35 55 Q57 57 65 52 Z'), '#eab37c'));
    parts.push(body('上层奶油波沿', path('M29 37 C31 29 69 29 73 37 L72 44 Q69 50 64 43 Q59 39 56 46 Q51 53 47 44 Q42 40 37 45 Q29 49 29 40 Z'), '#fff0d5'));
    parts.push(line('樱桃梗', path('M45 26 Q44 13 55 10 M58 24 Q58 13 55 10'), '#6fa784', 2));
    parts.push(body('左樱桃', ellipse(44, 25, 7), '#f38caf', 2.8), body('右樱桃', ellipse(59, 25, 7), '#ffb0bf', 2.8));
  } else if (v === 0) {
    parts.push(body('心形奶油顶饰', heart(50, 28, 26), '#ff9cbd', 2.8));
  } else if (v === 1) {
    parts.push(body('生日奶油蜡烛', box(44, 20, 12, 26, 4), '#a8dfd8', 2.8));
    parts.push(detail('蜡烛双色旋纹', path('M47 24 L53 28 L53 33 L47 29 Z M47 35 L53 39 L53 43 L47 39 Z'), '#fff0bd'));
    parts.push(body('暖黄烛火', path('M50 2 C51 8 60 12 54 18 Q50 22 45 17 Q41 11 50 2 Z'), '#ffe49c', 2.8));
  } else {
    [33, 50, 67].forEach((x, i) => {
      parts.push(body(`第${i + 1}颗莓果`, transform(path('M0 -9 C-12 -16 -13 1 -3 8 Q0 12 4 8 C14 -2 10 -15 0 -9 Z'), x, 31 + (i % 2 ? -4 : 0)), '#f598b3', 2.8));
      parts.push(detail(`第${i + 1}颗果蒂`, transform(path('M-7 -9 L-2 -13 L0 -10 L4 -14 L7 -9 L1 -6 Z'), x, 31 + (i % 2 ? -4 : 0)), LEAF));
    });
  }
  parts.push(shine(path(v === 2 ? 'M34 36 Q44 32 53 34 Q57 38 51 39 L39 40 Q33 41 34 36 Z' : 'M25 42 Q36 38 48 40 Q53 45 46 46 L31 47 Q23 49 25 42 Z')));
  parts.push(dot(v === 2 ? 60 : 56, v === 2 ? 36 : 43, 1.8));
  return art(parts, p);
}

function iceCream(v: number): StickerArt {
  const p = PINK, parts: ArtPart[] = [body('松软华夫甜筒', path('M27 55 Q50 51 73 55 L56 94 Q51 102 46 94 Z'), 'secondary')];
  parts.push(detail('甜筒蜂蜜折面', path('M63 58 L69 58 L54 93 Q50 98 48 90 Z'), '#e9b06d'));
  parts.push(line('华夫交叉格纹', path('M35 63 L58 82 M32 72 L53 89 M47 59 L64 72 M37 78 L56 58 M44 88 L64 65'), '#d39f64', 1.4));
  if (v === 1) {
    parts.push(body('上层奶油雪球', path('M29 27 C25 8 40 1 53 5 C69 4 78 17 70 29 Q65 37 57 32 Q49 38 42 33 Q30 36 29 27 Z'), '#c3e5df'));
    parts.push(detail('上层雪球下糖面', path('M33 25 Q48 29 69 23 Q68 32 59 29 Q49 35 42 31 Q36 33 33 25 Z'), '#8fceca'));
  }
  if (v === 2) {
    parts.push(body('旋卷软冰淇淋', path('M51 3 Q64 13 56 21 C77 23 77 34 66 39 C85 46 77 60 66 59 Q59 68 50 61 Q37 69 32 60 C16 61 15 48 31 40 C21 31 30 23 43 22 Q34 13 51 3 Z'), '#d8bfed'));
    parts.push(detail('上旋卷蜜桃面', path('M43 23 Q54 27 65 25 Q71 29 66 32 Q49 36 35 32 Q32 27 43 23 Z'), '#ffd9bc'));
    parts.push(detail('下旋卷奶油面', path('M31 42 Q48 47 68 40 Q75 43 72 48 Q50 56 27 50 Q24 46 31 42 Z'), '#fff0ce'));
    parts.push(detail('旋卷下暗面', path('M30 55 Q52 61 73 52 Q72 59 65 57 Q57 64 49 59 Q37 64 32 58 Z'), '#b798d4'));
    parts.push(shine(path('M43 12 Q47 7 50 10 Q53 13 49 17 Q43 21 40 19 Q37 17 43 12 Z')));
  } else {
    parts.push(body('不规则融化冰淇淋球', path(v === 0 ? 'M21 47 C14 26 30 14 46 17 C61 12 81 25 79 43 Q87 54 74 59 Q65 68 57 58 Q49 69 41 59 Q30 66 25 57 Q16 57 21 47 Z' : 'M21 48 C16 30 31 23 45 27 C58 19 80 30 79 47 Q87 56 73 61 Q65 69 56 61 Q48 70 40 61 Q30 67 24 59 Q15 59 21 48 Z')));
    if (v === 3) parts.push(detail('双味香草半球', path('M47 29 Q61 23 70 32 Q79 38 76 48 Q81 56 72 58 Q65 66 57 57 Q50 64 46 59 Q53 45 47 29 Z'), '#fff0cf'));
    else parts.push(detail('草莓球右下糖面', path('M67 31 Q80 37 76 48 Q82 55 72 57 Q65 64 57 55 Q49 65 42 57 Q60 53 67 31 Z'), p.shade));
    if (v === 3) parts.push(body('星星糖片', softStar(75, 24, 11, 5, 0.62), '#ffe49f', 2.8));
    parts.push(shine(path(v === 0 ? 'M27 34 Q31 24 41 25 Q47 28 41 31 Q34 31 32 38 Q27 43 25 39 Z' : 'M27 41 Q29 32 39 32 Q45 34 40 38 Q32 38 32 44 Q28 49 26 45 Z')));
  }
  parts.push(dot(48, v === 2 ? 17 : v === 0 ? 27 : 36, 1.8));
  return art(parts, p);
}

function boba(v: number): StickerArt {
  const p = MINT, parts: ArtPart[] = [body('斜吸管', path('M57 29 L63 5 Q64 2 68 3 Q72 4 71 8 L64 32 Z'), '#f6a9c3', 2.8)];
  parts.push(detail('吸管奶油面', path('M65 8 L68 9 L62 28 L59 28 Z'), '#fff1d6'));
  parts.push(body('胖肚奶茶杯', path('M23 29 Q50 22 78 29 L71 84 Q70 93 50 94 Q29 93 28 84 Z'), 'secondary'));
  parts.push(detail('奶茶双色茶面', path('M27 45 Q48 52 74 44 L69 82 Q68 89 50 90 Q33 89 31 82 Z'), '#eab68e'));
  parts.push(detail('奶茶右下浓茶', path('M66 47 L73 45 L69 83 Q67 90 50 90 L37 88 L34 83 Q61 87 65 77 Z'), '#d89984'));
  parts.push(body('奶茶糖色杯盖', path('M24 24 Q50 17 77 24 Q82 27 79 34 Q50 41 22 34 Q19 29 24 24 Z')));
  parts.push(detail('杯盖奶油顶面', path('M28 25 Q50 20 74 26 Q52 31 28 28 Z'), '#d8f0e1'));
  const count = [4, 6, 8, 10][v];
  const positions: Point[] = count === 4 ? [[39, 77], [53, 80], [64, 75], [47, 66]] : count === 6 ? [[38, 79], [50, 82], [62, 79], [37, 67], [49, 69], [62, 67]] : count === 8 ? [[37, 80], [49, 83], [61, 80], [36, 68], [49, 70], [62, 68], [42, 58], [56, 58]] : [[37, 81], [49, 83], [61, 81], [36, 70], [49, 72], [62, 70], [37, 59], [50, 61], [62, 59], [48, 50]];
  positions.forEach(([x, y], i) => parts.push(detail(`第${i + 1}颗实心珍珠`, ellipse(x, y, count > 6 ? 3.8 : 4.3), '#795c70')));
  if (v === 1) parts.push(detail('杯身心印', heart(51, 49, 16), '#fff0cf', 1.4));
  if (v === 2) parts.push(body('浮起大气泡', ellipse(31, 12, 6), '#c3e6df', 2.8), body('浮起小气泡', ellipse(44, 4, 3.4), '#ffd5bc', 2.8));
  if (v === 3) parts.push(body('左薄荷叶', leaf(37, 22, 0.55, -16), LEAF, 2.8), body('右薄荷叶', transform(leaf(0, 0, 0.5), 38, 21, -1, 1, 24), '#d0e9be', 2.8));
  parts.push(shine(path('M29 42 Q32 39 34 43 L37 60 Q37 66 33 65 Q30 65 30 59 Z')));
  parts.push(dot(34, 71, 1.6));
  return art(parts, p);
}

function bunnyFace(v: number): StickerArt {
  const p = MILK, parts: ArtPart[] = [];
  const silhouette = v === 3 ? 'M29 48 C22 29 22 8 32 7 C43 6 46 27 44 41 L56 41 C54 18 68 4 79 14 Q88 23 76 36 Q71 39 69 34 L67 46 C91 51 96 76 79 88 Q62 99 37 94 C13 92 6 71 17 56 Q21 50 29 48 Z' : 'M29 47 C20 29 23 5 33 5 C44 4 47 25 44 41 Q50 39 56 41 C54 22 58 3 68 7 C80 10 78 35 70 47 C91 53 96 75 79 88 Q62 99 37 94 C13 92 6 71 17 56 Q21 50 29 47 Z';
  parts.push(body(v === 3 ? '折耳兔外形' : '蓬松双耳兔外形', path(silhouette)));
  parts.push(detail('左耳草莓内耳', path('M31 15 C25 23 29 38 34 43 Q39 45 38 35 C38 24 36 14 31 15 Z'), '#f5a9c3'));
  parts.push(detail('右耳草莓内耳', path(v === 3 ? 'M62 35 Q59 23 68 17 Q76 15 77 22 Q75 29 68 31 L67 37 Z' : 'M66 17 C61 23 61 36 62 43 Q67 44 70 34 C74 21 70 15 66 17 Z'), '#f5a9c3'));
  parts.push(detail('兔脸奶糖下色面', path('M18 72 C25 79 35 82 50 82 Q73 82 85 68 Q87 85 70 90 Q47 98 29 88 Q20 83 18 72 Z'), '#ead5e8'));
  parts.push(...face(50, 66, v, 1));
  parts.push(detail('兔兔小鼻', heart(50, 69, 6.5), '#d98eaa'));
  if (v === 1) parts.push(body('花簪花瓣', flower(24, 42, 12, 5), '#ffcb91', 2.8), detail('花簪中心', ellipse(24, 42, 4.5), '#fff3c7'));
  if (v === 2) parts.push(...tinyBow(50, 92, 0.72));
  parts.push(shine(path('M22 58 Q27 50 35 51 Q41 53 35 56 Q28 56 27 62 Q23 67 21 63 Z')));
  parts.push(dot(42, 50, 1.8));
  return art(parts, p);
}

function littleGhost(v: number): StickerArt {
  const p = MILK, parts: ArtPart[] = [];
  const outlines = [
    'M23 77 L24 44 C22 11 72 7 77 39 L80 72 Q88 91 76 91 Q71 91 66 83 Q58 98 50 86 Q41 98 33 85 Q19 95 19 85 Z',
    'M19 66 C7 37 24 15 49 21 C72 24 73 48 68 61 Q83 67 92 55 Q102 76 80 88 Q58 99 43 82 Q19 83 19 66 Z',
    'M24 70 Q13 67 9 56 Q6 44 15 47 L25 54 L25 40 C25 8 75 9 76 41 L76 57 Q86 51 91 55 Q97 63 82 73 L80 84 Q77 96 65 86 Q56 98 48 87 Q35 99 28 86 Z',
    'M24 69 L24 43 C21 9 76 8 78 42 L79 70 Q86 93 69 93 Q62 93 59 85 Q54 100 44 94 Q39 92 37 86 Q22 98 19 86 Z',
  ];
  parts.push(body('奶糖幽灵外形', path(outlines[v])));
  const shadows = [
    'M27 64 Q49 80 76 59 L77 73 Q83 88 76 88 Q71 86 66 78 Q59 93 50 82 Q41 93 34 81 Q22 90 23 83 Z',
    'M23 61 Q38 77 59 67 Q78 78 92 63 Q94 79 77 86 Q58 94 44 78 Q28 80 23 61 Z',
    'M29 64 Q49 76 73 64 L77 82 Q75 90 65 81 Q56 93 48 83 Q36 94 31 83 Z',
    'M27 66 Q49 80 75 62 L76 74 Q83 90 69 89 Q62 88 59 79 Q54 96 45 90 L38 80 Q22 94 23 83 Z',
  ];
  parts.push(detail('幽灵薰衣草下色面', path(shadows[v]), 'secondary'));
  parts.push(...face(v === 1 ? 43 : 50, v === 1 ? 46 : 47, v === 1 ? 2 : v === 3 ? 3 : 0, 0.86));
  if (v === 2) parts.push(...tinyBow(51, 70, 0.6));
  if (v === 3) parts.push(body('左伴星', softStar(11, 32, 9, 4, 0.54), '#ffe1a0', 2.8), body('右伴星', softStar(88, 21, 10, 5, 0.6), '#ffb1ca', 2.8));
  parts.push(shine(path(v === 1 ? 'M22 40 Q25 29 34 28 Q41 30 35 34 Q29 35 28 42 Q24 47 22 43 Z' : 'M29 35 Q32 23 42 22 Q49 23 43 28 Q36 29 35 37 Q30 43 28 39 Z')));
  parts.push(dot(v === 1 ? 42 : 50, v === 1 ? 29 : 24, 1.8));
  return art(parts, p);
}

function witchHat(v: number): StickerArt {
  const p = LILAC, parts: ArtPart[] = [];
  parts.push(body('弯尖软巫师帽', path('M26 67 C34 49 37 28 48 14 Q61 1 79 10 Q87 13 81 19 Q67 17 65 28 Q66 48 79 65 Z')));
  parts.push(detail('帽尖回折暗面', path('M58 15 Q67 8 79 13 Q67 15 62 24 Q58 41 73 61 L59 64 Q48 42 58 15 Z'), p.shade));
  parts.push(body('桃子奶油帽带', path('M31 51 Q52 58 70 48 L76 63 Q54 77 27 66 Z'), 'secondary', 2.8));
  parts.push(detail('帽带右折面', path('M64 54 L70 51 L73 61 L65 65 Z'), '#eeb181'));
  parts.push(body('宽弯软帽檐', path('M23 65 C8 65 1 75 14 81 C38 95 80 91 95 78 Q103 70 88 67 Q78 71 55 74 Q37 74 23 65 Z')));
  parts.push(detail('帽檐下糖面', path('M14 76 Q42 91 90 75 Q86 84 63 87 Q32 89 14 79 Z'), p.shade));
  if (v === 0) parts.push(detail('奶油帽带方扣', hole(box(45, 55, 17, 13, 4), box(50, 59, 7, 5, 1)), '#fff2c9', 1.5));
  if (v === 1) parts.push(detail('帽身星印', softStar(49, 39, 11, 5, 0.62), '#ffe7b4', 1.5));
  if (v === 2) parts.push(body('帽带左叶', leaf(69, 61, 0.5, -30), LEAF, 2.8), body('帽带右叶', transform(leaf(0, 0, 0.48), 69, 61, -1, 1, 25), '#d6e5b8', 2.8), body('帽带莓果', ellipse(68, 63, 5.6), '#f498bb', 2.8));
  if (v === 3) parts.push(detail('帽身月印', crescent(51, 36, 24), '#fff0bc', 1.4), ...tinyBow(72, 68, 0.64));
  parts.push(shine(path('M39 41 Q40 28 47 22 Q53 19 51 25 Q46 30 45 42 Q42 48 39 44 Z')));
  parts.push(dot(51, 17, 1.7));
  return art(parts, p);
}

function controller(v: number): StickerArt {
  const p = MINT, parts: ArtPart[] = [];
  if (v === 3) parts.push(body('卷曲手柄线', path('M48 32 L48 21 Q48 11 59 12 L66 12 Q73 12 71 5 Q73 1 76 5 C80 18 68 19 61 17 Q53 15 53 23 L53 32 Z'), '#d3b8e8', 2.8));
  parts.push(body('胖握把手柄', path('M29 31 Q16 29 12 45 L6 71 Q4 88 17 89 Q26 88 36 73 L64 73 Q76 89 86 86 Q98 83 92 67 L87 43 Q84 29 70 31 Q50 36 29 31 Z')));
  parts.push(detail('奶油控制面板', path('M28 35 Q49 40 72 35 Q83 36 84 47 L86 59 Q76 65 65 65 L35 65 Q24 64 15 57 L18 44 Q20 35 28 35 Z'), 'secondary'));
  parts.push(detail('右握把薄荷暗面', path('M80 58 L87 55 L90 69 Q95 81 85 83 Q78 84 68 72 L66 68 Q77 74 81 72 Q85 71 80 58 Z'), p.shade));
  parts.push(detail('实心十字方向键', path('M24 44 Q24 42 27 42 L31 42 Q34 42 34 45 L34 50 L39 50 Q41 50 41 53 L41 57 L34 57 L34 63 L24 63 L24 57 L18 57 L18 50 L24 50 Z'), '#a48cbd', 1.5));
  if (v === 2) parts.push(detail('星形按键', softStar(72, 51, 8, 5, 0.61), '#ef96b6', 1.4));
  else {
    const buttons: Point[] = v === 3 ? [[74, 44], [82, 53], [74, 62], [66, 53]] : [[69, 56], [80, 47]];
    buttons.forEach(([x, y], i) => parts.push(detail(`实心游戏键${i + 1}`, ellipse(x, y, v === 3 ? 3.5 : 4.9), i % 2 ? '#f4a4c1' : '#c7ace3', 1.5)));
  }
  if (v === 1) parts.push(detail('中心爱心键', heart(52, 53, 15), '#f398b7', 1.4));
  else parts.push(detail('中心短键', box(46, 57, 11, 3.4, 1.5), '#a38fb9'));
  parts.push(shine(path('M17 41 Q20 32 29 35 Q34 39 28 40 Q23 38 22 45 Q19 50 16 47 Z')));
  parts.push(dot(36, 39, 1.8));
  return art(parts, p);
}

function camera(v: number): StickerArt {
  const p = v === 2 ? PINK : MINT, parts: ArtPart[] = [];
  if (v === 3) {
    parts.push(body('左侧背带环', hole(ellipse(12, 50, 10, 16), ellipse(12, 50, 4.5, 10)), 'secondary', 2.8));
    parts.push(body('右侧背带环', hole(ellipse(87, 50, 10, 16), ellipse(87, 50, 4.5, 10)), 'secondary', 2.8));
  }
  parts.push(body('相机取景顶座', path('M28 31 L33 20 Q35 17 39 17 L60 17 Q64 17 66 22 L71 31 Z'), 'secondary', 2.8));
  parts.push(body('相机软角机身', box(v === 2 ? 19 : 12, 29, v === 2 ? 63 : 77, v === 2 ? 49 : 54, 12)));
  parts.push(detail('奶油机身双色面', path(v === 2 ? 'M22 54 L79 54 L79 66 Q78 74 70 74 L31 74 Q22 74 22 66 Z' : 'M15 58 Q49 62 86 55 L86 69 Q86 80 76 80 L25 80 Q15 80 15 69 Z'), 'secondary'));
  parts.push(detail('右下相机糖面', path(v === 2 ? 'M73 35 Q79 38 79 46 L79 67 Q77 74 69 74 L31 74 L27 70 L68 70 Q74 70 74 63 Z' : 'M80 35 Q86 38 86 47 L86 70 Q85 80 74 80 L26 80 L22 75 L72 75 Q80 75 80 66 Z'), p.shade));
  if (v === 1) {
    parts.push(body('奶油爱心镜圈', heart(51, 51, 41), '#ffe1ad', 2.8));
    parts.push(detail('实心爱心镜片', heart(51, 51, 28), '#bda4df', 1.5));
    parts.push(detail('心镜下色面', path('M40 55 Q51 60 63 53 Q59 62 51 67 Q44 62 40 55 Z'), '#967abf'));
    parts.push(body('小闪光灯', softStar(82, 15, 12, 4, 0.48), '#ffe39f', 2.8));
  } else {
    parts.push(body('圆镜外环', ellipse(51, v === 2 ? 48 : 55, v === 2 ? 15 : 21), '#ffe3b4', 2.8));
    parts.push(detail('实心蓝紫镜片', ellipse(51, v === 2 ? 48 : 55, v === 2 ? 10.5 : 15), '#bca4df', 1.6));
    parts.push(detail('镜片折射色面', path(v === 2 ? 'M43 51 Q49 55 59 45 Q63 54 54 57 Q47 59 43 51 Z' : 'M39 59 Q50 64 63 49 Q69 61 57 67 Q45 73 39 59 Z'), '#9079b6'));
    if (v === 3) parts.push(line('双环镜头内圈', ellipse(51, 55, 10.6), '#e9d8f3', 1.5));
  }
  parts.push(detail('取景窗', box(66, 35, 12, 8, 3), '#fff1cd', 1.3));
  if (v === 2) {
    parts.push(detail('相纸出口', box(30, 66, 41, 5, 2), '#9c7298'));
    parts.push(body('即影即有相纸', path('M32 70 L69 70 L72 95 Q51 99 30 95 Z'), '#fff5df', 2.8));
    parts.push(detail('相纸蓝色画面', path('M36 74 L65 74 L67 89 L34 89 Z'), '#acdfdc'));
    parts.push(detail('相纸桃色山影', path('M35 86 L44 79 Q47 76 50 81 L54 85 L59 80 Q62 79 66 86 L67 89 L34 89 Z'), '#c2a8df'));
  }
  parts.push(shine(path('M19 40 Q22 33 32 34 Q39 37 33 40 L27 40 Q23 40 23 46 Q19 50 18 45 Z')));
  parts.push(dot(41, 36, 1.8));
  return art(parts, p);
}

function royalCrown(v: number): StickerArt {
  const p = GOLD, parts: ArtPart[] = [];
  const shapes = [
    'M18 70 L10 31 Q9 24 16 28 L33 43 L46 16 Q50 9 54 17 L67 43 L84 27 Q91 24 89 32 L82 71 Z',
    'M20 72 L12 34 Q11 28 18 31 L32 43 L46 7 Q50 0 54 8 L68 43 L82 30 Q89 26 88 34 L80 72 Z',
    'M17 70 L13 37 Q12 29 18 33 Q33 48 44 30 Q50 20 56 31 Q69 47 83 33 Q90 28 87 39 L82 70 Z',
    'M16 72 L10 39 Q9 33 15 35 L26 44 L31 23 Q33 17 37 24 L44 38 L48 12 Q50 5 53 13 L59 38 L68 23 Q72 18 73 25 L76 44 L87 35 Q93 32 91 40 L84 72 Z',
  ];
  parts.push(body('圆糖皇冠冠体', path(shapes[v])));
  parts.push(detail('皇冠蜂蜜折面', path('M69 47 L84 34 L78 69 L61 73 L28 71 L23 64 Q54 66 69 57 Z'), p.shade));
  parts.push(body('桃子冠底软带', path('M19 67 Q50 73 81 67 L81 80 Q51 91 19 80 Z'), 'secondary', 3));
  parts.push(detail('冠带下糖面', path('M23 77 Q50 84 77 76 L77 79 Q49 88 23 79 Z'), '#ed91af'));
  if (v === 1) parts.push(body('冠心爱心宝石', heart(50, 51, 25), '#f795b6', 2.8), detail('心宝石糖面', path('M42 54 Q50 59 59 49 Q60 57 50 63 Z'), '#d876a6'));
  else if (v === 2) {
    [[15, 30], [50, 23], [86, 29]].forEach(([x, y], i) => parts.push(body(`第${i + 1}颗冠顶珍珠`, ellipse(x, y, 7), '#fff3d9', 2.8)));
    parts.push(detail('冠带圆宝石', ellipse(50, 76, 5.4), '#b2ddd2', 1.6));
  } else parts.push(body('冠心菱形软宝石', path('M48 42 Q50 39 53 42 L61 52 Q62 55 59 58 L52 65 Q50 67 47 64 L40 56 Q38 53 41 50 Z'), '#b0dcd5', 2.8), detail('宝石右糖面', path('M51 44 L59 54 L51 63 Z'), '#79bdc2'));
  parts.push(shine(path('M21 45 Q24 41 27 47 L30 58 Q29 64 25 60 Q22 54 21 45 Z')));
  parts.push(dot(37, 52, 2.2));
  return art(parts, p);
}

function planet(v: number): StickerArt {
  const p = PINK, parts: ArtPart[] = [];
  const orbit = transform(hole(ellipse(0, 0, 48, 14), ellipse(0, 0, 39, 7)), 49, 51, 1, 1, -22);
  parts.push(body('后侧奶油行星环', orbit, 'secondary', 2.8));
  parts.push(body('圆软行星本体', v === 3 ? flower(49, 49, 29, 7) : ellipse(49, 49, 29)));
  parts.push(detail('行星右下莓糖面', path('M65 28 C87 42 76 73 52 76 Q37 77 29 64 C54 72 70 54 65 28 Z'), p.shade));
  parts.push(detail('行星奶油条带', path('M25 44 Q44 50 70 35 L75 43 Q48 58 23 52 Z'), '#ffd1c5'));
  if (v === 2) {
    parts.push(detail('大陨坑色面', ellipse(39, 35, 7.5, 5.5), '#d889b2', 1.4), detail('大陨坑内面', ellipse(38, 33.5, 5, 3), '#ffcbd7'));
    parts.push(detail('小陨坑色面', ellipse(59, 59, 5, 4), '#d889b2', 1.4), detail('下陨坑色面', ellipse(40, 64, 3.6, 2.5), '#d889b2'));
  }
  parts.push(body('前侧流动奶油环', path('M5 60 Q7 68 28 63 Q59 57 91 32 Q100 42 80 55 C55 73 21 84 7 74 Q0 70 5 60 Z'), 'secondary', 2.8));
  parts.push(detail('环带蜜桃下缘', path('M8 69 Q32 77 77 53 Q91 46 94 39 Q94 48 81 57 C54 74 23 81 9 72 Z'), '#efba78'));
  if (v === 1) {
    parts.push(body('左下小卫星', ellipse(18, 88, 8.5), '#b0ddd4', 2.8), detail('卫星下色面', path('M13 89 Q20 93 24 84 Q28 94 19 94 Q14 94 13 89 Z'), '#82bebc'));
    parts.push(body('右上伴星', softStar(84, 13, 10, 4, 0.55), '#d3b6eb', 2.8));
  }
  if (v === 3) {
    parts.push(body('通讯天线杆', path('M71 68 L76 66 L87 81 L82 84 Z'), '#b4dcd5', 2.8));
    parts.push(body('通讯小碟', path('M74 85 Q82 76 91 77 Q93 92 82 94 Q77 93 74 85 Z'), '#c8b0e7', 2.8));
    parts.push(line('通讯信号弧', path('M87 65 Q99 68 98 80 M89 58 Q106 62 105 81'), '#a779bc', 2));
  }
  parts.push(shine(path('M29 36 Q33 26 43 25 Q49 27 43 31 Q35 32 34 40 Q30 45 28 41 Z')));
  parts.push(dot(51, 25, 1.8));
  return art(parts, p);
}

function teaPot(v: number): StickerArt {
  const p = MINT, parts: ArtPart[] = [];
  parts.push(body('奶油壶把', hole(ellipse(78, 54, 17, 19), ellipse(78, 54, 10, 12)), 'secondary', 3));
  parts.push(detail('壶把右下蜜糖面', path('M90 43 Q99 63 81 70 L79 65 Q90 60 90 43 Z'), '#eab37c'));
  parts.push(body('弯曲上翘壶嘴', path('M32 47 Q18 47 13 33 Q9 28 4 31 Q1 37 7 40 Q11 42 13 56 Q17 70 32 68 Z'), 'secondary'));
  parts.push(detail('壶嘴内折面', path('M11 40 Q19 48 29 50 L29 61 Q19 61 17 52 Z'), '#edbc86'));
  if (v === 1) {
    parts.push(body('左小脚座', box(30, 78, 12, 12, 4), 'secondary', 2.8), body('右小脚座', box(61, 78, 12, 12, 4), 'secondary', 2.8));
    parts.push(body('方腹圆角壶身', box(24, 36, 55, 49, 14)));
    parts.push(detail('方壶下糖面', path('M28 66 Q49 78 75 60 L75 71 Q75 81 65 81 L38 81 Q28 81 28 71 Z'), p.shade));
  } else {
    parts.push(body('圆腹鼓鼓茶壶', path('M32 39 C15 49 18 77 35 84 Q52 91 70 81 C87 69 80 47 69 39 Z')));
    parts.push(detail('圆壶下糖面', path('M25 65 Q47 80 75 59 C80 77 64 86 48 85 Q30 83 25 65 Z'), p.shade));
  }
  parts.push(body('奶油壶盖', path('M28 40 Q28 30 50 29 Q72 29 74 40 Q52 48 28 40 Z'), 'secondary', 2.8));
  parts.push(body('软糖壶钮', ellipse(51, 25, 7, 6), '#f4a5c2', 2.8));
  if (v === 2) parts.push(detail('茶壶花印', flower(51, 61, 12, 5), '#ffe0a9', 1.5), detail('花印圆蕊', ellipse(51, 61, 4.4), '#f4a4bd'));
  if (v === 3) {
    parts.push(detail('茶壶心印', heart(51, 60, 22), '#ffd9ad', 1.5));
    parts.push(body('壶钮伴叶', leaf(59, 26, 0.53, 62), LEAF, 2.8));
  }
  parts.push(shine(path('M29 52 Q32 44 39 46 Q43 49 37 52 Q34 55 34 61 Q30 67 27 62 Q26 57 29 52 Z')));
  parts.push(dot(39, 42, 1.8));
  return art(parts, p);
}

function magicWand(v: number): StickerArt {
  const p = LILAC, parts: ArtPart[] = [body('弯角糖棒杖柄', path('M57 41 Q61 39 64 44 L31 94 Q28 99 23 96 Q19 93 23 88 Z'), 'secondary')];
  parts.push(detail('杖柄桃子侧面', path('M59 45 L61 46 L29 93 Q26 97 24 92 Z'), '#edb382'));
  parts.push(detail('杖柄缎带旋纹', path('M48 57 L55 60 L51 66 L44 63 Z M36 76 L43 78 L39 84 L32 82 Z'), '#e7a0c5'));
  if (v === 0) {
    parts.push(body('空心奶糖星杖头', hole(softStar(62, 30, 29, 5, 0.62), softStar(62, 30, 13, 5, 0.59))));
    parts.push(detail('星杖头右糖面', path('M79 26 L84 25 L78 35 L79 46 L69 42 L61 49 L58 42 L65 41 L72 37 L72 30 Z'), p.shade));
    parts.push(shine(path('M55 14 Q58 5 62 8 Q65 9 62 16 L58 20 Q53 22 53 18 Z')));
    parts.push(dot(45, 28, 1.6));
  } else if (v === 1) {
    parts.push(body('空心奶糖心杖头', hole(heart(63, 28, 56), heart(63, 28, 28)), '#f6b0ce'));
    parts.push(detail('心杖头右糖面', path('M82 16 Q95 29 65 51 L61 47 Q82 34 82 16 Z'), '#db8cbb'));
    parts.push(shine(path('M40 23 Q40 16 47 15 Q53 17 48 20 Q44 21 44 26 Q40 30 39 26 Z')));
    parts.push(dot(54, 18, 1.7));
  } else if (v === 2) {
    parts.push(body('柔软月牙杖头', crescent(58, 30, 57), '#ffe6b0'));
    parts.push(detail('月牙下糖面', path('M35 37 Q47 55 72 49 Q65 61 49 56 Q38 52 35 37 Z'), '#ebbd80'));
    parts.push(body('月伴小星', softStar(77, 23, 14, 5, 0.62), '#f6b0ce', 2.8));
    parts.push(shine(path('M36 25 Q39 14 48 11 Q53 11 50 16 Q43 20 41 28 Q37 33 35 29 Z')));
    parts.push(dot(42, 37, 1.8));
  } else {
    parts.push(body('奶糖花杖头', flower(64, 27, 23, 6), '#f8bed3'));
    parts.push(detail('花杖右下色面', path('M66 31 Q80 29 82 36 Q80 44 73 41 Q71 52 62 47 Q54 51 50 42 Q61 44 66 31 Z'), '#df8ab7'));
    parts.push(body('奶油花杖心', ellipse(64, 27, 8), '#ffe5a6', 2.8));
    parts.push(...tinyBow(49, 53, 0.75));
    parts.push(shine(path('M49 19 Q49 11 55 12 Q60 14 55 18 L53 23 Q48 27 47 22 Z')));
    parts.push(dot(63, 11, 1.8));
  }
  return art(parts, p);
}

const makers: Record<string, (variant: number) => StickerArt> = {
  starburst,
  'heart-token': heartToken,
  'classic-bow': classicBow,
  'garden-flower': gardenFlower,
  'layer-cake': layerCake,
  'ice-cream': iceCream,
  boba,
  'bunny-face': bunnyFace,
  'little-ghost': littleGhost,
  'witch-hat': witchHat,
  controller,
  camera,
  'royal-crown': royalCrown,
  planet,
  'tea-pot': teaPot,
  'magic-wand': magicWand,
};

export function candyArt(family: string, variant: number): StickerArt | undefined {
  if (!Object.hasOwn(makers, family) || !Number.isInteger(variant) || variant < 0 || variant > 3) return undefined;
  return makers[family](variant);
}
