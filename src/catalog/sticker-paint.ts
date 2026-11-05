import type { Command, GlyphPaint, PaintColor, TextStyle } from '../types';
import { stickerGeometry } from './sticker-geometry';

type Part = { label: string; commands: Command[]; paint: GlyphPaint };
type Palette = { main: `#${string}`; second: `#${string}`; ink: `#${string}`; accent: `#${string}`; depth: `#${string}` };
export type PaintedArt = { parts: Part[]; style: Partial<TextStyle> };
const cream: Palette = { main: '#f7b3d0', second: '#ffe6ae', ink: '#925379', accent: '#b7dfda', depth: '#c17b9e' };
const blue: Palette = { main: '#a9dcf2', second: '#ffc3d7', ink: '#638bac', accent: '#ffe59f', depth: '#7caccb' };
const lilac: Palette = { main: '#c9b6ed', second: '#ffe0a3', ink: '#795895', accent: '#aee2d4', depth: '#9b81bc' };
const green: Palette = { main: '#acd9bb', second: '#ffd1bb', ink: '#5b9175', accent: '#ffe5a1', depth: '#7bab95' };
const pastry: Palette = { main: '#ffe0a8', second: '#f6a9c4', ink: '#ae7763', accent: '#b2dbce', depth: '#c69679' };
const faces: Palette = { main: '#fff2dc', second: '#f7b4cf', ink: '#91627e', accent: '#c2c8ec', depth: '#c4a0b1' };
const groups = {
  blue: ['planet','comet','constellation','robot-face','headphones','game-console','dice','game-badge','paint-tool','pointer-arrow','curved-arrow','divider','corner-flourish','motion-lines','rainbow','umbrella','snow-crystal','rocket','travel-case','camera','map-pin','mountain','alarm-clock'],
  green: ['tulip','leaf-sprig','clover','wreath','season-leaf','plant-pot'],
  pastry: ['cookie','donut','pudding','sunshine','lantern','royal-crown','jewel-ring','pearl-jewel','desk-lamp'],
  lilac: ['moon-phase','heart-lock','lace-medallion','award-rosette','hair-ornament','spooky-bat','magic-potion','music-note','microphone','record','equalizer','chess-token','cut-gem','crystal-cluster','spell-book','paper-clip'],
  faces: ['cat-face','bear-face','fox-face','smile-token','cloud-face','blob-face','tiny-mascot','speech-bubble','love-letter','notebook','sticky-note','ticket-label','label-banner','tiny-house'],
};
const faceFamilies = ['cat-face','bear-face','fox-face','smile-token','cloud-face','blob-face','tiny-mascot','spooky-bat','pumpkin'];
function palette(family: string): Palette {
  if (groups.blue.includes(family)) return blue;
  if (groups.green.includes(family)) return green;
  if (groups.pastry.includes(family)) return pastry;
  if (groups.lilac.includes(family)) return lilac;
  if (groups.faces.includes(family)) return faces;
  return cream;
}
function contours(commands: Command[]): Command[][] {
  const result: Command[][] = [];
  for (const command of commands) {
    if (command.type === 'M' || !result.length) result.push([]);
    result[result.length - 1].push({ ...command });
  }
  return result.filter(shape => shape.some(command => command.type !== 'M' && command.type !== 'Z'));
}
function range(commands: Command[]) {
  const points = commands.flatMap(command => command.x === undefined ? [] : [{ x: command.x, y: command.y! }]);
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}
function ellipse(x: number, y: number, rx: number, ry: number): Command[] {
  const k = 0.5522847498;
  return [{type:'M',x:x+rx,y},{type:'C',x1:x+rx,y1:y+ry*k,x2:x+rx*k,y2:y+ry,x,y:y+ry},{type:'C',x1:x-rx*k,y1:y+ry,x2:x-rx,y2:y+ry*k,x:x-rx,y},{type:'C',x1:x-rx,y1:y-ry*k,x2:x-rx*k,y2:y-ry,x,y:y-ry},{type:'C',x1:x+rx*k,y1:y-ry,x2:x+rx,y2:y-ry*k,x:x+rx,y},{type:'Z'}];
}
function preserveHole(family: string, variant: number, index: number): boolean {
  if (['lace-medallion','pearl-jewel','paper-clip','scissors'].includes(family)) return true;
  if (family === 'heart-lock') return index === 0 || index === 2 && variant === 3;
  if (family === 'moon-phase') return variant === 3 && index === 1;
  if (family === 'constellation') return true;
  if (family === 'wing-heart') return variant === 1 && index === 3;
  if (family === 'spooky-bat') return variant === 1 && index === 3;
  if (family === 'clover') return variant > 1 && index === 4 + variant % 2;
  if (family === 'award-rosette') return index === (variant === 2 ? 1 : 3);
  if (family === 'donut') return index === 0;
  if (family === 'tea-cup' || family === 'jewel-ring' || family === 'travel-case') return index === 0;
  if (family === 'paw-print') return variant === 3 && index === 5;
  if (family === 'pointer-arrow') return variant === 1;
  if (family === 'cut-gem') return variant === 1 || variant === 3;
  if (family === 'equalizer') return variant === 2;
  if (family === 'sunshine') return variant === 2 && index === 0;
  if (family === 'map-pin') return index === 0;
  if (family === 'sewing-kit') return variant === 2 && index === 0;
  return false;
}
function faceColor(family: string, index: number, largest: number, p: Palette): PaintColor {
  if (family === 'rainbow') return (['primary','secondary',p.accent,'#b6e1cc'] as PaintColor[])[index % 4];
  if (family === 'plant-pot') return index < 2 ? 'secondary' : 'primary';
  if (family === 'love-letter') return index === 0 ? 'primary' : index < 3 ? 'secondary' : p.accent;
  if (family === 'wing-heart') return index < 2 ? 'paper' : 'primary';
  if (family === 'heart-balloon') return index % 2 ? 'ink' : index % 4 ? 'secondary' : 'primary';
  if (family === 'music-note') return index < 2 ? 'primary' : 'secondary';
  if (family === 'rocket') return index === 2 ? 'paper' : index === 3 ? 'secondary' : 'primary';
  if (family === 'mountain') return index === 0 ? 'primary' : 'secondary';
  if (family === 'leaf-sprig' || family === 'season-leaf') return index === 0 || index % 3 ? 'primary' : p.accent;
  if (family === 'spooky-bat') return index < 2 ? 'primary' : 'secondary';
  if (family === 'tiny-house') return index === 0 ? 'primary' : 'secondary';
  if (family === 'record') return index === 0 ? '#9281b3' : 'secondary';
  if (family === 'game-console' || family === 'robot-face') return index === 0 ? 'primary' : 'secondary';
  return index === largest ? 'primary' : index % 3 === 1 ? 'secondary' : index % 3 === 2 ? p.accent : 'primary';
}
function detailColor(family: string, outerIndex: number, detailIndex: number, size: number, p: Palette): PaintColor {
  if (faceFamilies.includes(family)) {
    if (family === 'fox-face' && detailIndex < 3) return 'paper';
    if (family === 'bear-face' && outerIndex < 2) return 'secondary';
    if (family === 'bear-face' && detailIndex >= 4) return detailIndex % 2 ? 'primary' : 'secondary';
    return 'ink';
  }
  if (family === 'cookie') return '#bc8869';
  if (family === 'donut') return detailIndex % 3 === 0 ? p.accent : detailIndex % 3 === 1 ? 'secondary' : 'paper';
  if (family === 'pudding') return detailIndex < 3 ? 'secondary' : 'ink';
  if (family === 'robot-face' || family === 'dice' || family === 'game-console') return detailIndex === 1 && family !== 'dice' ? 'secondary' : 'ink';
  if (family === 'bottle' || family === 'magic-potion') return size > 250 ? 'secondary' : 'paper';
  if (family === 'mountain') return 'paper';
  if (family === 'tulip' || family === 'leaf-sprig' || family === 'season-leaf' || family === 'wreath') return 'ink';
  if (family === 'gift-box' || family === 'party-hat' || family === 'bunting') return detailIndex % 2 ? 'secondary' : 'paper';
  if (family === 'record') return detailIndex < 5 ? '#d3c8eb' : 'secondary';
  if (family === 'alarm-clock') return 'paper';
  if (family === 'travel-case') return size < 300 ? 'ink' : 'secondary';
  if (family === 'tiny-house') return detailIndex === 3 ? 'secondary' : '#acddeb';
  if (family === 'spell-book' || family === 'notebook' || family === 'sticky-note') return size < 300 ? 'ink' : 'secondary';
  if (family === 'paint-tool') return (['secondary',p.accent,'#aacde9','#c9b6e8','primary'] as PaintColor[])[detailIndex % 5];
  return size < 180 ? 'ink' : size > 1000 ? 'paper' : 'secondary';
}

/** Recompose legacy construction contours as positive surfaces, keeping actual ring holes. */
export function coloredStickerArt(family: string, variant: number): PaintedArt {
  const original = stickerGeometry(family, variant), p = palette(family);
  const areas = original.glyphs.map(glyph => glyph.width * glyph.height);
  const largest = areas.indexOf(Math.max(...areas));
  const parts: Part[] = [];
  original.glyphs.forEach((glyph, index) => {
    const commands = glyph.commands.map(command => {
      const next = { ...command };
      for (const [x,y] of [['x','y'],['x1','y1'],['x2','y2']] as const) if (command[x] !== undefined && command[y] !== undefined) { next[x] = command[x]! + glyph.x; next[y] = command[y]! + glyph.y; }
      return next;
    });
    const paths = contours(commands), holes = preserveHole(family, variant, index) ? 2 : 1;
    const first = range(paths[0]), fill = faceColor(family, index, largest, p);
    const fine = Math.min(glyph.width, glyph.height) < 7;
    parts.push({ label: `主体${index + 1}`, commands: paths.slice(0, holes).flat(), paint: { fill, stroke: 'ink', strokeWidth: fine ? 1.2 : 2.8 } });
    const interiors: Part[] = [];
    for (let i = holes; i < paths.length; i++) {
      const b = range(paths[i]), size = b.width * b.height;
      const inset = b.x >= first.x - 0.1 && b.y >= first.y - 0.1 && b.x + b.width <= first.x + first.width + 0.1 && b.y + b.height <= first.y + first.height + 0.1;
      const fill = inset ? detailColor(family,index,i,size,p) : i % 2 ? 'secondary' : p.accent;
      interiors.push({ label: inset ? `内色面${index + 1}-${i}` : `附形${index + 1}-${i}`, commands: paths[i], paint: { fill, stroke: 'ink', strokeWidth: inset ? size > 450 ? 1.35 : 0 : 2.3, silhouette: !inset } });
    }
    // Large liners sit below facial marks and small ornaments.
    if (faceFamilies.includes(family)) interiors.sort((a,b) => { const aa=range(a.commands),bb=range(b.commands);return bb.width*bb.height-aa.width*aa.height; });
    parts.push(...interiors);
  });
  const main = original.glyphs[largest];
  if (['cat-face','bear-face','blob-face','tiny-mascot','smile-token','cloud-face'].includes(family)) {
    const cx = main.x + main.width * 0.5, cy = main.y + main.height * 0.63;
    for (const side of [-1,1]) parts.push({ label: side < 0 ? '左颊' : '右颊', commands: ellipse(cx + side * main.width * 0.27,cy,main.width*0.065,main.height*0.047), paint:{fill:'secondary',strokeWidth:0,silhouette:false,opacity:0.8} });
  }
  return { parts, style: { fill:p.main,fill2:p.second,stroke:p.ink,strokeWidth:2.8,gradient:false,outerStroke:'#fffaf2',outerWidth:5.3,depth:2.8,depthColor:p.depth,shadowColor:p.ink,shadowX:0,shadowY:0,shadowBlur:0,texture:'none',textureOpacity:0,gloss:false,material:'none',opacity:1 } };
}
