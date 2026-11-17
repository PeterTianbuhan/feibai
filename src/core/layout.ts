// 摆点的小工具。世界的 layout 可以用，也可以完全自己摆，只要最后交出一张过得了 checkSheet 的纸。

import { TAU, type Rng } from './rng';
import type { SheetBuilder } from './sheet';
import type { Spot } from './world';

export interface ChainOpts {
  /** 从哪个点接出去 */
  from: number;
  /** 接几个点 */
  count: number;
  rng: Rng;
  /** 大方向（弧度）。每一步会左右摆，摆远了被拉回来 */
  toward: number;
  /** 每一步最多偏多少弧度，默认 0.95 */
  wander?: number;
  /** 往大方向拉回的力度，0 是不拉，1 是每步都回正。默认 0.35 */
  pull?: number;
  /** 和别的圈之间留多宽 */
  gap?: number;
  /** 第 i 个点（从 0 数）长什么样、离上一个点多远。一跳难不难主要就是这里定的 */
  shape(i: number, rng: Rng): Omit<Spot, 'id' | 'x' | 'y' | 'big'> & { big?: boolean; dist: number };
}

const turn = (from: number, to: number) => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/** 从一个点起，朝一个大方向接出一串点，挨个连上。返回新点的 id */
export function chain(b: SheetBuilder, o: ChainOpts): number[] {
  const wander = o.wander ?? 0.95, pull = o.pull ?? 0.35, gap = o.gap ?? 34, ids: number[] = [];
  let prev = b.spots[o.from], heading = o.toward;
  for (let i = 0; i < o.count; i++) {
    const { dist: d0, ...shape } = o.shape(i, o.rng);
    let dist = d0, tries = 0, guard = 0;
    for (;;) {
      if (++guard > 600) throw new Error(`第 ${i} 个点摆不下，周围太挤`);
      const h = heading + o.rng.range(-1, 1) * (tries < 12 ? wander : 2.6);
      const x = prev.x + Math.cos(h) * dist, y = prev.y + Math.sin(h) * dist;
      if (b.fits(x, y, shape.r, gap)) {
        const p = b.spot({ ...shape, x, y });
        b.link(prev.id, p.id);
        ids.push(p.id);
        heading = h + turn(h, o.toward) * pull;
        prev = p;
        break;
      }
      if (++tries > 30) { dist += 40; tries = 12; }
    }
  }
  return ids;
}
