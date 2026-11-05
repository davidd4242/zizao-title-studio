import { useRef } from 'react';
import type { PointerEvent as RPointerEvent, KeyboardEvent as RKeyboardEvent } from 'react';
import type { Command, Glyph, Layer, Project } from './types';
import { commandPath, gradientGeometryToPixels, layerGeometryBounds, layerSvg, layerTransform, resolveGradientGeometry, screenToLayer } from './engine';
import { gradientHandlePoint, moveGradientHandle } from './gradient';
import type { GradientHandle } from './gradient';
import { glyphCorners, resizeGlyph, rotateGlyph } from './glyph-transform';
import type { GlyphCorner } from './glyph-transform';
export type EditMode = 'select' | 'glyph' | 'node' | 'gradient';
export type NodeSelection = { glyph: number; command: number } | null;
type Point = { x: number; y: number };
type Drag = { kind: 'move' | 'rotate' | 'scale' | 'glyph' | 'glyph-scale' | 'glyph-rotate' | 'node' | 'gradient'; before: Project; layerId: string; start: Point; glyph?: number; corner?: GlyphCorner; command?: number; handle?: 'anchor' | 'c1' | 'c2'; gradientHandle?: GradientHandle };
function glyphFramePath(glyph: Glyph) {
  const corners = glyphCorners(glyph);
  return `M${corners.map(point => `${point.x} ${point.y}`).join('L')}Z`;
}
function glyphPoint(g: Glyph, p: Point) { const a = -(g.rotation || 0) * Math.PI / 180, x = p.x - g.x - g.width / 2, y = p.y - g.y - g.height / 2; return { x: x * Math.cos(a) - y * Math.sin(a) + g.width / 2, y: x * Math.sin(a) + y * Math.cos(a) + g.height / 2 }; }
function commandEnd(c: Command) { return typeof c.x === 'number' && typeof c.y === 'number' ? { x: c.x, y: c.y } : null; }
export default function Canvas({ project, selectedId, setSelectedId, mode, glyphIndex, setGlyphIndex, glyphEditing, setGlyphEditing, node, setNode, zoom, onDraft, onCommit, checker, referenceVisible }: { project: Project; selectedId: string | null; setSelectedId: (id: string | null) => void; mode: EditMode; glyphIndex: number; setGlyphIndex: (i: number) => void; glyphEditing: boolean; setGlyphEditing: (value: boolean) => void; node: NodeSelection; setNode: (n: NodeSelection) => void; zoom: number; onDraft: (p: Project) => void; onCommit: (before: Project) => void; checker: boolean; referenceVisible: boolean }) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null), tap = useRef<{ glyph: number; time: number; x: number; y: number } | null>(null), current = useRef(project); current.current = project;
  const selected = project.layers.find(l => l.id === selectedId);
  const point = (e: RPointerEvent): Point => { const r = svg.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * project.width / r.width, y: (e.clientY - r.top) * project.height / r.height }; };
  const begin = (e: RPointerEvent, kind: Drag['kind'], layer: Layer, extra: Partial<Drag> = {}) => {
    if (e.button !== 0 || layer.locked) return; e.stopPropagation(); e.preventDefault(); if (selectedId !== layer.id) setSelectedId(layer.id); if (extra.glyph !== undefined) setGlyphIndex(extra.glyph);
    drag.current = { kind, before: structuredClone(current.current), layerId: layer.id, start: point(e), ...extra }; svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return; const p = point(e), next = structuredClone(d.before), l = next.layers.find(v => v.id === d.layerId)!;
    if (d.kind === 'move') { l.x += p.x - d.start.x; l.y += p.y - d.start.y; if (e.shiftKey) { l.x = Math.round(l.x / 10) * 10; l.y = Math.round(l.y / 10) * 10; } }
    if (d.kind === 'rotate') { const a0 = Math.atan2(d.start.y - l.y, d.start.x - l.x), a1 = Math.atan2(p.y - l.y, p.x - l.x); l.rotation += (a1 - a0) * 180 / Math.PI; if (e.shiftKey) l.rotation = Math.round(l.rotation / 15) * 15; }
    if (d.kind === 'scale') { const dist = Math.hypot(p.x - l.x, p.y - l.y) / Math.max(1, Math.hypot(d.start.x - l.x, d.start.y - l.y)); l.scaleX = Math.max(0.05, l.scaleX * dist); l.scaleY = Math.max(0.05, l.scaleY * dist); }
    if (d.kind === 'glyph' || d.kind === 'node') {
      const a = screenToLayer(l, d.start.x, d.start.y), b = screenToLayer(l, p.x, p.y), g = l.glyphs[d.glyph!];
      if (d.kind === 'glyph') { g.x += b.x - a.x; g.y += b.y - a.y; }
      else { const ga = glyphPoint(g, a), gb = glyphPoint(g, b), dx = gb.x - ga.x, dy = gb.y - ga.y, c = g.commands[d.command!];
        if (d.handle === 'c1') { c.x1! += dx; c.y1! += dy; }
        else if (d.handle === 'c2') { c.x2! += dx; c.y2! += dy; }
        else { c.x! += dx; c.y! += dy; if (typeof c.x2 === 'number') { c.x2 += dx; c.y2! += dy; } const nextC = g.commands[d.command! + 1]; if (nextC && typeof nextC.x1 === 'number') { nextC.x1 += dx; nextC.y1! += dy; } }
      }
    }
    if (d.kind === 'glyph-scale' || d.kind === 'glyph-rotate') {
      const base = d.before.layers.find(v => v.id === d.layerId)!.glyphs[d.glyph!];
      const g = l.glyphs[d.glyph!];
      if (d.kind === 'glyph-scale') {
        const next = resizeGlyph(base, d.corner!, screenToLayer(l, p.x, p.y), e.shiftKey);
        g.scaleX = next.scaleX; g.scaleY = next.scaleY; g.x = next.x; g.y = next.y;
      } else {
        g.rotation = rotateGlyph(base, screenToLayer(l, d.start.x, d.start.y), screenToLayer(l, p.x, p.y), e.shiftKey);
      }
    }
    if (d.kind === 'gradient') {
      const frame = layerGeometryBounds(l), geometry = gradientGeometryToPixels(resolveGradientGeometry(l.style, frame), frame);
      const anchor = gradientHandlePoint(geometry, d.gradientHandle!);
      const from = screenToLayer(l, d.start.x, d.start.y), to = screenToLayer(l, p.x, p.y);
      l.style = { ...l.style, ...moveGradientHandle(l.style, frame, d.gradientHandle!, { x: anchor.x + to.x - from.x, y: anchor.y + to.y - from.y }, e.shiftKey) };
    }
    onDraft(next);
  };
  const end = () => { const d = drag.current; drag.current = null; if (d) onCommit(d.before); };
  const keyGradient = (event: RKeyboardEvent<SVGCircleElement>, handle: GradientHandle) => {
    if (!selected || selected.locked || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const before = structuredClone(current.current), next = structuredClone(before), layer = next.layers.find(l => l.id === selected.id)!;
    const frame = layerGeometryBounds(layer), p = gradientHandlePoint(gradientGeometryToPixels(resolveGradientGeometry(layer.style, frame), frame), handle), step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === 'ArrowLeft') p.x -= frame.width * step;
    if (event.key === 'ArrowRight') p.x += frame.width * step;
    if (event.key === 'ArrowUp') p.y -= frame.height * step;
    if (event.key === 'ArrowDown') p.y += frame.height * step;
    layer.style = { ...layer.style, ...moveGradientHandle(layer.style, frame, handle, p) };
    onDraft(next); onCommit(before);
  };
  const keyGlyphRotate = (event: RKeyboardEvent<SVGCircleElement>, index: number) => {
    if (!selected || selected.locked || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const before = structuredClone(current.current), next = structuredClone(before), glyph = next.layers.find(l => l.id === selected.id)!.glyphs[index];
    const step = event.shiftKey ? 15 : 1;
    glyph.rotation = Math.round((((glyph.rotation || 0) + (event.key === 'ArrowRight' ? step : -step)) % 360) * 1000) / 1000;
    if (glyph.rotation > 180) glyph.rotation -= 360;
    if (glyph.rotation <= -180) glyph.rotation += 360;
    onDraft(next); onCommit(before);
  };
  const gradientFrame = selected ? layerGeometryBounds(selected) : null;
  const gradientGeometry = selected && gradientFrame && mode === 'gradient' && selected.style.gradient ? gradientGeometryToPixels(resolveGradientGeometry(selected.style, gradientFrame), gradientFrame) : null;
  const unit = 1 / Math.max(0.08, zoom), selUnit = unit / Math.max(0.1, Math.abs(selected?.scaleX || 1));
  return <svg ref={svg} data-testid="artboard" data-sticker-drop="canvas" className={`artboard ${checker ? 'checker' : 'plain-board'}`} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${project.width} ${project.height}`} width={project.width * zoom} height={project.height * zoom} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerDown={e => { if (e.target === svg.current) { setSelectedId(null); setNode(null); } }}>
    {referenceVisible && project.background && <image href={project.background.src} width={project.width} height={project.height} preserveAspectRatio="xMidYMid slice" opacity={project.background.opacity} pointerEvents="none"/>}
    {project.layers.filter(l => l.visible).map(l => <g key={l.id} data-layer-id={l.id} className={l.locked ? 'locked-art' : 'movable-art'} onPointerDown={e => {
      if (mode === 'node' && l.id === selectedId) return;
      const wordMode = l.kind === 'text' || l.kind === 'path';
      if (wordMode && (mode === 'glyph' || l.id !== selectedId) && l.glyphs.length) {
        const p = point(e), local = screenToLayer(l, p.x, p.y);
        let best = 0, distance = Infinity;
        l.glyphs.forEach((g, i) => { const q = glyphPoint(g, local); const dx = Math.max(0, -q.x, q.x - g.width), dy = Math.max(0, -q.y, q.y - g.height), score = dx * dx + dy * dy; if (g.commands.length && score <= distance) { best = i; distance = score; } });
        if (l.id !== selectedId) setSelectedId(l.id);
        setGlyphIndex(best); begin(e, 'glyph', l, { glyph: best });
      } else begin(e, 'move', l);
    }} dangerouslySetInnerHTML={{ __html: layerSvg(l) }}/>) }
    {selected?.visible && !selected.locked && <g transform={layerTransform(selected)} data-testid="selection-overlay">
      <rect className="selection-box" x={-10 * selUnit} y={-10 * selUnit} width={selected.width + 20 * selUnit} height={selected.height + 20 * selUnit} fill="none" strokeWidth={1.3 * selUnit} strokeDasharray={mode === 'node' ? `${5 * selUnit} ${5 * selUnit}` : undefined} pointerEvents="none"/>
      {mode === 'select' && <>
        <path d={`M${selected.width / 2} ${-10 * selUnit}V${-40 * selUnit}`} className="selection-line" strokeWidth={selUnit}/>
        <circle data-testid="rotate-handle" cx={selected.width / 2} cy={-40 * selUnit} r={6 * selUnit} className="transform-handle" onPointerDown={e => begin(e, 'rotate', selected)}/>
        {[[0, 0], [selected.width, 0], [0, selected.height], [selected.width, selected.height]].map(([x, y], i) => <rect key={i} data-testid={`scale-handle-${i}`} x={x - 5 * selUnit} y={y - 5 * selUnit} width={10 * selUnit} height={10 * selUnit} className="transform-handle scale-handle" strokeWidth={selUnit} onPointerDown={e => begin(e, 'scale', selected)}/>)}
      </>}
      {gradientGeometry && <g data-testid="gradient-overlay">
        {gradientGeometry.type === 'linear' ? <>
          <line className="gradient-canvas-underlay" x1={gradientGeometry.start.x} y1={gradientGeometry.start.y} x2={gradientGeometry.end.x} y2={gradientGeometry.end.y} strokeWidth={4 * selUnit}/>
          <line className="gradient-canvas-line" x1={gradientGeometry.start.x} y1={gradientGeometry.start.y} x2={gradientGeometry.end.x} y2={gradientGeometry.end.y} strokeWidth={1.5 * selUnit}/>
        </> : <g transform={`rotate(${gradientGeometry.rotation ?? 0} ${gradientGeometry.center.x} ${gradientGeometry.center.y})`}>
          <ellipse className="gradient-canvas-underlay" cx={gradientGeometry.center.x} cy={gradientGeometry.center.y} rx={gradientGeometry.radiusX} ry={gradientGeometry.radiusY} strokeWidth={4 * selUnit}/>
          <ellipse className="gradient-canvas-line" cx={gradientGeometry.center.x} cy={gradientGeometry.center.y} rx={gradientGeometry.radiusX} ry={gradientGeometry.radiusY} strokeWidth={1.5 * selUnit}/>
          <line className="gradient-canvas-line" x1={gradientGeometry.center.x} y1={gradientGeometry.center.y} x2={gradientGeometry.center.x + gradientGeometry.radiusX} y2={gradientGeometry.center.y} strokeWidth={1.5 * selUnit}/>
        </g>}
        {(gradientGeometry.type === 'linear' ? ['start', 'end'] as const : ['center', 'radiusX', 'radiusY'] as const).map(handle => {
          const p = gradientHandlePoint(gradientGeometry, handle), label = { start: '渐变起点', end: '渐变终点', center: '渐变中心', radiusX: '渐变水平半径', radiusY: '渐变垂直半径' }[handle];
          return <circle key={handle} data-testid={`gradient-handle-${handle}`} tabIndex={0} role="button" aria-label={label} cx={p.x} cy={p.y} r={6 * selUnit} strokeWidth={1.5 * selUnit} className="gradient-canvas-handle" onPointerDown={event => { event.currentTarget.focus(); begin(event, 'gradient', selected, { gradientHandle: handle }); }} onKeyDown={event => keyGradient(event, handle)}/>;
        })}
      </g>}
      {mode === 'glyph' && selected.glyphs.map((g, i) => {
        const corners = glyphCorners(g);
        const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const center = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
        const length = Math.hypot(top.x - center.x, top.y - center.y) || 1;
        const outward = { x: (top.x - center.x) / length, y: (top.y - center.y) / length };
        const knob = { x: top.x + outward.x * 34 * selUnit, y: top.y + outward.y * 34 * selUnit };
        const active = glyphEditing && glyphIndex === i && selected.glyphs.length > 0;
        return <g key={g.id} data-glyph-frame={i}>
          <path d={glyphFramePath(g)} fill={glyphIndex === i ? '#df563b15' : 'transparent'} stroke={glyphIndex === i ? '#df563b' : '#69796e'} strokeWidth={selUnit} strokeDasharray={`${4 * selUnit} ${4 * selUnit}`} className="glyph-target" data-glyph-index={i} onPointerDown={e => {
            /* setPointerCapture in begin() retargets click/dblclick to the <svg>, so a double click is detected here. */
            const previous = tap.current, now = Date.now();
            if (previous && previous.glyph === i && now - previous.time < 450 && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 8) {
              tap.current = null; e.preventDefault(); e.stopPropagation(); setGlyphIndex(i); setGlyphEditing(true); return;
            }
            tap.current = { glyph: i, time: now, x: e.clientX, y: e.clientY };
            setGlyphIndex(i); begin(e, 'glyph', selected, { glyph: i });
          }} onDoubleClick={e => { e.stopPropagation(); setGlyphIndex(i); setGlyphEditing(true); }}/>
          {active && <>
            <path d={glyphFramePath(g)} className="glyph-frame" fill="none" strokeWidth={1.3 * selUnit} pointerEvents="none"/>
            <line className="selection-line" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} strokeWidth={selUnit} pointerEvents="none"/>
            <circle data-testid="glyph-rotate-handle" tabIndex={0} role="button" aria-label="旋转单字" cx={knob.x} cy={knob.y} r={6 * selUnit} className="transform-handle" onPointerDown={e => begin(e, 'glyph-rotate', selected, { glyph: i })} onKeyDown={event => keyGlyphRotate(event, i)}/>
            {corners.map((corner, index) => <rect key={index} data-testid={`glyph-scale-handle-${index}`} tabIndex={0} role="button" aria-label={`缩放单字 ${index + 1}`} x={corner.x - 5 * selUnit} y={corner.y - 5 * selUnit} width={10 * selUnit} height={10 * selUnit} className="transform-handle scale-handle" strokeWidth={selUnit} onPointerDown={e => begin(e, 'glyph-scale', selected, { glyph: i, corner: index as GlyphCorner })}/>)}
          </>}
        </g>;
      })}
      {mode === 'node' && selected.kind !== 'image' && selected.glyphs.map((g, gi) => <g key={g.id} transform={`translate(${g.x} ${g.y}) rotate(${g.rotation || 0} ${g.width / 2} ${g.height / 2})`}>
        <path d={commandPath(g.commands)} fill="transparent" stroke="#df563b" strokeWidth={0.7 * selUnit} pointerEvents="none"/>
        {g.commands.map((c, ci) => { const p = commandEnd(c); if (!p) return null; const active = node?.glyph === gi && node.command === ci;
          const previous = commandEnd(g.commands[ci - 1] || c) || p;
          return <g key={ci}>
            {active && typeof c.x1 === 'number' && <><line x1={previous.x} y1={previous.y} x2={c.x1} y2={c.y1} stroke="#368576" strokeWidth={selUnit}/><circle data-testid="control-handle" cx={c.x1} cy={c.y1} r={4.5 * selUnit} className="control-point" strokeWidth={selUnit} onPointerDown={e => begin(e, 'node', selected, { glyph: gi, command: ci, handle: 'c1' })}/>{c.type === 'Q' && <line x1={p.x} y1={p.y} x2={c.x1} y2={c.y1} stroke="#368576" strokeWidth={selUnit}/>}</>}
            {active && typeof c.x2 === 'number' && <><line x1={p.x} y1={p.y} x2={c.x2} y2={c.y2} stroke="#368576" strokeWidth={selUnit}/><circle data-testid="control-handle" cx={c.x2} cy={c.y2} r={4.5 * selUnit} className="control-point" strokeWidth={selUnit} onPointerDown={e => begin(e, 'node', selected, { glyph: gi, command: ci, handle: 'c2' })}/></>}
            <circle data-testid="path-node" data-command-index={ci} data-glyph-index={gi} cx={p.x} cy={p.y} r={(active ? 5 : 3.3) * selUnit} className={`path-node ${active ? 'active-node' : ''}`} strokeWidth={selUnit} onPointerDown={e => { setNode({ glyph: gi, command: ci }); setGlyphIndex(gi); begin(e, 'node', selected, { glyph: gi, command: ci, handle: 'anchor' }); }}/>
          </g>;
        })}
      </g>)}
    </g>}
  </svg>;
}
