import type { Command, Project } from './types';
import { validateGradientStyle } from './engine';
export function parseProject(raw: string): Project {
  const p: unknown = JSON.parse(raw);
  if (!p || typeof p !== 'object') throw new Error('这不是字造工程文件');
  const v = p as Project;
  if (v.version !== 1 || !Array.isArray(v.layers) || v.layers.length > 150 || typeof v.name !== 'string' || !Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 64 || v.height < 64 || v.width > 8192 || v.height > 8192) throw new Error('工程格式或画布尺寸不正确');
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000000;
  for (const l of v.layers) {
    if (!l || !['text', 'path', 'sticker', 'image'].includes(l.kind) || typeof l.id !== 'string' || typeof l.name !== 'string' || !Array.isArray(l.glyphs) || l.glyphs.length > 10000 || ![l.x, l.y, l.rotation, l.width, l.height, l.scaleX, l.scaleY, l.fontSize, l.letterSpacing, l.lineHeight].every(finite) || l.scaleX <= 0 || l.scaleY <= 0 || !l.style || typeof l.text !== 'string') throw new Error('图层数据不完整');
    if (!['horizontal','vertical'].includes(l.layout) || !['left','center','right'].includes(l.align)) throw new Error('文字排版数据不正确');
    if (l.imageSrc && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(l.imageSrc)) throw new Error('图片图层需要内嵌的位图文件');
    for (const key of ['fill','fill2','stroke','outerStroke','shadowColor','depthColor','textureColor'] as const) if (!/^#[a-f0-9]{6}$/i.test(l.style[key])) throw new Error('图层颜色不正确');
    for (const key of ['gradientAngle','strokeWidth','outerWidth','shadowX','shadowY','shadowBlur','depth','textureOpacity','opacity'] as const) if (!finite(l.style[key])) throw new Error('样式数值不正确');
    if (l.style.gradientType !== undefined && !['linear','radial'].includes(l.style.gradientType)) throw new Error('渐变类型不正确');
    if (l.style.gradientStops !== undefined && (!Array.isArray(l.style.gradientStops) || l.style.gradientStops.length < 2 || l.style.gradientStops.length > 6 || l.style.gradientStops.some(s => !s || !finite(s.offset) || s.offset < 0 || s.offset > 1 || !/^#[a-f0-9]{6}$/i.test(s.color)))) throw new Error('渐变色标不正确');
    validateGradientStyle(l.style);
    if (l.style.material !== undefined && !['none','metal','glass','jelly','paper','neon'].includes(l.style.material)) throw new Error('材质类型不正确');
    if (l.style.materialStrength !== undefined && (!finite(l.style.materialStrength) || l.style.materialStrength < 0 || l.style.materialStrength > 1)) throw new Error('材质强度不正确');
    const original = l.letterform;
    if (original && (typeof original.presetId !== 'string' || !finite(original.amount) || original.amount < 0 || original.amount > 1 || !['text','path'].includes(original.sourceKind) || !finite(original.sourceWidth) || !finite(original.sourceHeight) || !Array.isArray(original.sourceGlyphs) || original.sourceGlyphs.length > 10000)) throw new Error('原始字形备份不正确');
    for (const g of [...l.glyphs, ...(original?.sourceGlyphs || [])]) {
      if (!Array.isArray(g.commands) || g.commands.length > 20000 || ![g.x,g.y,g.width,g.height,g.rotation ?? 0].every(finite)) throw new Error('字形坐标不正确');
      if (![g.scaleX ?? 1, g.scaleY ?? 1].every(finite) || (g.scaleX ?? 1) <= 0 || (g.scaleY ?? 1) <= 0 || (g.scaleX ?? 1) > 20 || (g.scaleY ?? 1) > 20) throw new Error('字形缩放不正确');
      if (g.fillRule !== undefined && g.fillRule !== 'evenodd' && g.fillRule !== 'nonzero') throw new Error('字形填充规则不正确');
      if (g.paint !== undefined) {
        const paint = g.paint;
        const color = (value: unknown) => typeof value === 'string' && (/^#[a-f0-9]{6}$/i.test(value) || ['primary','secondary','ink','paper','none'].includes(value));
        if (!paint || typeof paint !== 'object' || Array.isArray(paint) || !color(paint.fill) || (paint.stroke !== undefined && !color(paint.stroke)) || (paint.strokeWidth !== undefined && (!finite(paint.strokeWidth) || paint.strokeWidth < 0 || paint.strokeWidth > 1000)) || (paint.opacity !== undefined && (!finite(paint.opacity) || paint.opacity < 0 || paint.opacity > 1)) || (paint.silhouette !== undefined && typeof paint.silhouette !== 'boolean')) throw new Error('部件分色数据不正确');
      }
      for (const c of g.commands) {
        if (!['M','L','Q','C','Z'].includes(c.type)) throw new Error('路径类型不正确');
        if (c.type !== 'Z' && ![c.x,c.y].every(finite)) throw new Error('路径节点不正确');
        if (['Q','C'].includes(c.type) && ![c.x1,c.y1].every(finite)) throw new Error('曲线控制柄不正确');
        if (c.type === 'C' && ![c.x2,c.y2].every(finite)) throw new Error('曲线控制柄不正确');
      }
    }
  }
  if (new Set(v.layers.map(l => l.id)).size !== v.layers.length) throw new Error('图层ID有重复');
  if (v.background && (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v.background.src) || !finite(v.background.opacity))) throw new Error('参考图格式不正确');
  return v;
}
export function splitCommand(commands: Command[], index: number): Command[] {
  const result = structuredClone(commands), c = result[index], prev = result[index - 1];
  if (!c || !prev || c.type === 'M' || c.type === 'Z' || prev.x === undefined || prev.y === undefined) return result;
  const a = { x: prev.x, y: prev.y }, b = { x: c.x!, y: c.y! };
  const mid = (p: {x:number;y:number}, q:{x:number;y:number}) => ({ x:(p.x+q.x)/2, y:(p.y+q.y)/2 });
  if (c.type === 'L') result.splice(index, 0, { type:'L', ...mid(a,b) });
  if (c.type === 'Q') { const ctrl={x:c.x1!,y:c.y1!}, ac=mid(a,ctrl), cb=mid(ctrl,b), m=mid(ac,cb); result.splice(index,1,{type:'Q',x1:ac.x,y1:ac.y,...m},{type:'Q',x1:cb.x,y1:cb.y,...b}); }
  if (c.type === 'C') { const c1={x:c.x1!,y:c.y1!},c2={x:c.x2!,y:c.y2!}, p=mid(a,c1),q=mid(c1,c2),r=mid(c2,b),s=mid(p,q),t=mid(q,r),m=mid(s,t); result.splice(index,1,{type:'C',x1:p.x,y1:p.y,x2:s.x,y2:s.y,...m},{type:'C',x1:t.x,y1:t.y,x2:r.x,y2:r.y,...b}); }
  return result;
}
export function readFile(file: File): Promise<string> { return new Promise((resolve,reject) => { const r = new FileReader(); r.onload=()=>resolve(String(r.result)); r.onerror=()=>reject(new Error('文件读取失败')); r.readAsDataURL(file); }); }
export const safeName = (s:string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().slice(0,100) || '我的标题';
