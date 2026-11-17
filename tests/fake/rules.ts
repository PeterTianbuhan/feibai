// 测试用的假世界，不进游戏。用来证明「世界」这个接口不是只为水墨量身做的：
// 资源不叫墨，耗法和补法都不一样（只在飞的时候耗，只在「泉」上补）；
// 有一个环境机制（飞行时一直有风往东吹，笔尖走的是弯的）；有景、有见闻、有奖励。

import { SheetBuilder } from '../../src/core/sheet';
import type { Sheet, WorldRules } from '../../src/core/world';

/** 风：飞行时往东的加速度，每秒每秒 */
export const WIND = 110;

function layout(seed: number): Sheet {
  const b = new SheetBuilder('fake', seed);
  b.spot({ x: 0, y: 0, r: 100, core: 8, big: true, name: '南口' });
  // 一路往北，每一跳都被风横着吹
  for (let i = 1; i <= 6; i++) {
    const last = i === 6;
    b.spot({ x: (i % 2 ? 40 : -30) + (seed % 5), y: -260 * i, r: last ? 96 : 84, core: 6, big: last, name: last ? '北口' : undefined, kind: i % 2 === 0 ? 'well' : undefined });
    b.link(i - 1, i);
  }
  b.sight({ id: 'cairn', name: '石堆', kind: 'cairn', x: 200, y: -780, reach: 220, note: { title: '石堆', text: '有人在风口垒了一堆石头。' } });
  return b.build();
}

export const fake: WorldRules<{ gusts: number }> = {
  id: 'fake',
  name: '风口',
  resource: { name: '气' },
  mechanic: { name: '风', hint: '飞的时候一直有风往东吹' },
  seed: 7,
  layout,
  rewards: [{ id: 'fake-all', at: 1, name: '走通' }],
  init: () => ({ gusts: 0 }),
  fly(s, env) {
    s.vx += WIND * env.dt;
    s.w.gusts++;
  },
  tick(s, env) {
    if (s.at < 0) s.res -= env.dt / 3.2; // 绕着转不耗，飞着才耗
  },
  land(s, _hit, spot) {
    if (spot.kind === 'well' || spot.big) s.res = 1;
  },
};
