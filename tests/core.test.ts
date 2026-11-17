import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWindow, flyOut, hopWindowMs } from '../src/core/aim';
import { across, checkLinks, makeAtlas } from '../src/core/atlas';
import { checkWorld } from '../src/core/check';
import { DT, LEVELS, TICKS } from '../src/core/feel';
import { emptySave, exploration, parseSave, progressOf, record, recordBest, startable } from '../src/core/progress';
import { makeRng, TAU } from '../src/core/rng';
import { checkSheet, fingerprint } from '../src/core/sheet';
import { clone, makeRun, start, step, type Run } from '../src/core/sim';
import type { Landing, Sim } from '../src/core/world';
import { rules as ink } from '../src/worlds/ink/rules';
import { playRoute } from '../tools/bot/play';
import { fake, WIND } from './fake/rules';

const MID = LEVELS[1];

/** 离手，飞到落下或结束。返回落下那件事 */
function hop(run: Run, s: Sim, wait: number): Landing | null {
  for (let i = 0; i < wait; i++) step(run, s, false);
  s.events.length = 0;
  step(run, s, true);
  while (s.at < 0 && !s.over) step(run, s, false);
  return (s.events.find((e) => e.type === 'land') as Landing) ?? null;
}

/** 在时间窗里的第 pick（0 到 1）处离手 */
function hopTo(run: Run, s: Sim, target: number, pick = 0.5): Landing | null {
  const w = findWindow(run, s, target)!;
  expect(w, `到 ${target} 有时间窗`).toBeTruthy();
  return hop(run, s, Math.round(w.from + (w.to - w.from) * pick));
}

describe('规则和运动', () => {
  it('同样的按键，走出同样的结果', () => {
    const run = makeRun(ink, MID);
    const play = () => {
      const s = start(run);
      for (let i = 0; i < 3000; i++) step(run, s, i % 211 === 90);
      return [s.x, s.y, s.res, s.at, s.score, s.tick, s.over];
    };
    expect(play()).toEqual(play());
  });

  it('不按就一直绕着起点转，不耗资源', () => {
    const run = makeRun(ink, MID), s = start(run);
    for (let i = 0; i < TICKS * 20; i++) step(run, s, false);
    expect(s.at).toBe(run.sheet.start);
    expect(s.res).toBe(1);
    expect(s.started).toBe(false);
  });

  it('转一圈多久是固定的：不看落得准不准，也不看走了多远', () => {
    const run = makeRun(ink, MID), route = run.sheet.routes.find((r) => r.id === 'hill')!;
    const speeds: number[] = [];
    // 一路上有时擦着圈边落，有时落在正中
    const s = start(run, route.spots[0], route.spots[1]);
    for (let i = 1; i <= 8; i++) {
      const hit = hopTo(run, s, route.spots[i], i % 2 ? 0.08 : 0.5)!;
      expect(hit.spot).toBe(route.spots[i]);
      const a0 = s.ang;
      step(run, s, false);
      speeds.push(Math.abs(s.ang - a0) / DT);
    }
    for (const w of speeds) expect(w).toBeCloseTo(TAU / MID.period, 9);
  });

  it('落得准不改绕圈半径：最后都收到这个点固定的半径上', () => {
    const run = makeRun(ink, MID), [a, b] = run.sheet.routes[0].spots;
    const radii = [0.05, 0.5, 0.95].map((pick) => {
      const s = start(run, a, b);
      hopTo(run, s, b, pick);
      for (let i = 0; i < TICKS * 3; i++) step(run, s, false);
      return s.r;
    });
    expect(radii[0]).toBeCloseTo(run.orbitR[b], 3);
    expect(radii[1]).toBeCloseTo(run.orbitR[b], 3);
    expect(radii[2]).toBeCloseTo(run.orbitR[b], 3);
  });

  it('「妙」只奖不罚：水墨里落得准，接下来一小会儿不耗墨', () => {
    const run = makeRun(ink, MID), [a, b] = run.sheet.routes[0].spots;
    const after = (pick: number) => {
      const s = start(run, a, b), hit = hopTo(run, s, b, pick)!;
      for (let i = 0; i < TICKS; i++) step(run, s, false);
      return { fine: hit.fine, res: s.res };
    };
    const centre = after(0.5), edge = after(0.02);
    expect(centre.fine).toBe(true);
    expect(edge.fine).toBe(false);
    expect(centre.res).toBe(1);
    expect(edge.res).toBeLessThan(1);
  });

  it('飞空和资源用尽都会结束这一趟', () => {
    const run = makeRun(ink, MID);
    const s = start(run);
    // 找一个哪儿都落不到的离手时刻
    let k = 0;
    for (; k < TICKS * 4; k++) { if (flyOut(run, clone(s)) < 0) break; step(run, s, false); }
    hop(run, s, 0);
    expect(s.over).toBe('miss');

    const t = start(run), [a, b] = run.sheet.routes[0].spots;
    expect(a).toBe(run.sheet.start);
    hopTo(run, t, b);
    for (let i = 0; i < TICKS * 30 && !t.over; i++) step(run, t, false);
    expect(t.over).toBe('out');
    expect(t.res).toBe(0);
  });

  it('副本和原件互不相干', () => {
    const run = makeRun(ink, MID), s = start(run), c = clone(s);
    for (let i = 0; i < 500; i++) step(run, c, i === 100);
    expect(s.tick).toBe(0);
    expect(s.seen.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s.w.grace).toBe(0);
  });

  it('时间窗说得准：窗里离手落得进，窗外一拍就落不进', () => {
    const run = makeRun(ink, LEVELS[2]), [a, b] = run.sheet.routes[0].spots;
    const s = start(run, a, b), w = findWindow(run, s, b)!;
    const lands = (k: number) => { const c = clone(s); return hop(run, c, k)?.spot === b; };
    expect(lands(w.from)).toBe(true);
    expect(lands(w.to)).toBe(true);
    expect(lands(w.from - 1)).toBe(false);
    expect(lands(w.to + 1)).toBe(false);
    expect(hopWindowMs(run, a, b)).toBeGreaterThan(60);
  });

  it('core 的代码里不认识「墨」，也不碰页面和时钟（注释里举例不算）', () => {
    const dir = resolve(__dirname, '../src/core');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(resolve(dir, f), 'utf8');
      const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(/墨|\bink\b/i.test(code), `${f} 的代码里提到了墨`).toBe(false);
      expect(/Math\.random|Date\.now|new Date|performance\.|document\.|window\./.test(code), `${f} 里用了随机、时钟或页面`).toBe(false);
    }
  });
});

describe('假世界：接口不是只为水墨做的', () => {
  it('合格', () => {
    expect(checkWorld(fake)).toEqual([]);
    expect(fake.resource.name).not.toBe(ink.resource.name);
    expect(fake.mechanic).toBeTruthy();
  });

  it('风真的把笔尖吹偏了，瞄准也把风算进去了', () => {
    const run = makeRun(fake, MID), s = start(run, 0, 1);
    const w = findWindow(run, s, 1)!;
    const c = clone(s);
    for (let i = 0; i < Math.round((w.from + w.to) / 2); i++) step(run, c, false);
    step(run, c, true);
    const vx0 = c.vx, flight = c.tick;
    while (c.at < 0 && !c.over) step(run, c, false);
    expect(c.at).toBe(1);
    expect(c.vx - vx0).toBeCloseTo(WIND * (c.tick - flight) * DT, 6);
    // 同一个时刻离手，没有风的话落不到同一个地方
    const calm = makeRun({ ...fake, fly: undefined }, MID), d = clone(s);
    for (let i = 0; i < Math.round((w.from + w.to) / 2); i++) step(calm, d, false);
    step(calm, d, true);
    while (d.at < 0 && !d.over) step(calm, d, false);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThan(20);
  });

  it('资源按它自己的规矩耗和补：绕着不耗，飞着耗，落到泉上补满', () => {
    const run = makeRun(fake, MID), s = start(run, 0, 1);
    hopTo(run, s, 1);
    const afterFlight = s.res;
    expect(afterFlight).toBeLessThan(1);
    for (let i = 0; i < TICKS * 5; i++) step(run, s, false);
    expect(s.res).toBe(afterFlight);
    hopTo(run, s, 2);
    expect(run.sheet.spots[2].kind).toBe('well');
    expect(s.res).toBe(1);
  });

  it('机器人能把它的路走通，同一个种子跑两遍数字一样', () => {
    const run = makeRun(fake, MID), route = run.sheet.routes[0];
    const a = playRoute(run, route, { runs: 60 }), b = playRoute(run, route, { runs: 60 });
    expect(a.broken).toBe(false);
    expect(a.pass).toBeGreaterThan(0.3);
    expect(a.hops.map((h) => h.ok)).toEqual(b.hops.map((h) => h.ok));
    // 手更稳的人过得更多
    expect(playRoute(run, route, { runs: 60, sigmaMs: 10 }).pass).toBeGreaterThanOrEqual(a.pass);
  });
});

describe('进度', () => {
  const atlas = makeAtlas([ink, fake], [{ a: { world: 'ink', spot: 7 }, b: { world: 'fake', spot: 6 } }]);
  const land = (spot: number, from: number): Landing => ({ type: 'land', spot, from, fresh: true, fine: false, d: 0, x: 0, y: 0, vx: 0, vy: 0 });

  it('到过的大点能当起点，走过的跳记下来', () => {
    const save = emptySave(), sheet = atlas.sheets.ink, route = sheet.routes[0];
    expect(startable(sheet, progressOf(save, sheet))).toEqual([sheet.start]);
    let big: number | undefined;
    for (let i = 1; i < route.spots.length; i++) big = record(save, atlas, 'ink', land(route.spots[i], route.spots[i - 1])).big ?? big;
    const end = route.spots[route.spots.length - 1], wp = progressOf(save, sheet);
    expect(big).toBe(end);
    expect(startable(sheet, wp)).toEqual([sheet.start, end]);
    expect(wp.hops.length).toBe(route.spots.length - 1);
    // 再落一次不重复记
    expect(record(save, atlas, 'ink', land(end, route.spots[route.spots.length - 2])).spot).toBeUndefined();
    expect(wp.hops.length).toBe(route.spots.length - 1);
  });

  it('探索度到了给奖励，藏着的景拿到奖励才算数', () => {
    const save = emptySave(), sheet = atlas.sheets.ink, hidden = sheet.sights.findIndex((g) => g.needs);
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(record(save, atlas, 'ink', { type: 'sight', sight: hidden }).sight).toBeUndefined();
    const got: string[] = [];
    for (const p of sheet.spots) for (const r of record(save, atlas, 'ink', land(p.id, -1)).rewards) got.push(r.id);
    sheet.sights.forEach((g, i) => { if (!g.needs) for (const r of record(save, atlas, 'ink', { type: 'sight', sight: i }).rewards) got.push(r.id); });
    expect(got).toEqual(['ink-half', 'ink-full']);
    expect(exploration(sheet, progressOf(save, sheet))).toBe(1);
    expect(record(save, atlas, 'ink', { type: 'sight', sight: hidden }).sight).toBe(hidden);
  });

  it('世界靠成对的渡口相连：到了这一头，那一头就能当起点', () => {
    expect(checkLinks(atlas)).toEqual([]);
    expect(across(atlas.links, 'fake', 6)).toEqual([{ world: 'ink', spot: 7 }]);
    const save = emptySave();
    const news = record(save, atlas, 'ink', land(7, 6));
    expect(news.ports).toEqual([{ world: 'fake', spot: 6 }]);
    expect(startable(atlas.sheets.fake, progressOf(save, atlas.sheets.fake))).toEqual([0, 6]);
    expect(checkLinks(makeAtlas([ink, fake], [{ a: { world: 'ink', spot: 1 }, b: { world: 'nowhere', spot: 0 } }])).length).toBe(2);
  });

  it('存下来再读回来是一样的；读不懂的存档当成新的', () => {
    const save = emptySave();
    record(save, atlas, 'ink', land(1, 0));
    recordBest(save, atlas.sheets.ink, 2, 9);
    save.level = 2; save.at = { world: 'ink', spot: 0 };
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    expect(parseSave('{{{')).toEqual(emptySave());
    expect(parseSave(null)).toEqual(emptySave());
    expect(parseSave('{"v":1,"worlds":{"ink":{"print":"x","spots":["a",3,-1]}}}').worlds.ink.spots).toEqual([3]);
  });

  it('布局改了，旧的进度作废', () => {
    const save = emptySave(), sheet = atlas.sheets.ink;
    record(save, atlas, 'ink', land(1, 0));
    const moved = { ...sheet, spots: sheet.spots.map((p) => (p.id === 5 ? { ...p, x: p.x + 50 } : p)) };
    expect(fingerprint(moved)).not.toBe(fingerprint(sheet));
    expect(progressOf(save, moved).spots).toEqual([moved.start]);
  });
});

describe('一张纸的检查', () => {
  it('查得出叠在一起的圈、到不了的点、没名字的大点', () => {
    const sheet = fake.layout(7);
    expect(checkSheet(sheet)).toEqual([]);
    const overlap = { ...sheet, spots: sheet.spots.map((p) => (p.id === 2 ? { ...p, y: sheet.spots[1].y + 30 } : p)) };
    expect(checkSheet(overlap).join()).toContain('叠在一起');
    expect(checkSheet({ ...sheet, edges: sheet.edges.slice(0, 3) }).join()).toContain('到不了');
    expect(checkSheet({ ...sheet, spots: sheet.spots.map((p) => ({ ...p, name: undefined })) }).join()).toContain('没有名字');
  });

  it('带种子的随机数：同一个种子同一串数，分出去的互不干扰', () => {
    const a = makeRng(42), b = makeRng(42);
    expect([a.next(), a.next(), a.gauss()]).toEqual([b.next(), b.next(), b.gauss()]);
    expect(makeRng(42).fork('x').next()).not.toBe(makeRng(42).fork('y').next());
    expect(makeRng(42).fork('x').next()).toBe(makeRng(42).fork('x').next());
  });
});
