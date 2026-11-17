// 一张纸的装配和检查。世界的 layout 用 SheetBuilder 摆点，最后 build 出 Sheet。
// 这里只管「摆得对不对」：id、连通、圈不叠。摆得好不好玩，看机器人的数字。

import { MAX_RING } from './feel';
import { hashStr } from './rng';
import type { Route, Sheet, Sight, Spot } from './world';

/** 两个圈之间至少留这么宽的空（按最大那一档的圈算） */
export const RING_GAP = 8;

export class SheetBuilder {
  spots: Spot[] = [];
  edges: [number, number][] = [];
  sights: Sight[] = [];
  routes: Route[] = [];
  start = 0;

  constructor(readonly world: string, readonly seed: number) {}

  spot(p: Omit<Spot, 'id' | 'big'> & { big?: boolean }): Spot {
    const s: Spot = { ...p, big: !!p.big, id: this.spots.length };
    this.spots.push(s);
    return s;
  }

  link(a: number, b: number) {
    this.edges.push([a, b]);
  }

  sight(g: Sight) {
    this.sights.push(g);
  }

  /** 这个位置放一个半径 r 的圈，会不会和已有的叠上 */
  fits(x: number, y: number, r: number, gap = RING_GAP): boolean {
    for (const p of this.spots) {
      if (Math.hypot(p.x - x, p.y - y) < (p.r + r) * MAX_RING + gap) return false;
    }
    return true;
  }

  /** 没自己写路的话，按「大点到下一个大点」切出一段一段的路 */
  build(): Sheet {
    const sheet: Sheet = {
      world: this.world, seed: this.seed, spots: this.spots, edges: this.edges,
      start: this.start, sights: this.sights, routes: this.routes,
    };
    if (!sheet.routes.length) sheet.routes = segmentRoutes(sheet);
    return sheet;
  }
}

function neighbours(sheet: Sheet): number[][] {
  const near: number[][] = sheet.spots.map(() => []);
  for (const [a, b] of sheet.edges) { near[a]?.push(b); near[b]?.push(a); }
  return near;
}

/**
 * 从起点沿建议走法一层层走出去，每到一个大点，就把「上一个大点到它」记成一条路。
 * 玩家是从大点出发的，所以一段路的通过率就是「从这个大点一口气走到下一个大点」有多难。
 */
export function segmentRoutes(sheet: Sheet): Route[] {
  const near = neighbours(sheet), parent = new Int32Array(sheet.spots.length).fill(-2);
  const queue = [sheet.start], routes: Route[] = [];
  parent[sheet.start] = -1;
  while (queue.length) {
    const a = queue.shift()!;
    for (const b of near[a]) {
      if (parent[b] !== -2) continue;
      parent[b] = a; queue.push(b);
      if (sheet.spots[b].big) {
        const path = [b];
        let c = a;
        while (c >= 0) { path.push(c); if (sheet.spots[c].big) break; c = parent[c]; }
        path.reverse();
        const from = sheet.spots[path[0]], to = sheet.spots[b];
        routes.push({ id: `${path[0]}-${b}`, name: `${from.name ?? path[0]}→${to.name ?? b}`, spots: path });
      }
    }
  }
  return routes;
}

/** 把几段首尾相接的路连成一条，比如从起点一直走到某条路的尽头 */
export function joinRoutes(id: string, name: string, parts: Route[]): Route {
  const spots = [...parts[0].spots];
  for (const p of parts.slice(1)) spots.push(...p.spots.slice(1));
  return { id, name, spots };
}

/** 布局的指纹。存档里记着它，布局改了旧的进度就对不上号，要作废 */
export function fingerprint(sheet: Sheet): string {
  let s = sheet.world + ':' + sheet.start;
  for (const p of sheet.spots) s += `|${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.r)},${p.big ? 1 : 0}`;
  for (const g of sheet.sights) s += '|' + g.id;
  return hashStr(s).toString(36);
}

/** 检查一张纸。返回问题的列表，空的就是没问题 */
export function checkSheet(sheet: Sheet): string[] {
  const bad: string[] = [], n = sheet.spots.length;
  if (!n) return ['一个点都没有'];
  sheet.spots.forEach((p, i) => {
    if (p.id !== i) bad.push(`点 ${i} 的 id 是 ${p.id}，应该等于下标`);
    if (!(p.r > p.core && p.core > 0)) bad.push(`点 ${i} 的圈(${p.r})要比点心(${p.core})大`);
    if (p.big && !p.name) bad.push(`大点 ${i} 没有名字`);
    if (![p.x, p.y, p.r, p.core].every(Number.isFinite)) bad.push(`点 ${i} 有不是数的坐标`);
  });
  if (!sheet.spots[sheet.start]?.big) bad.push('起点要是一个大点');
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sheet.spots[i], b = sheet.spots[j], gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r) * MAX_RING;
      if (gap < RING_GAP) bad.push(`点 ${i} 和点 ${j} 的圈叠在一起或挨得太近（空 ${gap.toFixed(0)}）`);
    }
  }
  for (const [a, b] of sheet.edges) {
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) bad.push(`走法 ${a}-${b} 指向不存在的点`);
  }
  if (!bad.length) {
    const near = neighbours(sheet), seen = new Uint8Array(n), queue = [sheet.start];
    seen[sheet.start] = 1;
    while (queue.length) for (const b of near[queue.shift()!]) if (!seen[b]) { seen[b] = 1; queue.push(b); }
    for (let i = 0; i < n; i++) if (!seen[i]) bad.push(`点 ${i} 从起点沿走法到不了`);
    const linked = new Set(sheet.edges.map(([a, b]) => (a < b ? a * n + b : b * n + a)));
    for (const r of sheet.routes) {
      if (r.spots.length < 2) bad.push(`路「${r.name}」不到两个点`);
      for (let i = 1; i < r.spots.length; i++) {
        const a = r.spots[i - 1], b = r.spots[i];
        if (!linked.has(a < b ? a * n + b : b * n + a)) bad.push(`路「${r.name}」的 ${a}→${b} 不在走法里`);
      }
    }
  }
  const ids = new Set<string>();
  for (const g of sheet.sights) {
    if (ids.has(g.id)) bad.push(`景 ${g.id} 重名`);
    ids.add(g.id);
    // reach 写 0 的景由世界自己用 env.sight 触发（world.ts 里 Sight.reach 的说明），不用挨着点
    if (g.reach > 0 && !sheet.spots.some((p) => Math.hypot(p.x - g.x, p.y - g.y) <= g.reach)) bad.push(`景 ${g.id} 附近没有点，永远到不了`);
  }
  if (new Set(sheet.routes.map((r) => r.id)).size !== sheet.routes.length) bad.push('路的 id 有重复');
  return bad;
}
