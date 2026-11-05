import type { Command } from './types';

export type Point = { x: number; y: number };
type Contour = { points: Point[]; hole: boolean; orientation: number };
type Cap = { edge: number; normal: Point; reach: number; score: number };
type Pen = { stem: number; hair: number; angle: number; flow: number; facet: number; terminal: 'scoop' | 'flag' | 'diamond' | 'bevel' | 'wedge' | 'brush' };
export type DesignedOutline = { commands: Command[]; terminals: Command[][]; points: Point[]; top: Point; bottom: Point; left: Point; right: Point };

const pens: Record<string, Pen> = {
  'flourish-slanted': { stem: 0.023, hair: 0.037, angle: -0.32, flow: 0.024, facet: 0, terminal: 'brush' },
  'flourish-swash': { stem: 0.031, hair: 0.033, angle: -0.45, flow: 0.037, facet: 0, terminal: 'brush' },
  'flourish-royal': { stem: 0.042, hair: 0.048, angle: -0.12, flow: 0.014, facet: 0, terminal: 'scoop' },
  'flourish-ribbon': { stem: 0.042, hair: 0.012, angle: -0.4, flow: -0.018, facet: 0, terminal: 'brush' },
  'flourish-vine': { stem: 0.007, hair: 0.033, angle: -0.23, flow: 0.035, facet: 0, terminal: 'brush' },
  'gothic-spire': { stem: 0.034, hair: 0.047, angle: 0, flow: 0.004, facet: 0, terminal: 'scoop' },
  'gothic-fraktur': { stem: 0.029, hair: 0.018, angle: 0.36, flow: 0.006, facet: 1, terminal: 'flag' },
  'gothic-diamond': { stem: 0.028, hair: 0.035, angle: 0, flow: -0.005, facet: 0.5, terminal: 'diamond' },
  'gothic-textura': { stem: 0.023, hair: 0.029, angle: 0.05, flow: 0, facet: 0.8, terminal: 'bevel' },
  'gothic-inscription': { stem: 0.039, hair: 0.045, angle: -0.05, flow: -0.008, facet: 0, terminal: 'wedge' },
};
const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const length = (a: Point): number => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => { const d = length(a) || 1; return { x: a.x / d, y: a.y / d }; };
const mix = (a: Point, b: Point, t: number): Point => add(a, sub(b, a), t);
const endpoint = (c: Command): Point => ({ x: c.x ?? 0, y: c.y ?? 0 });

function area(points: Point[]): number {
  let result = 0;
  for (let i = 0; i < points.length; i++) result += cross(points[i], points[(i + 1) % points.length]);
  return result / 2;
}
function inside(point: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function bezier(points: Point[], t: number): Point {
  let row = points;
  while (row.length > 1) row = row.slice(1).map((p, i) => mix(row[i], p, t));
  return row[0];
}
function flatten(points: Point[], tolerance: number, output: Point[], depth = 0): void {
  const a = points[0], b = points[points.length - 1], chord = sub(b, a), denominator = length(chord);
  let error = 0;
  for (const point of points.slice(1, -1)) error = Math.max(error, denominator ? Math.abs(cross(chord, sub(point, a))) / denominator : length(sub(point, a)));
  if (error <= tolerance || depth >= 9) { output.push(b); return; }
  const left = [a], right = [b]; let row = points;
  while (row.length > 1) { row = row.slice(1).map((p, i) => mix(row[i], p, 0.5)); left.push(row[0]); right.unshift(row[row.length - 1]); }
  flatten(left, tolerance, output, depth + 1); flatten(right, tolerance, output, depth + 1);
}
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 5) return points;
  let split = 1, furthest = 0;
  for (let i = 1; i < points.length; i++) {
    const distance = length(sub(points[i], points[0]));
    if (distance > furthest) { furthest = distance; split = i; }
  }
  const open = [...points, points[0]], keep = new Uint8Array(open.length);
  keep[0] = keep[split] = keep[open.length - 1] = 1;
  const stack = [[0, split], [split, open.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const edge = sub(open[end], open[start]), denominator = dot(edge, edge);
    let greatest = tolerance, selected = -1;
    for (let i = start + 1; i < end; i++) {
      const t = denominator ? Math.max(0, Math.min(1, dot(sub(open[i], open[start]), edge) / denominator)) : 0;
      const distance = length(sub(open[i], add(open[start], edge, t)));
      if (distance > greatest) { greatest = distance; selected = i; }
    }
    if (selected >= 0) { keep[selected] = 1; stack.push([start, selected], [selected, end]); }
  }
  return points.filter((_, i) => keep[i]);
}
function contours(commands: Command[], size: number, facet: number, fillRule: 'evenodd' | 'nonzero'): Contour[] {
  const paths: Point[][] = []; let points: Point[] = [], current = { x: 0, y: 0 };
  const finish = (): void => {
    if (points.length > 1 && length(sub(points[0], points[points.length - 1])) < size * 0.00001) points.pop();
    if (points.length > 2 && Math.abs(area(points)) > size * size * 1e-10) paths.push(simplify(points, size * 0.00035));
    points = [];
  };
  for (const command of commands) {
    if (command.type === 'M') { finish(); current = endpoint(command); points.push(current); }
    else if (command.type === 'Z') finish();
    else {
      const next = endpoint(command);
      if (command.type === 'Q' || command.type === 'C') {
        const controls = [current, { x: command.x1 ?? current.x, y: command.y1 ?? current.y }];
        if (command.type === 'C') controls.push({ x: command.x2 ?? next.x, y: command.y2 ?? next.y });
        flatten([...controls, next], size * (0.0007 + facet * 0.009), points);
      } else if (!points.length || length(sub(next, points[points.length - 1])) > size * 1e-8) points.push(next);
      current = next;
    }
  }
  finish();
  return paths.map((polygon, index) => {
    const orientation = Math.sign(area(polygon));
    const containers = paths.filter((other, i) => i !== index && polygon.every(point => inside(point, other)));
    const winding = containers.reduce((sum, other) => sum + Math.sign(area(other)), 0);
    // Font contours may overlap or enclose strokes with the same winding. Only a
    // boundary that returns the winding to zero opens a nonzero-filled counter.
    const hole = fillRule === 'nonzero' ? winding !== 0 && winding + orientation === 0 : containers.length % 2 === 1;
    return { points: polygon, orientation, hole };
  });
}

function rayDistance(point: Point, direction: Point, paths: Contour[], epsilon: number): number {
  let closest = Infinity;
  for (const contour of paths) for (let i = 0; i < contour.points.length; i++) {
    const a = contour.points[i], b = contour.points[(i + 1) % contour.points.length], edge = sub(b, a), denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-12) continue;
    const difference = sub(a, point), distance = cross(difference, edge) / denominator, fraction = cross(difference, direction) / denominator;
    if (distance > epsilon && fraction >= -1e-8 && fraction <= 1 + 1e-8) closest = Math.min(closest, distance);
  }
  return closest;
}
function normal(tangent: Point, contour: Contour): Point {
  const sign = contour.orientation * (contour.hole ? -1 : 1);
  return { x: tangent.y * sign, y: -tangent.x * sign };
}
function capCandidates(contour: Contour, paths: Contour[], size: number, pen: Pen, amount: number): Cap[] {
  if (contour.hole) return [];
  const result: Cap[] = [], points = contour.points;
  for (let edge = 0; edge < points.length; edge++) {
    const a = points[edge], b = points[(edge + 1) % points.length], span = sub(b, a), width = length(span);
    if (width < size * 0.025 || width > size * 0.2) continue;
    const tangent = unit(span), outward = normal(tangent, contour);
    const incoming = unit(sub(a, points[(edge + points.length - 1) % points.length]));
    const outgoing = unit(sub(points[(edge + 2) % points.length], b));
    if (dot(incoming, outward) < 0.58 || dot(outgoing, outward) > -0.58) continue;
    const clearance = rayDistance(mix(a, b, 0.5), outward, paths, size * 1e-6);
    if (Number.isFinite(clearance)) continue;
    const reach = Math.min(size * (pen.terminal === 'wedge' ? 0.13 : 0.095), width * 1.45) * amount;
    if (reach < size * 0.008) continue;
    result.push({ edge, normal: outward, reach, score: reach * (pen.terminal === 'scoop' ? 0.4 + Math.abs(outward.y) : 0.7 + Math.abs(outward.x)) });
  }
  return result.sort((a, b) => b.score - a.score).slice(0, 6);
}
function terminal(a: Point, b: Point, cap: Cap, kind: Pen['terminal']): Point[] {
  const n = cap.normal, r = cap.reach, t = sub(b, a), at = (fraction: number, height: number): Point => add(add(a, t, fraction), n, r * height);
  if (kind === 'flag') return [a, at(0.18, 0.55), at(0.66, 1), at(1, 0.22), b];
  if (kind === 'diamond') return [a, at(0.5, 1), b];
  if (kind === 'bevel') return [a, at(0.18, 0.45), at(0.8, 0.45), b];
  const tip = kind === 'brush' ? at(0.86, 0.58) : kind === 'wedge' ? at(0.5, 1) : at(0.94, 1);
  const left = [a, at(0.5, 0.01), add(tip, n, -r * 0.5), tip];
  const right = [tip, add(tip, n, -r * 0.5), at(0.87, 0.02), b];
  const samples: Point[] = [];
  for (let i = 0; i <= 8; i++) samples.push(bezier(left, i / 8));
  for (let i = 1; i <= 8; i++) samples.push(bezier(right, i / 8));
  return samples;
}

export function reshapeOutline(commands: Command[], width: number, height: number, id: string, amount: number, fillRule: 'evenodd' | 'nonzero' = 'evenodd'): DesignedOutline {
  const size = Math.max(0.001, Math.min(height, width * 1.4)), pen = pens[id];
  const paths = contours(commands, size, pen.facet * amount, fillRule), output: Point[][] = [], terminals: Command[][] = [];
  const polygon = (points: Point[]): Command[] => [...points.map((point, i): Command => ({ type: i ? 'L' : 'M', ...point })), { type: 'Z' }];
  const cosine = Math.cos(pen.angle), sine = Math.sin(pen.angle);
  const warp = (point: Point): Point => {
    const x = point.x / Math.max(width, size * 0.1), y = point.y / Math.max(height, size * 0.1);
    return {
      x: point.x + size * amount * pen.flow * Math.sin(Math.PI * y) * (0.4 + 0.6 * x),
      y: point.y + size * amount * pen.flow * 0.45 * Math.sin(2 * Math.PI * x) * Math.sin(Math.PI * y),
    };
  };
  const candidates = paths.flatMap(contour => capCandidates(contour, paths, size, pen, amount).map(cap => ({
    contour, cap, point: mix(contour.points[cap.edge], contour.points[(cap.edge + 1) % contour.points.length], 0.5),
  }))).sort((a, b) => b.cap.score - a.cap.score);
  const selected: typeof candidates = [];
  const capLimit = id === 'gothic-inscription' ? 3 : id.startsWith('gothic-') ? 2 : 1;
  for (const candidate of candidates) {
    if (selected.length >= capLimit) break;
    if (selected.some(other => length(sub(candidate.point, other.point)) < size * 0.28)) continue;
    selected.push(candidate);
  }
  for (const contour of paths) {
    const raw = contour.points, dense: Point[] = [], starts: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      starts.push(dense.length);
      const a = raw[i], b = raw[(i + 1) % raw.length], divisions = Math.max(1, Math.min(64, Math.ceil(length(sub(b, a)) / (size / 28))));
      for (let j = 0; j < divisions; j++) dense.push(mix(a, b, j / divisions));
    }
    const moved = dense.map((point, index) => {
      const previous = unit(sub(point, dense[(index + dense.length - 1) % dense.length]));
      const next = unit(sub(dense[(index + 1) % dense.length], point));
      const outward = normal(unit(add(previous, next)), contour);
      const vertical = (outward.x * cosine + outward.y * sine) ** 2;
      const modulation = id === 'flourish-ribbon' ? 0.75 + 0.4 * Math.sin(point.x / size * Math.PI * 2 + point.y / size * Math.PI) : 1;
      let displacement = size * amount * (pen.stem * vertical * modulation - pen.hair * (1 - vertical));
      const direction = displacement >= 0 ? outward : { x: -outward.x, y: -outward.y };
      const clearance = rayDistance(point, direction, paths, size * 1e-6);
      // Opposite edges keep a positive ink/white interval, including nested counters.
      const minimumInk = Math.min(size * 0.014, clearance * 0.8);
      const limit = displacement >= 0 ? clearance * 0.22 : Math.max(0, clearance - minimumInk) * 0.46;
      displacement = Math.sign(displacement) * Math.min(Math.abs(displacement), limit);
      return add(point, outward, displacement);
    });
    const caps = new Map(selected.filter(candidate => candidate.contour === contour).map(({ cap }) => [cap.edge, cap]));
    const points: Point[] = [];
    for (let edge = 0; edge < raw.length; edge++) {
      const from = starts[edge], to = edge + 1 < raw.length ? starts[edge + 1] : dense.length, cap = caps.get(edge);
      if (cap) {
        const shape = terminal(moved[from], moved[to % moved.length], cap, pen.terminal);
        const overlap = size * amount * 0.0015;
        shape.push(add(moved[to % moved.length], cap.normal, -overlap), add(moved[from], cap.normal, -overlap));
        terminals.push(polygon(shape.map(warp)));
      }
      for (let index = from; index < to; index++) points.push(warp(moved[index]));
    }
    output.push(points);
  }
  const points = output.flat(), result: Command[] = [];
  let top = points[0] ?? { x: 0, y: 0 }, bottom = top, left = top, right = top;
  for (const contour of output) {
    for (const [i, point] of contour.entries()) {
      result.push({ type: i ? 'L' : 'M', ...point });
      if (point.y < top.y || point.y === top.y && point.x < top.x) top = point;
      if (point.y > bottom.y || point.y === bottom.y && point.x > bottom.x) bottom = point;
      if (point.x < left.x) left = point;
      if (point.x > right.x) right = point;
    }
    result.push({ type: 'Z' });
  }
  return { commands: result, terminals, points, top, bottom, left, right };
}
