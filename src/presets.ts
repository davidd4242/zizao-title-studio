import { BASE_LAYER, DEFAULT_STYLE } from './types';
import type { Command, Glyph, GradientStop, Layer, Material, TextStyle } from './types';
import { newId } from './engine';
import { EXTRA_STYLE_PRESETS } from './catalog/styles';
import { EXTRA_STICKERS } from './catalog/stickers';
import { classicArt } from './catalog/sticker-art-classics';
import { paintedStickerGeometry } from './catalog/sticker-geometry';
import type { StickerPreset, StylePreset } from './catalog/types';

function style(changes: Partial<TextStyle>): TextStyle {
  return { ...DEFAULT_STYLE, ...changes, ...(changes.gradientStops ? { gradientStops: changes.gradientStops.map(stop => ({ ...stop })) } : {}) };
}

const CLASSIC_STYLE_PRESETS: { id: string; name: string; description: string; style: TextStyle }[] = [
  { id: 'candy-cream', name: '糖果奶油', description: '草莓渐变、奶油白边与细糖霜网点', style: style({ fill: '#ffd6df', fill2: '#f778a2', stroke: '#b94c76', strokeWidth: 2.5, outerStroke: '#fffdf7', outerWidth: 13, depth: 6, depthColor: '#c3547d', shadowColor: '#92637c', shadowX: 5, shadowY: 10, shadowBlur: 3, textureOpacity: 0.36 }) },
  { id: 'orange-soda', name: '橘子汽水', description: '橘黄汽泡、厚白边与明快斜纹', style: style({ fill: '#fff29b', fill2: '#ff891f', gradientAngle: 70, stroke: '#b84e20', strokeWidth: 3, outerStroke: '#fffdf0', outerWidth: 12, depth: 9, depthColor: '#e56827', shadowColor: '#97553c', shadowX: 7, shadowY: 9, shadowBlur: 2, texture: 'stripes', textureColor: '#fff8cf', textureOpacity: 0.25 }) },
  { id: 'halloween', name: '万圣夜游', description: '南瓜橘、墨紫包边与幽灵色厚底', style: style({ fill: '#ffd05c', fill2: '#f56a25', stroke: '#39213f', strokeWidth: 6, outerStroke: '#fff0c9', outerWidth: 10, depth: 12, depthColor: '#503260', shadowColor: '#25172f', shadowX: 9, shadowY: 12, shadowBlur: 3, texture: 'dots', textureColor: '#6c294b', textureOpacity: 0.18, gloss: false }) },
  { id: 'purple-candy', name: '深紫糖果', description: '葡萄糖衣、蓝莓切边与亮面高光', style: style({ fill: '#e6b6ff', fill2: '#7940bf', gradientAngle: 105, stroke: '#4c2677', strokeWidth: 4, outerStroke: '#faf0ff', outerWidth: 12, depth: 10, depthColor: '#452470', shadowColor: '#37214e', shadowX: 7, shadowY: 12, shadowBlur: 4, texture: 'dots', textureColor: '#fff0ff', textureOpacity: 0.32 }) },
  { id: 'ice-blue', name: '冰蓝苏打', description: '冰透蓝白、轻薄描边与干净冷影', style: style({ fill: '#e2ffff', fill2: '#58bdf1', gradientAngle: 90, stroke: '#2f83b4', strokeWidth: 2.5, outerStroke: '#ffffff', outerWidth: 11, depth: 5, depthColor: '#438bb7', shadowColor: '#426e9a', shadowX: 4, shadowY: 8, shadowBlur: 5, texture: 'stripes', textureOpacity: 0.18 }) },
  { id: 'black-gold', name: '黑金剧场', description: '暖金金属、黑色立体底与香槟外线', style: style({ fill: '#ffe9a2', fill2: '#b58429', gradientAngle: 85, stroke: '#251f21', strokeWidth: 5, outerStroke: '#f1d38b', outerWidth: 3.5, depth: 9, depthColor: '#302829', shadowColor: '#171315', shadowX: 7, shadowY: 10, shadowBlur: 5, texture: 'none', textureOpacity: 0, gloss: true }) },
  { id: 'sakura', name: '樱花来信', description: '浅樱粉、暖纸边与柔软豆沙阴影', style: style({ fill: '#fff3f6', fill2: '#f4b5ca', gradientAngle: 110, stroke: '#c7809b', strokeWidth: 2, outerStroke: '#fffef9', outerWidth: 10, depth: 3, depthColor: '#ce8ca9', shadowColor: '#ad7e96', shadowX: 3, shadowY: 6, shadowBlur: 4, texture: 'dots', textureColor: '#ffffff', textureOpacity: 0.6, gloss: false }) },
  { id: 'ink', name: '墨色书法', description: '浓墨轮廓、宣纸留白与克制浅影', style: style({ fill: '#252e2c', fill2: '#252e2c', gradient: false, stroke: '#131a18', strokeWidth: 0.8, outerStroke: '#fffdf5', outerWidth: 7, depth: 0, depthColor: '#333d37', shadowColor: '#9faaa0', shadowX: 2, shadowY: 4, shadowBlur: 1.5, texture: 'none', textureOpacity: 0, gloss: false }) },
  { id: 'mint', name: '薄荷邮票', description: '薄荷绿、森林描边与复古圆点', style: style({ fill: '#d8f8d9', fill2: '#64c5a0', gradientAngle: 90, stroke: '#356c5e', strokeWidth: 3, outerStroke: '#fff8df', outerWidth: 10, depth: 7, depthColor: '#3c9279', shadowColor: '#42685a', shadowX: 6, shadowY: 8, shadowBlur: 2, texture: 'dots', textureColor: '#faffeb', textureOpacity: 0.45, gloss: false }) },
  { id: 'cherry-pop', name: '樱桃电台', description: '珊瑚红、奶油粗边与漫画立体感', style: style({ fill: '#ff9d99', fill2: '#e23f60', gradientAngle: 80, stroke: '#8e244a', strokeWidth: 4, outerStroke: '#fff4dd', outerWidth: 13, depth: 11, depthColor: '#a12c4e', shadowColor: '#703648', shadowX: 8, shadowY: 11, shadowBlur: 2, texture: 'stripes', textureColor: '#ffe5dd', textureOpacity: 0.2 }) },
];

export const STYLE_PRESETS: StylePreset[] = [
  ...CLASSIC_STYLE_PRESETS.map(p => ({ ...p, category: '经典精选', tags: ['经典', p.name, p.description] })),
  ...EXTRA_STYLE_PRESETS,
];

export const GRADIENT_PRESETS: { id: string; name: string; stops: GradientStop[]; angle: number; type: 'linear' | 'radial' }[] = [
  { id: 'peach-sorbet', name: '蜜桃雪酪', angle: 95, type: 'linear', stops: [{ offset: 0, color: '#fff4ad' }, { offset: 0.3, color: '#ffc18f' }, { offset: 0.66, color: '#ff8cb1' }, { offset: 1, color: '#bc79da' }] },
  { id: 'aurora', name: '极光折射', angle: 120, type: 'linear', stops: [{ offset: 0, color: '#d8ffe9' }, { offset: 0.22, color: '#75ebca' }, { offset: 0.48, color: '#61c9f1' }, { offset: 0.74, color: '#9386eb' }, { offset: 1, color: '#e599dd' }] },
  { id: 'sunset-pop', name: '落日汽水', angle: 75, type: 'linear', stops: [{ offset: 0, color: '#fff7b5' }, { offset: 0.24, color: '#ffd369' }, { offset: 0.56, color: '#ff8d50' }, { offset: 0.8, color: '#f25078' }, { offset: 1, color: '#853d85' }] },
  { id: 'holo-candy', name: '镭射糖纸', angle: 135, type: 'linear', stops: [{ offset: 0, color: '#fff0fa' }, { offset: 0.18, color: '#bca9ff' }, { offset: 0.38, color: '#91eaf2' }, { offset: 0.56, color: '#e3f7b2' }, { offset: 0.78, color: '#ffb7c7' }, { offset: 1, color: '#bdb5ff' }] },
  { id: 'champagne', name: '香槟金箔', angle: 90, type: 'linear', stops: [{ offset: 0, color: '#fff6d6' }, { offset: 0.2, color: '#d6aa62' }, { offset: 0.44, color: '#fff7d8' }, { offset: 0.5, color: '#a56e30' }, { offset: 0.72, color: '#f1cb7d' }, { offset: 1, color: '#9c6328' }] },
  { id: 'berry-core', name: '莓果流心', angle: 90, type: 'radial', stops: [{ offset: 0, color: '#fff0db' }, { offset: 0.3, color: '#ffc3d0' }, { offset: 0.68, color: '#e576ae' }, { offset: 1, color: '#773b9b' }] },
  { id: 'arctic-pearl', name: '冰川珍珠', angle: 90, type: 'radial', stops: [{ offset: 0, color: '#ffffff' }, { offset: 0.35, color: '#d1fffa' }, { offset: 0.65, color: '#94d6ec' }, { offset: 1, color: '#7488c5' }] },
  { id: 'neon-orbit', name: '霓虹轨道', angle: 25, type: 'linear', stops: [{ offset: 0, color: '#baf95e' }, { offset: 0.2, color: '#67efc0' }, { offset: 0.45, color: '#68b9ff' }, { offset: 0.68, color: '#c679f4' }, { offset: 1, color: '#ff82b3' }] },
];

export const MATERIAL_PRESETS: { id: Material; name: string; description: string; style: Partial<TextStyle> }[] = [
  { id: 'none', name: '原色', description: '保留当前颜色、描边与纹理', style: { material: 'none', materialStrength: 0.8 } },
  { id: 'metal', name: '镜面金属', description: '明暗反射带与细密横向拉丝', style: { material: 'metal', materialStrength: 0.85 } },
  { id: 'glass', name: '磨砂玻璃', description: '半透感折射光带、颗粒与明亮内沿', style: { material: 'glass', materialStrength: 0.75 } },
  { id: 'jelly', name: '流心软糖', description: '圆润体积光、高光斑与饱满糖衣边缘', style: { material: 'jelly', materialStrength: 0.85 } },
  { id: 'paper', name: '棉质纸张', description: '固定纸纤维、细颗粒与暖色纸面', style: { material: 'paper', materialStrength: 0.8 } },
  { id: 'neon', name: '霓虹灯管', description: '轮廓内发光、亮芯与深色对比灯面', style: { material: 'neon', materialStrength: 0.9 } },
];

const M = (x: number, y: number): Command => ({ type: 'M', x, y });
const L = (x: number, y: number): Command => ({ type: 'L', x, y });
const Q = (x1: number, y1: number, x: number, y: number): Command => ({ type: 'Q', x1, y1, x, y });
const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): Command => ({ type: 'C', x1, y1, x2, y2, x, y });
const Z = (): Command => ({ type: 'Z' });

function circle(x: number, y: number, radius: number): Command[] {
  const k = radius * 0.5522847498;
  return [M(x + radius, y), C(x + radius, y + k, x + k, y + radius, x, y + radius), C(x - k, y + radius, x - radius, y + k, x - radius, y), C(x - radius, y - k, x - k, y - radius, x, y - radius), C(x + k, y - radius, x + radius, y - k, x + radius, y), Z()];
}

function glyph(id: string, width: number, height: number, commands: Command[], x = 0, y = 0): Glyph {
  return { id, char: '', x, y, width, height, commands };
}

function stickerStyle(presetId: string, changes: Partial<TextStyle> = {}): TextStyle {
  const base = STYLE_PRESETS.find(preset => preset.id === presetId)!.style;
  return { ...base, strokeWidth: 2, outerWidth: 4, depth: 3, shadowX: 2, shadowY: 4, shadowBlur: 1.5, textureOpacity: 0.2, ...changes };
}

function sparkle(id: string, size: number, x: number, y: number): Glyph {
  const half = size / 2;
  return glyph(id, size, size, [M(half, 0), Q(half * 1.22, half * 0.78, size, half), Q(half * 1.22, half * 1.22, half, size), Q(half * 0.78, half * 1.22, 0, half), Q(half * 0.78, half * 0.78, half, 0), Z()], x, y);
}

const CLASSIC_STICKERS: { id: string; name: string; category: string; glyphs: Glyph[]; width: number; height: number; style: TextStyle }[] = [
  {
    id: 'star', name: '软糖星星', category: '闪亮', width: 132, height: 126,
    style: stickerStyle('orange-soda', { texture: 'dots', gloss: true }),
    glyphs: [glyph('star-body', 112, 112, [M(56, 5), Q(59, 3, 62, 10), L(74, 36), L(102, 40), Q(111, 42, 104, 49), L(84, 69), L(89, 98), Q(91, 108, 82, 103), L(56, 89), L(30, 103), Q(21, 108, 23, 98), L(28, 69), L(8, 49), Q(1, 42, 10, 40), L(38, 36), L(50, 10), Q(53, 3, 56, 5), Z()], 1, 12), sparkle('star-twinkle', 24, 106, 2)],
  },
  {
    id: 'sparkle', name: '三重闪光', category: '闪亮', width: 124, height: 132,
    style: stickerStyle('black-gold', { stroke: '#b47830', strokeWidth: 1.5, outerStroke: '#fff9e6', depth: 2, texture: 'none' }),
    glyphs: [sparkle('sparkle-main', 94, 0, 28), sparkle('sparkle-top', 36, 85, 1), sparkle('sparkle-lower', 25, 96, 101)],
  },
  {
    id: 'heart', name: '怦然爱心', category: '心意', width: 132, height: 126,
    style: stickerStyle('cherry-pop', { texture: 'dots', outerWidth: 5 }),
    glyphs: [glyph('heart-body', 116, 116, [M(58, 108), C(43, 94, 5, 69, 5, 38), C(5, 9, 39, 0, 58, 25), C(77, 0, 111, 9, 111, 38), C(111, 69, 73, 94, 58, 108), Z()], 2, 9), sparkle('heart-spark', 22, 108, 0)],
  },
  {
    id: 'bow', name: '礼物蝴蝶结', category: '心意', width: 154, height: 126,
    style: stickerStyle('candy-cream', { fill: '#ffd7e9', fill2: '#ee7bb5', texture: 'stripes', outerWidth: 4.5 }),
    glyphs: [
      glyph('bow-tail-left', 67, 76, [M(43, 1), C(32, 26, 19, 46, 2, 62), L(26, 61), L(33, 75), C(49, 53, 59, 31, 64, 9), Z()], 11, 47),
      glyph('bow-tail-right', 67, 76, [M(24, 1), C(35, 26, 48, 46, 65, 62), L(41, 61), L(34, 75), C(18, 53, 8, 31, 3, 9), Z()], 76, 47),
      glyph('bow-left', 76, 72, [M(70, 39), C(52, 19, 24, 0, 9, 6), C(-1, 19, 1, 55, 13, 64), C(26, 71, 56, 52, 70, 45), Z()], 0, 0),
      glyph('bow-right', 76, 72, [M(6, 39), C(24, 19, 52, 0, 67, 6), C(77, 19, 75, 55, 63, 64), C(50, 71, 20, 52, 6, 45), Z()], 78, 0),
      glyph('bow-knot', 32, 38, [M(7, 2), Q(16, -1, 25, 2), Q(34, 19, 26, 35), Q(16, 39, 6, 35), Q(-2, 19, 7, 2), Z()], 61, 24),
    ],
  },
  {
    id: 'candy', name: '糖纸小甜心', category: '甜点', width: 160, height: 90,
    style: stickerStyle('purple-candy', { texture: 'stripes', textureOpacity: 0.35, outerWidth: 4 }),
    glyphs: [
      glyph('candy-wrapper-left', 52, 74, [M(48, 25), L(10, 4), Q(4, 3, 7, 12), L(12, 30), L(3, 39), L(13, 46), L(8, 66), Q(6, 73, 13, 70), L(49, 48), Z()], 0, 8),
      glyph('candy-wrapper-right', 52, 74, [M(4, 25), L(42, 4), Q(48, 3, 45, 12), L(40, 30), L(49, 39), L(39, 46), L(44, 66), Q(46, 73, 39, 70), L(3, 48), Z()], 108, 8),
      glyph('candy-sweet', 88, 78, [M(25, 4), Q(44, -2, 63, 4), C(83, 8, 88, 26, 83, 48), C(79, 68, 65, 77, 44, 75), C(20, 78, 7, 67, 4, 47), C(0, 25, 4, 10, 25, 4), Z()], 36, 6),
    ],
  },
  {
    id: 'ghost', name: '害羞小幽灵', category: '万圣', width: 120, height: 138,
    style: stickerStyle('purple-candy', { fill: '#ffffff', fill2: '#e3d8fb', stroke: '#796494', strokeWidth: 1.5, outerWidth: 3, depth: 2, depthColor: '#ab92cb', texture: 'none', gloss: false }),
    glyphs: [glyph('ghost-body', 120, 138, [M(17, 62), C(15, 27, 31, 7, 60, 7), C(89, 7, 105, 28, 103, 62), C(101, 85, 106, 108, 116, 124), Q(104, 134, 91, 120), Q(78, 141, 62, 123), Q(45, 139, 31, 121), Q(15, 138, 4, 125), C(15, 104, 19, 84, 17, 62), Z(), ...circle(42, 62, 8.5), ...circle(79, 62, 8.5), M(52, 85), Q(60, 96, 68, 85), Q(63, 106, 57, 101), Q(53, 96, 52, 85), Z()])],
  },
  {
    id: 'bat', name: '月夜小蝙蝠', category: '万圣', width: 178, height: 102,
    style: stickerStyle('purple-candy', { fill: '#8467ac', fill2: '#36234e', stroke: '#2b193c', outerStroke: '#f9e9ff', texture: 'none', gloss: false, depth: 4 }),
    glyphs: [glyph('bat-silhouette', 178, 102, [M(88, 36), L(74, 18), L(72, 47), C(53, 41, 28, 30, 5, 10), C(4, 38, 10, 65, 20, 84), Q(29, 65, 43, 83), Q(53, 63, 67, 83), Q(75, 94, 89, 96), Q(103, 94, 111, 83), Q(125, 63, 135, 83), Q(149, 65, 158, 84), C(168, 65, 174, 38, 173, 10), C(150, 30, 125, 41, 106, 47), L(104, 18), L(90, 36), Z(), ...circle(81, 58, 5.5), ...circle(98, 58, 5.5)])],
  },
  {
    id: 'moon', name: '晚安月亮', category: '闪亮', width: 132, height: 136,
    style: stickerStyle('orange-soda', { fill: '#fff4bf', fill2: '#f1bf54', stroke: '#b89145', texture: 'none', depth: 3 }),
    glyphs: [glyph('moon-crescent', 112, 132, [M(91, 7), C(54, 8, 40, 36, 47, 64), C(54, 92, 79, 103, 106, 93), C(91, 126, 55, 137, 27, 115), C(-2, 94, -5, 54, 16, 28), C(34, 6, 63, -1, 91, 7), Z()]), sparkle('moon-spark', 27, 103, 18), sparkle('moon-small', 16, 83, 56)],
  },
  {
    id: 'flower', name: '五瓣樱花', category: '花园', width: 132, height: 132,
    style: stickerStyle('sakura', { strokeWidth: 1.5, outerWidth: 3, depth: 2, texture: 'dots', textureOpacity: 0.4 }),
    glyphs: [glyph('flower-petals', 132, 132, [M(66, 42), C(44, 15, 47, 1, 58, 4), L(66, 12), L(75, 4), C(91, 3, 89, 26, 79, 46), C(107, 30, 126, 32, 125, 46), L(114, 53), L(126, 62), C(128, 78, 101, 80, 82, 73), C(103, 96, 103, 122, 89, 122), L(79, 112), L(72, 126), C(54, 132, 51, 103, 56, 82), C(38, 109, 16, 118, 11, 103), L(17, 90), L(3, 86), C(-2, 71, 23, 61, 46, 60), C(15, 51, 7, 29, 22, 24), L(34, 31), L(39, 17), C(52, 9, 64, 28, 66, 42), Z(), ...circle(66, 65, 10)])],
  },
  {
    id: 'bubble', name: '气泡悄悄话', category: '标签', width: 148, height: 120,
    style: stickerStyle('ice-blue', { fill: '#edffff', fill2: '#9adeec', stroke: '#569fb3', outerWidth: 4, texture: 'none', gloss: true }),
    glyphs: [glyph('bubble-body', 142, 120, [M(69, 5), C(110, 5, 137, 24, 137, 52), C(137, 79, 113, 96, 78, 98), Q(55, 111, 30, 116), L(38, 94), C(14, 87, 4, 72, 4, 52), C(4, 24, 28, 5, 69, 5), Z(), ...circle(43, 51, 7), ...circle(71, 51, 7), ...circle(99, 51, 7)]), sparkle('bubble-tiny', 20, 127, 0)],
  },
  {
    id: 'crown', name: '今日小皇冠', category: '闪亮', width: 148, height: 112,
    style: stickerStyle('black-gold', { stroke: '#ac7930', outerStroke: '#fff9e9', texture: 'dots', depth: 4, shadowColor: '#a48252' }),
    glyphs: [glyph('crown-body', 148, 96, [M(15, 16), L(48, 39), L(74, 5), L(100, 39), L(133, 16), L(120, 82), Q(74, 96, 28, 82), Z(), M(74, 43), L(84, 58), L(74, 73), L(64, 58), Z()], 0, 10), glyph('crown-beads', 148, 26, [...circle(13, 13, 8), ...circle(74, 9, 8), ...circle(135, 13, 8)]), glyph('crown-band', 104, 14, [M(4, 1), Q(52, 10, 100, 1), L(99, 11), Q(52, 20, 5, 11), Z()], 22, 90)],
  },
  {
    id: 'ribbon', name: '庆祝小丝带', category: '标签', width: 184, height: 96,
    style: stickerStyle('mint', { texture: 'stripes', outerWidth: 3.5, depth: 3, gloss: false }),
    glyphs: [
      glyph('ribbon-tail-left', 55, 65, [M(5, 8), L(52, 1), L(52, 52), L(5, 63), L(17, 35), Z()], 0, 27),
      glyph('ribbon-tail-right', 55, 65, [M(3, 1), L(50, 8), L(38, 35), L(50, 63), L(3, 52), Z()], 129, 27),
      glyph('ribbon-front', 132, 71, [M(3, 8), Q(66, -4, 129, 8), L(129, 61), Q(66, 49, 3, 61), Z()], 26, 6),
    ],
  },
];

export const STICKERS: StickerPreset[] = [
  ...CLASSIC_STICKERS.map(s => {
    const art = classicArt(s.id);
    if (!art) throw new Error(`Missing classic artwork: ${s.id}`);
    return { ...s, ...paintedStickerGeometry(s.id, 0, art.parts), style: style(art.style ?? {}), tags: ['经典', s.name, s.category, '独立分色'] };
  }),
  ...EXTRA_STICKERS,
];

export function createSticker(id: string, x: number, y: number): Layer {
  const sticker = STICKERS.find(item => item.id === id);
  if (!sticker) throw new RangeError(`Unknown sticker: ${id}`);
  return {
    ...BASE_LAYER,
    id: newId(),
    name: sticker.name,
    kind: 'sticker',
    text: '',
    fontId: '',
    x,
    y,
    width: sticker.width,
    height: sticker.height,
    glyphs: sticker.glyphs.map(item => ({ ...item, id: newId(), ...(item.paint ? { paint: { ...item.paint } } : {}), commands: item.commands.map(command => ({ ...command })) })),
    style: style(sticker.style),
  };
}

export function applyPreset(layer: Layer, presetId: string): Layer {
  const preset = STYLE_PRESETS.find(item => item.id === presetId);
  if (!preset) throw new RangeError(`Unknown style preset: ${presetId}`);
  return { ...layer, style: style(preset.style) };
}
