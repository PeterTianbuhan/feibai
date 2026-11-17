// 测试用的怪世界，不进游戏。它不讲究好不好玩，只是把底座给世界的每一种能力都用一遍，
// 对应 docs/worlds.md 那几页要的东西：
//   离手扣一格（星图）、用尽了不马上结束（夜灯、星图）、飞空送回上一个大点（薄冰、雨塘）、
//   路过把别的点记成到过并留一个记号（蒲公英、电线）、撞墙弹回（窗花）、
//   时隐时现的圈（雨塘）、只看得见近处（夜灯）、自己定射程（星图）、状态里有数组（刺绣）。

import { TICKS } from '../../src/core/feel';
import { SheetBuilder } from '../../src/core/sheet';
import type { Sheet, WorldRules } from '../../src/core/world';

/** 一堵横着的墙，飞到这里弹回去 */
export const WALL_Y = 200;
/** 看得见多远 */
export const SIGHT = 600;
export const BELL = 3;
export const GHOST = 4;

function layout(seed: number): Sheet {
  const b = new SheetBuilder('odd', seed);
  b.spot({ x: 0, y: 0, r: 100, core: 8, big: true, name: '营地' });
  b.spot({ x: 270, y: 0, r: 84, core: 6, kind: 'flat' });
  b.spot({ x: 540, y: 0, r: 96, core: 8, big: true, name: '驿站' });
  b.spot({ x: 135, y: -200, r: 40, core: 4, kind: 'bell' }); // 路旁的钟：不用落上去，路过就响
  b.spot({ x: 810, y: 0, r: 96, core: 8, big: true, name: '幻', kind: 'ghost' }); // 一会儿在一会儿不在
  b.link(0, 1); b.link(1, 2); b.link(2, 4); b.link(0, 3);
  b.routes = [
    { id: 'road', name: '营地→驿站', spots: [0, 1, 2] },
    { id: 'ghost', name: '驿站→幻', spots: [2, 4] },
  ];
  const sheet = b.build();
  sheet.data = { wallY: WALL_Y };
  return sheet;
}

interface OddState {
  /** 一路落过的点，按先后 */
  path: number[];
  bounces: number;
}

/** 幻：每一圈半里，前一半在，后一半不在。和绕圈的节拍错开，所以不是每一圈都有机会 */
export const ghostOn = (tick: number, period: number) => (tick / (period * TICKS * 1.5)) % 1 < 0.5;

export const odd: WorldRules<OddState> = {
  id: 'odd',
  name: '怪',
  resource: { name: '格', endsAtZero: false },
  mechanic: { name: '样样来一点', hint: '只给测试用' },
  seed: 3,
  layout,
  rewards: [],
  reach: 700,
  init: () => ({ path: [], bounces: 0 }),
  clone: (w) => ({ ...w, path: [...w.path] }),
  leave(s) {
    s.res -= 0.25; // 离手耗一格
  },
  fly(s, env) {
    const wall = (env.sheet.data as { wallY: number }).wallY;
    if (s.y > wall && s.vy > 0) { s.y = wall * 2 - s.y; s.vy = -s.vy; s.w.bounces++; }
    const bell = env.sheet.spots[BELL];
    if (!s.seen[BELL] && Math.hypot(s.x - bell.x, s.y - bell.y) < 280) { env.visit(s, BELL); env.mark(s, 'bell'); }
  },
  tick(s, env) {
    // 没格了还停在小点上，这一趟才结束
    if (s.res <= 0 && s.at >= 0 && !env.sheet.spots[s.at].big) env.end(s, 'out');
  },
  land(s, _hit, spot) {
    s.w.path.push(spot.id);
    if (spot.big) s.res = 1;
  },
  canLand: (s, spot, _d, env) => spot.kind !== 'ghost' || ghostOn(s.tick, env.feel.period),
  fine: (_s, spot, d) => spot.kind !== 'flat' && d < 30,
  lost(s, why, env) {
    if (why !== 'miss' || s.lastBig < 0) return false;
    env.put(s, s.lastBig); // 飞空了送回上一个大点，接着走
    s.res = 1;
    return true;
  },
  canSee: (s, spot) => Math.hypot(spot.x - s.x, spot.y - s.y) < SIGHT,
};
