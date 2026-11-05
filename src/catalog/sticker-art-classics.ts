import type { Command, GlyphPaint, TextStyle } from '../types';

type Shape = Command[];
type Part = { label: string; commands: Shape; paint: GlyphPaint };
type Art = { parts: Part[]; style?: Partial<TextStyle> };
type Palette = { primary: string; secondary: string; ink: string; depth: string };

const ROSE: Palette = { primary: '#f4a4c7', secondary: '#ffe6ac', ink: '#985879', depth: '#cf7ba2' };
const SKY: Palette = { primary: '#afe0ed', secondary: '#f5b1ce', ink: '#6589b4', depth: '#82afd0' };
const GOLD: Palette = { primary: '#ffda88', secondary: '#f5aecb', ink: '#a47560', depth: '#dca174' };
const VIOLET: Palette = { primary: '#cdb5e8', secondary: '#ffdcb0', ink: '#815e9c', depth: '#a483bf' };
const MILK: Palette = { primary: '#fff0d8', secondary: '#addce6', ink: '#92739e', depth: '#b59ac5' };
const CREAM = '#fffaf0';

function path(data: string): Shape {
  const tokens = data.match(/[MLQCZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) ?? [];
  const keys = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] } as const;
  const commands: Shape = [];
  for (let i = 0; i < tokens.length;) {
    const type = tokens[i++] as Command['type'];
    if (!(type in keys)) throw new Error(`Invalid classic-art command: ${type}`);
    const command: Command = { type };
    for (const key of keys[type]) {
      const value = Number(tokens[i++]);
      if (!Number.isFinite(value)) throw new Error(`Invalid classic-art coordinate: ${data}`);
      command[key] = value;
    }
    commands.push(command);
  }
  return commands;
}

function oval(x: number, y: number, rx: number, ry = rx): Shape {
  const k = 0.5522847498307936;
  return path(`M${x + rx} ${y} C${x + rx} ${y + ry * k} ${x + rx * k} ${y + ry} ${x} ${y + ry} C${x - rx * k} ${y + ry} ${x - rx} ${y + ry * k} ${x - rx} ${y} C${x - rx} ${y - ry * k} ${x - rx * k} ${y - ry} ${x} ${y - ry} C${x + rx * k} ${y - ry} ${x + rx} ${y - ry * k} ${x + rx} ${y} Z`);
}

function body(label: string, commands: Shape, fill: GlyphPaint['fill'] = 'primary'): Part {
  return { label, commands, paint: { fill, silhouette: true } };
}
function detail(label: string, commands: Shape, fill: GlyphPaint['fill'], opacity = 1): Part {
  return { label, commands, paint: { fill, stroke: 'none', strokeWidth: 0, silhouette: false, opacity } };
}
function line(label: string, commands: Shape, width = 2.2): Part {
  return { label, commands, paint: { fill: 'none', stroke: 'ink', strokeWidth: width, silhouette: false } };
}
function art(palette: Palette, parts: Part[]): Art {
  return { parts, style: {
    fill: palette.primary, fill2: palette.secondary, stroke: palette.ink, strokeWidth: 3.1,
    outerStroke: CREAM, outerWidth: 4.6, depth: 3, depthColor: palette.depth,
    shadowColor: palette.ink, shadowX: 1.2, shadowY: 2, shadowBlur: 0.8,
    gradient: false, texture: 'none', textureOpacity: 0, gloss: false,
    material: 'none', materialStrength: 0, opacity: 1,
  } };
}

const drawings: Record<string, () => Art> = {
  star: () => art(GOLD, [
    body('左侧翻起的糖带', path('M30 62 C19 59 12 67 8 80 Q18 77 26 85 L37 72 Z'), 'secondary'),
    body('偏心五角软星', path('M53 10 Q58 5 63 15 L75 36 L99 39 Q111 40 104 50 L87 69 L91 94 Q93 105 82 100 L59 87 L37 102 Q27 109 28 96 L31 72 L12 55 Q3 47 15 43 L39 37 Z')),
    detail('星尖下侧糖色', path('M36 76 Q58 86 80 73 L85 94 L61 81 L34 97 Z'), 'ink', 0.14),
    detail('斜抱星腹的宽糖带', path('M24 57 Q52 69 87 55 L91 64 Q67 83 34 70 Z'), 'secondary'),
    detail('左上鼓面亮弧', path('M44 33 Q48 19 54 17 Q59 15 57 23 L53 35 Q49 42 44 39 Q42 37 44 33 Z'), CREAM),
    detail('左肩短亮片', path('M20 48 Q29 43 35 44 Q40 46 34 50 L25 53 Q18 54 20 48 Z'), CREAM),
    line('糖带翻折接缝', path('M30 64 Q34 68 38 70'), 1.8),
  ]),
  sparkle: () => art(SKY, [
    body('向右上伸展的四芒糖光', path('M70 7 Q75 5 77 14 L82 39 Q84 45 91 48 L111 56 Q119 60 110 65 L88 74 Q82 77 80 85 L72 108 Q68 117 63 107 L54 82 Q52 77 44 74 L21 64 Q12 60 22 56 L47 46 Q54 43 57 35 L65 12 Q67 7 70 7 Z')),
    detail('四芒右下冷色面', path('M73 47 Q79 59 100 62 L82 69 Q75 73 73 84 L69 98 L64 77 Q65 63 73 47 Z'), 'ink', 0.16),
    body('左下圆角伴光', path('M24 73 Q28 72 30 80 L33 90 L44 95 Q50 98 43 102 L34 105 L30 117 Q27 123 23 116 L18 106 L8 102 Q1 99 9 95 L19 91 L21 80 Q22 74 24 73 Z'), 'secondary'),
    detail('主光沿肩宽亮片', path('M63 33 Q67 20 71 19 Q75 20 72 31 L67 43 Q64 48 60 45 Q58 43 63 33 Z'), CREAM),
    detail('伴光白点', oval(23, 95, 3.2, 4.3), CREAM),
    body('右上粉色糖珠', oval(103, 24, 8, 7), 'secondary'),
    detail('糖珠亮面', oval(101, 22, 2.8, 2), CREAM),
  ]),
  heart: () => art(ROSE, [
    body('斜倚软糖心', path('M60 31 C48 8 19 13 12 35 C2 64 36 90 61 109 Q67 113 72 107 C92 89 115 57 104 34 C95 13 71 15 60 31 Z')),
    detail('右下收拢暗面', path('M100 47 C106 68 83 95 68 105 L59 98 Q86 76 100 47 Z'), 'ink', 0.14),
    detail('左肩奶光', path('M25 34 C31 24 43 25 48 31 Q52 36 47 38 Q43 39 38 35 Q32 35 29 42 Q26 47 22 43 Q20 40 25 34 Z'), CREAM),
    detail('缝在心口的奶油补片', path('M37 62 Q48 57 57 61 L75 77 Q79 81 73 86 L59 96 Q55 99 51 94 L32 76 Q28 70 37 62 Z'), 'secondary'),
    line('补片上方两针', path('M40 64 L44 69 M50 62 L54 67'), 2),
    line('补片下方两针', path('M54 87 L50 92 M65 81 L70 86'), 2),
    detail('右肩小亮豆', oval(87, 35, 4, 3), CREAM),
  ]),
  bow: () => art(ROSE, [
    body('左尾回卷', path('M57 54 C48 75 40 93 22 96 Q11 98 10 87 Q17 91 24 84 L43 53 Z'), 'secondary'),
    body('右尾短燕口', path('M65 56 Q85 64 96 93 L82 88 L73 100 Q71 76 59 66 Z')),
    body('宽左结耳', path('M58 43 C35 13 5 12 9 35 L12 63 Q18 86 55 59 Z')),
    detail('左结耳内褶', path('M19 34 Q38 31 55 48 L51 56 Q36 54 22 65 Q28 49 19 34 Z'), 'ink', 0.14),
    body('上翘右结耳', path('M67 42 C85 17 107 13 110 30 Q115 55 94 66 Q83 68 69 56 Z'), 'secondary'),
    detail('右结耳折色', path('M96 32 Q91 48 72 49 L73 57 Q91 62 103 47 Z'), 'primary'),
    body('偏右奶糖结扣', path('M57 36 Q64 32 71 38 L78 54 Q79 61 71 65 L61 65 Q54 64 53 56 L52 43 Q52 39 57 36 Z'), 'secondary'),
    detail('左耳随形亮片', path('M20 25 Q29 22 43 31 Q49 35 45 39 Q42 40 36 36 Q29 31 24 33 Q17 35 17 30 Q17 27 20 25 Z'), CREAM),
    detail('结扣竖亮片', path('M59 42 Q61 39 64 42 L68 52 Q69 57 65 57 Q61 56 59 48 Z'), CREAM),
    line('右尾折线', path('M72 66 Q81 75 83 83'), 1.8),
  ]),
  candy: () => art(ROSE, [
    body('左上扭口扇纸', path('M36 42 L21 22 Q16 17 14 24 L8 40 Q4 45 10 49 L25 63 L42 56 Z'), 'secondary'),
    body('右下扭口扇纸', path('M84 63 L104 53 Q111 50 112 58 L110 72 L116 86 Q118 94 110 92 L91 88 L78 76 Z'), 'secondary'),
    line('左糖纸宽褶', path('M14 33 L31 45 M14 45 L30 50'), 2),
    line('右糖纸宽褶', path('M92 72 L107 65 M92 78 L108 84'), 2),
    body('斜放椭圆糖果', path('M36 34 C49 27 80 41 91 57 C103 78 87 92 69 87 C49 81 26 66 25 51 Q24 40 36 34 Z')),
    detail('糖果下侧色面', path('M30 55 Q48 75 75 79 Q88 82 94 70 Q93 85 80 86 Q55 87 35 67 Z'), 'ink', 0.14),
    detail('奶油弯卷夹心', path('M56 35 Q42 42 45 53 Q49 63 63 63 Q74 62 75 54 L84 59 Q89 74 72 77 Q52 80 40 64 Q29 47 46 34 Z'), 'secondary'),
    detail('糖果肩部宽光', path('M36 40 Q42 36 48 39 Q51 43 45 45 Q37 47 36 53 Q34 58 30 53 Q28 46 36 40 Z'), CREAM),
    detail('糖果右肩亮豆', path('M66 42 Q71 42 78 47 Q83 52 78 54 Q74 55 68 49 Q63 46 66 42 Z'), CREAM),
  ]),
  ghost: () => art(MILK, [
    body('困困幽灵卷尾', path('M28 44 C20 13 64 2 80 26 Q89 39 84 56 C85 73 104 80 114 73 Q118 87 102 94 Q90 100 77 90 Q78 108 63 111 Q52 112 47 102 Q36 118 23 104 Q16 96 21 85 Q3 88 7 72 Q10 60 28 56 Z')),
    detail('卷尾内侧柔紫面', path('M65 76 Q79 87 91 86 Q104 89 111 82 Q109 93 98 93 Q84 94 75 85 Q76 100 64 105 Q55 107 51 99 Q60 94 65 76 Z'), 'ink', 0.15),
    body('向右飘的小围巾尾', path('M67 65 Q88 54 102 60 L96 70 L105 78 Q90 83 72 76 Z'), 'secondary'),
    detail('围巾前围', path('M25 63 Q48 73 73 59 L75 70 Q51 84 24 74 Z'), 'secondary'),
    line('左侧困倦眼', path('M35 45 Q39 48 43 44'), 2.5),
    detail('右侧豆眼', oval(62, 44, 3.4, 4.8), 'ink'),
    detail('小嘴', oval(51, 56, 2.5, 3.2), 'ink'),
    detail('左脸糖粉', oval(30, 53, 6, 3), '#f3b7d2'),
    detail('右脸糖粉', oval(69, 53, 5.5, 3), '#f3b7d2'),
    detail('兜里的奶星', path('M40 82 L46 86 L53 84 L51 91 L55 97 L48 97 L43 102 L41 95 L35 92 L40 88 Z'), 'secondary'),
    detail('额头短弧光', path('M34 29 Q41 19 51 20 Q57 22 52 25 Q42 27 39 33 Q35 38 32 34 Q31 32 34 29 Z'), CREAM),
  ]),
  bat: () => art(VIOLET, [
    body('抬高的左折翼', path('M48 55 C29 49 28 21 10 15 Q15 38 7 58 Q4 66 15 65 Q25 64 29 79 Q36 71 49 80 Z')),
    detail('左翼内膜', path('M16 29 Q28 43 36 55 L42 70 Q32 66 29 70 Q24 56 14 57 Q20 44 16 29 Z'), 'secondary'),
    body('展开的右宽翼', path('M68 53 C82 36 107 33 118 28 Q113 41 117 61 Q102 55 98 75 Q85 63 77 86 L67 76 Z')),
    detail('右翼内膜', path('M78 55 Q92 44 110 39 Q107 48 109 53 Q98 52 94 65 Q86 58 78 68 Z'), 'secondary'),
    body('尖耳胖蝠身体', path('M44 49 L40 25 Q41 20 47 25 L59 36 L71 24 Q77 20 77 27 L75 50 Q88 63 79 85 Q72 102 59 99 Q42 95 38 79 Q34 61 44 49 Z')),
    detail('奶油圆腹', path('M46 73 Q47 60 59 61 Q74 60 74 77 Q73 93 61 93 Q48 92 46 73 Z'), 'secondary'),
    detail('左耳绒面', path('M44 29 L46 44 L53 39 Z'), '#ed9ec2'),
    detail('右耳绒面', path('M73 29 L64 40 L72 44 Z'), '#ed9ec2'),
    detail('左侧椭眼', oval(49, 56, 3.8, 5), 'ink'),
    line('眨起的右眼', path('M64 56 Q69 51 73 56'), 2.5),
    detail('单颗奶牙', path('M58 62 Q62 64 66 62 L62 70 Q60 70 58 62 Z'), CREAM),
    line('左翼折骨', path('M34 48 L29 58'), 1.8),
    detail('左额软光', path('M46 46 Q49 42 54 43 Q57 45 52 47 L48 49 Q44 50 46 46 Z'), CREAM),
  ]),
  moon: () => art({ ...GOLD, secondary: '#a8dbe6' }, [
    body('向右弯的胖月牙', path('M80 12 C41 0 12 26 12 62 C12 99 47 120 83 104 Q103 95 109 78 C92 92 67 89 54 74 C37 53 49 25 80 12 Z')),
    detail('月牙底侧蜜色', path('M18 75 Q37 104 70 102 Q88 101 102 88 Q91 108 65 110 Q29 112 18 75 Z'), 'ink', 0.15),
    detail('月背宽弧奶光', path('M34 31 Q41 21 51 19 Q57 18 55 23 Q43 29 37 42 Q34 49 30 46 Q27 42 34 31 Z'), CREAM),
    line('月亮打盹眼', path('M26 60 Q32 66 40 61'), 2.8),
    detail('月颊糖粉', oval(32, 72, 7, 4), '#f5aecb'),
    body('斜抱的蓝色软枕', path('M64 69 Q68 64 76 68 L101 77 Q108 80 105 88 L99 104 Q96 112 87 109 L63 100 Q56 96 59 89 Z'), 'secondary'),
    detail('软枕下褶', path('M62 91 Q73 100 95 104 L91 106 L64 97 Z'), 'ink', 0.13),
    detail('软枕角光', path('M68 72 Q73 71 80 75 Q85 79 80 81 L69 78 Q65 77 68 72 Z'), CREAM),
    line('软枕两侧短缝', path('M65 85 L63 90 M101 84 L99 90'), 1.8),
  ]),
  flower: () => art(ROSE, [
    body('左后翻叶', path('M50 88 C29 66 9 76 8 96 Q24 111 52 96 Z'), '#addcd3'),
    body('右后卷叶', path('M64 90 Q84 68 107 81 Q106 103 77 107 L61 100 Z'), '#addcd3'),
    detail('左叶折色', path('M13 95 Q30 88 48 95 Q29 103 13 95 Z'), 'ink', 0.14),
    body('斜倚五瓣奶花', path('M46 31 C39 8 68 0 78 19 Q82 25 79 33 C105 22 121 49 101 63 Q97 66 91 67 C108 89 84 110 65 96 Q61 93 59 87 C44 109 17 97 20 76 Q20 70 25 65 C2 59 6 29 27 27 Q38 25 46 31 Z')),
    detail('右瓣糖色', path('M83 37 Q102 28 106 45 Q109 57 94 62 Q87 58 82 52 Z'), 'secondary'),
    detail('下瓣暗面', path('M66 82 Q80 98 92 87 Q85 101 72 95 Q66 92 62 86 Z'), 'ink', 0.14),
    body('偏左的奶油花心', oval(53, 58, 21, 18), 'secondary'),
    detail('花心下色面', path('M35 62 Q53 74 71 61 Q66 75 53 74 Q40 74 35 62 Z'), 'ink', 0.12),
    detail('左上花瓣亮弧', path('M17 38 Q22 30 33 34 Q39 37 35 40 Q31 42 27 39 Q23 40 22 45 Q17 50 15 45 Q14 41 17 38 Z'), CREAM),
    detail('花心奶豆光', oval(46, 52, 7, 4), CREAM),
    line('右叶短叶脉', path('M77 98 Q87 91 98 88'), 1.8),
  ]),
  bubble: () => art(SKY, [
    body('右后粉色回复页', path('M75 10 Q107 4 113 27 L115 48 Q116 63 103 70 L112 82 L91 76 Q77 72 72 57 L67 29 Q65 15 75 10 Z'), 'secondary'),
    body('左垂尾的软方对话泡', path('M29 23 C48 16 88 18 98 37 Q109 63 92 79 Q73 94 45 87 L24 106 Q17 112 19 102 L22 85 Q4 80 5 58 Q5 32 29 23 Z')),
    detail('对话泡下侧蓝色面', path('M10 67 Q36 90 74 81 Q92 78 100 64 Q97 82 77 87 Q59 94 40 85 L24 101 L27 81 Q15 80 10 67 Z'), 'ink', 0.14),
    detail('对话泡左肩宽亮弧', path('M19 35 Q31 25 45 28 Q51 30 47 34 Q34 33 25 42 Q20 47 17 43 Q15 40 19 35 Z'), CREAM),
    detail('左侧奶油声点', oval(35, 57, 6, 6), 'secondary'),
    detail('中间奶油声点', oval(55, 57, 6, 6), 'secondary'),
    detail('右侧奶油声点', oval(75, 57, 6, 6), 'secondary'),
    detail('回复页折角亮片', path('M90 15 Q103 16 106 28 Q105 33 102 30 Q98 22 91 22 Q86 21 90 15 Z'), CREAM),
  ]),
  crown: () => art(GOLD, [
    body('错高软尖奶皇冠', path('M15 33 Q13 26 20 30 L42 50 L57 16 Q60 10 64 17 L79 48 L103 27 Q109 22 108 31 L100 86 Q99 95 89 97 L32 99 Q22 99 21 88 Z')),
    detail('皇冠右侧蜜面', path('M96 44 L102 36 L96 87 Q94 94 84 94 L78 90 Q94 80 96 44 Z'), 'ink', 0.15),
    body('左奶珠尖', oval(16, 30, 7), 'secondary'),
    body('中奶珠尖', oval(60, 13, 8), 'secondary'),
    body('右奶珠尖', oval(108, 26, 7), 'secondary'),
    body('向左轻斜的冠带', path('M23 77 Q62 83 100 72 L99 88 Q98 97 87 98 L33 101 Q23 100 22 92 Z'), 'secondary'),
    detail('冠带奶油上沿', path('M27 82 Q62 86 96 78 L95 83 Q62 92 28 88 Z'), CREAM),
    body('偏心菱糖宝石', path('M58 67 Q61 62 65 67 L75 78 Q79 82 74 87 L63 98 Q59 102 55 97 L46 86 Q42 81 47 76 Z'), '#a7dcd6'),
    detail('菱糖半面', path('M61 69 L61 96 L49 82 Z'), CREAM),
    detail('左冠肩宽光', path('M26 42 Q29 41 32 47 L38 61 Q39 66 35 65 Q31 65 29 58 L25 47 Q24 44 26 42 Z'), CREAM),
    detail('中心奶珠亮点', oval(58, 11, 2.8), CREAM),
  ]),
  ribbon: () => art(SKY, [
    body('左上翻卷的旗耳', path('M32 29 Q12 9 6 27 L4 56 Q4 67 20 69 L35 57 Z'), 'secondary'),
    detail('左卷耳内面', path('M10 28 Q16 22 30 36 L27 48 Q17 35 10 39 Z'), 'ink', 0.15),
    body('右下回折的燕尾', path('M88 64 Q105 58 116 65 L108 81 L115 96 Q102 102 86 87 L77 74 Z'), 'secondary'),
    detail('右燕尾背面', path('M91 69 Q101 65 110 68 L103 79 L111 92 Q101 88 91 80 Z'), 'ink', 0.15),
    body('鼓起的斜弧横幅', path('M19 35 Q59 23 101 40 Q107 43 104 50 L97 77 Q95 83 88 81 Q51 69 20 83 Q13 86 14 77 L12 45 Q11 38 19 35 Z')),
    detail('横幅下卷暗面', path('M17 68 Q53 54 99 70 L97 77 Q95 82 88 79 Q50 68 18 81 Z'), 'ink', 0.13),
    detail('奶油波浪正面条', path('M20 47 Q54 36 97 49 L94 60 Q54 47 21 60 Z'), 'secondary'),
    detail('左肩宽亮片', path('M20 39 Q30 35 40 36 Q45 39 40 42 L23 46 Q17 46 18 42 Z'), CREAM),
    line('左翻耳接缝', path('M15 59 L17 73'), 1.8),
    line('右回折接缝', path('M98 76 L90 84'), 1.8),
  ]),
};

export function classicArt(id: string): { parts: { label: string; commands: Command[]; paint: GlyphPaint }[]; style?: Partial<TextStyle> } | undefined {
  return Object.hasOwn(drawings, id) ? drawings[id]() : undefined;
}
