// 水墨这张纸。现在是一个能用的最简布局：起笔处在中间，朝三个方向各走出一条路，
// 每条路三段，一段六个小点接一个大点，越往外圈越小、隔得越开。
// 大点的名字、景放在哪，都是占位，等做布局和见闻的人来换。
// 改这里的数之前和之后各跑一遍 npm run bot -- --world ink，把通过率的对比带上。

import { chain } from '../../core/layout';
import { makeRng } from '../../core/rng';
import { SheetBuilder, joinRoutes, segmentRoutes } from '../../core/sheet';
import type { Sheet } from '../../core/world';

const ARMS = [
  { id: 'hill', name: '山路', toward: -1.15, stops: ['松下', '半山', '峰顶'] },
  { id: 'river', name: '水路', toward: 0.75, stops: ['溪口', '江心', '远岸'] },
  { id: 'grove', name: '竹路', toward: 2.95, stops: ['竹径', '竹深', '林尽'] },
];
const SEGMENT = 6;

/** 景：挂在某条路的第几个点旁边 */
const SIGHTS = [
  { id: 'far-hills', name: '远山', kind: 'hills', arm: 'hill', at: 3 },
  { id: 'hill-moon', name: '山月', kind: 'moon', arm: 'hill', at: 15 },
  { id: 'lone-boat', name: '孤舟', kind: 'boat', arm: 'river', at: 4 },
  { id: 'far-shore', name: '隔岸', kind: 'hills', arm: 'river', at: 13 },
  { id: 'bamboo', name: '竹', kind: 'bamboo', arm: 'grove', at: 2 },
  { id: 'deep-bamboo', name: '深竹', kind: 'bamboo', arm: 'grove', at: 12 },
];

export function layout(seed: number): Sheet {
  const b = new SheetBuilder('ink', seed);
  const origin = b.spot({ x: 0, y: 0, r: 112, core: 7, big: true, name: '起笔' });
  b.start = origin.id;
  const arms: Record<string, number[]> = {};

  for (const arm of ARMS) {
    const rng = makeRng(seed).fork(arm.id), ids: number[] = [];
    let from = origin.id;
    arm.stops.forEach((name, si) => {
      const got = chain(b, {
        from, count: SEGMENT + 1, rng, toward: arm.toward,
        shape(i, r) {
          const depth = si * (SEGMENT + 1) + i + 1; // 离起笔处第几跳
          const dist = r.range(215, 285) + depth * 2.2;
          if (i === SEGMENT) return { r: 96, core: 9, big: true, name, dist };
          return { r: Math.max(48, 100 - depth * 2) * r.range(0.88, 1.08), core: r.range(4.5, 8.5), dist };
        },
      });
      ids.push(...got);
      from = got[got.length - 1];
    });
    arms[arm.id] = ids;
  }

  // 景放在点的旁边，挑离别的圈远的那一侧，不压在圈上
  for (const g of SIGHTS) {
    const ids = arms[g.arm], p = b.spots[ids[g.at]], q = b.spots[ids[g.at - 1]];
    const along = Math.atan2(p.y - q.y, p.x - q.x), off = 205;
    const sides = [1, -1].map((side) => {
      const x = p.x + Math.cos(along + (side * Math.PI) / 2) * off, y = p.y + Math.sin(along + (side * Math.PI) / 2) * off;
      const room = Math.min(...b.spots.map((s) => Math.hypot(s.x - x, s.y - y) - s.r));
      return { x, y, room };
    });
    const best = sides[0].room >= sides[1].room ? sides[0] : sides[1];
    b.sight({ id: g.id, name: g.name, kind: g.kind, x: best.x, y: best.y, reach: off + 10 });
  }
  // 藏着的一处：探索到一半才出现在起笔处旁边
  b.sight({ id: 'first-moon', name: '月', kind: 'moon', x: -150, y: -170, reach: 240, needs: 'ink-half' });

  // 路：一段一段的（大点到大点），加上从起笔处一口气走到头的三条
  const sheet = b.build();
  const segs = segmentRoutes(sheet);
  sheet.routes = [...segs];
  for (const arm of ARMS) {
    const parts = arm.stops.map((name) => segs.find((r) => sheet.spots[r.spots[r.spots.length - 1]].name === name)!);
    sheet.routes.push(joinRoutes(arm.id, arm.name + '走到头', parts));
  }
  return sheet;
}
