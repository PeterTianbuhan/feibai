// 名册里的每个世界都要过的检查。新加一个世界不用改这个文件，放进 src/worlds/<名字>/ 就会被查到。

import { describe, expect, it } from 'vitest';
import { checkLinks } from '../src/core/atlas';
import { checkWorld } from '../src/core/check';
import { LEVELS } from '../src/core/feel';
import { makeRun } from '../src/core/sim';
import { ATLAS, HOME, WORLDS } from '../src/worlds';
import { LOOKS } from '../src/worlds/looks';
import { playRoute } from '../tools/bot/play';

describe('名册', () => {
  it('新玩家开始的那个世界在名册里', () => {
    expect(WORLDS.map((w) => w.id)).toContain(HOME);
    expect(new Set(WORLDS.map((w) => w.id)).size).toBe(WORLDS.length);
  });

  it('渡口都设在存在的大点上', () => {
    expect(checkLinks(ATLAS)).toEqual([]);
  });
});

describe.each(WORLDS.map((w) => [w.id, w] as const))('世界 %s', (id, rules) => {
  it('目录名和 id 一致，规则合格', () => {
    expect(checkWorld(rules)).toEqual([]);
  });

  it('有画法', () => {
    const look = LOOKS[id];
    expect(look, `src/worlds/${id}/look.ts 要导出 look`).toBeTruthy();
    for (const key of ['ground', 'line', 'accent', 'font'] as const) expect(look.theme[key]).toBeTruthy();
    expect(typeof look.painter).toBe('function');
    expect(look.count(3)).toBeTruthy();
  });

  it.each(LEVELS.map((l, i) => [l.name, i] as const))('%s档：机器人能把每条路走通', (_name, li) => {
    const run = makeRun(rules, LEVELS[li], ATLAS.sheets[id]);
    for (const route of ATLAS.sheets[id].routes) {
      const stat = playRoute(run, route, { runs: 12 });
      const stuck = stat.hops.filter((h) => h.ok === 0).map((h) => `${h.from}→${h.to}`);
      expect(stuck, `路「${route.name}」走不通的跳`).toEqual([]);
    }
  });
});
