export type Command = { type: 'M' | 'L' | 'Q' | 'C' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
export type PaintColor = `#${string}` | 'primary' | 'secondary' | 'ink' | 'paper' | 'none';
export type GlyphPaint = { fill: PaintColor; stroke?: PaintColor; strokeWidth?: number; opacity?: number; silhouette?: boolean };
export type Glyph = { id: string; char: string; x: number; y: number; width: number; height: number; rotation?: number; scaleX?: number; scaleY?: number; commands: Command[]; paint?: GlyphPaint; fillRule?: 'evenodd' | 'nonzero' };
export type FontRecord = { id: string; family: string; subfamily: string; fullName: string; postscriptName?: string; source: string; hasChinese?: boolean; bundled?: boolean; languages?: ('zh-Hans' | 'zh-Hant' | 'en')[]; license?: string };
export type FontCatalog = { fonts: FontRecord[]; defaultFontId: string; directories: string[]; errors: string[] };
export type OutlineRequest = { fontId: string; text: string; fontSize: number; letterSpacing: number; lineHeight: number; align: 'left' | 'center' | 'right'; layout: 'horizontal' | 'vertical' };
export type OutlineResult = { glyphs: Glyph[]; width: number; height: number; missing: string[]; fontId: string };
export type Material = 'none' | 'metal' | 'glass' | 'jelly' | 'paper' | 'neon';
export type GradientPoint = { x: number; y: number };
export type GradientGeometry =
  | { type: 'linear'; start: GradientPoint; end: GradientPoint }
  | { type: 'radial'; center: GradientPoint; radiusX: number; radiusY: number; rotation?: number };
export type GradientStop = { offset: number; color: string; midpoint?: number };
export type TextStyle = { gradientGeometry?: GradientGeometry; gradientStops?: GradientStop[]; gradientType?: 'linear' | 'radial'; material?: Material; materialStrength?: number; fill: string; fill2: string; gradient: boolean; gradientAngle: number; stroke: string; strokeWidth: number; outerStroke: string; outerWidth: number; shadowColor: string; shadowX: number; shadowY: number; shadowBlur: number; depth: number; depthColor: string; texture: 'none' | 'dots' | 'stripes'; textureColor: string; textureOpacity: number; gloss: boolean; opacity: number };
export type LetterformState = { presetId: string; amount: number; sourceGlyphs: Glyph[]; sourceWidth: number; sourceHeight: number; sourceKind: 'text' | 'path' };
export type Layer = OutlineRequest & { id: string; name: string; kind: 'text' | 'path' | 'sticker' | 'image'; x: number; y: number; rotation: number; scaleX: number; scaleY: number; visible: boolean; locked: boolean; width: number; height: number; glyphs: Glyph[]; style: TextStyle; imageSrc?: string; letterform?: LetterformState };
export type Project = { version: 1; name: string; width: number; height: number; layers: Layer[]; background?: { src: string; opacity: number } };
export type Bounds = { x: number; y: number; width: number; height: number };
export type ExportOptions = { scale: number; crop: boolean; padding: number; psdMode?: 'layers' | 'elements' };
export const DEFAULT_STYLE: TextStyle = { fill: '#ffb8cf', fill2: '#f45d91', gradient: true, gradientAngle: 90, stroke: '#863e58', strokeWidth: 3, outerStroke: '#fffaf2', outerWidth: 12, shadowColor: '#493335', shadowX: 6, shadowY: 9, shadowBlur: 4, depth: 7, depthColor: '#a44567', texture: 'dots', textureColor: '#ffffff', textureOpacity: 0.28, gloss: true, opacity: 1 };
export const BASE_LAYER: Omit<Layer, 'id' | 'name' | 'kind' | 'text' | 'fontId' | 'glyphs'> = { x: 960, y: 540, rotation: 0, scaleX: 1, scaleY: 1, visible: true, locked: false, width: 600, height: 200, fontSize: 180, letterSpacing: 4, lineHeight: 1.2, align: 'center', layout: 'horizontal', style: DEFAULT_STYLE };
