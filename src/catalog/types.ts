import type { Glyph, TextStyle } from '../types';

export type StylePreset = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  style: TextStyle;
};

export type StickerPreset = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  glyphs: Glyph[];
  width: number;
  height: number;
  style: TextStyle;
};
