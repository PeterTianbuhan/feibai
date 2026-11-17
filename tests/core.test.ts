import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWindow, findWindows, flyOut, hopWindowMs, trace } from '../src/core/aim';
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
import { BELL, GHOST, SIGHT, WALL_Y, ghostOn, odd } from './fake/odd';
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
    const s = start(run, route.spots[0], { toward: route.spots[1] });
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
      const s = start(run, a, { toward: b });
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
      const s = start(run, a, { toward: b }), hit = hopTo(run, s, b, pick)!;
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
    for (; k < TICKS * 4; k++) { if (flyOut(run, clone(run, s)) < 0) break; step(run, s, false); }
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
    const run = makeRun(ink, MID), s = start(run), c = clone(run, s);
    for (let i = 0; i < 500; i++) step(run, c, i === 100);
    expect(s.tick).toBe(0);
    expect(s.seen.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s.w.grace).toBe(0);
  });

  it('时间窗说得准：窗里离手落得进，窗外一拍就落不进', () => {
    const run = makeRun(ink, LEVELS[2]), [a, b] = run.sheet.routes[0].spots;
    const s = start(run, a, { toward: b }), w = findWindow(run, s, b)!;
    const lands = (k: number) => { const c = clone(run, s); return hop(run, c, k)?.spot === b; };
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
    const run = makeRun(fake, MID), s = start(run, 0, { toward: 1 });
    const w = findWindow(run, s, 1)!;
    const c = clone(run, s);
    for (let i = 0; i < Math.round((w.from + w.to) / 2); i++) step(run, c, false);
    step(run, c, true);
    const vx0 = c.vx, flight = c.tick;
    while (c.at < 0 && !c.over) step(run, c, false);
    expect(c.at).toBe(1);
    expect(c.vx - vx0).toBeCloseTo(WIND * (c.tick - flight) * DT, 6);
    // 同一个时刻离手，没有风的话落不到同一个地方
    const calm = makeRun({ ...fake, fly: undefined }, MID), d = clone(calm, s);
    for (let i = 0; i < Math.round((w.from + w.to) / 2); i++) step(calm, d, false);
    step(calm, d, true);
    while (d.at < 0 && !d.over) step(calm, d, false);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThan(20);
  });

  it('资源按它自己的规矩耗和补：绕着不耗，飞着耗，落到泉上补满', () => {
    const run = makeRun(fake, MID), s = start(run, 0, { toward: 1 });
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

describe('怪世界：底座给世界的每一种能力', () => {
  const run = makeRun(odd, MID);
  /** 找一个离手之后哪儿都落不到的时刻 */
  const missFrom = (s: Sim) => {
    for (let k = 0; k < TICKS * 4; k++) { if (flyOut(run, clone(run, s)) !== 1 && flyOut(run, clone(run, s)) !== BELL) break; step(run, s, false); }
  };

  it('合格', () => {
    expect(checkWorld(odd)).toEqual([]);
    expect(run.reach).toBe(700);
    expect(run.env.ringAt(270, 10)).toBe(1);
    expect(run.env.ringAt(270, 10, 1)).toBe(-1);
    expect(run.env.ringAt(400, 300)).toBe(-1);
  });

  it('离手扣资源；用尽了不马上结束，由世界决定什么时候结束', () => {
    const s = start(run, 0, { toward: 1 });
    hopTo(run, s, 1);
    expect(s.res).toBe(0.75);
    s.res = 0.25;
    hopTo(run, s, 2); // 这一下扣到 0，飞着的时候不结束，落到大点上补满
    expect(s.over).toBe('');
    expect(s.res).toBe(1);

    const t = start(run, 0, { toward: 1 });
    hopTo(run, t, 1);
    t.res = 0;
    step(run, t, false); // 没格了还停在小点上
    expect(t.over).toBe('out');
  });

  it('飞空了世界可以接手：送回上一个大点，这一趟接着走，笔迹要断开', () => {
    const s = start(run, 0, { toward: 1 });
    hopTo(run, s, 1); hopTo(run, s, 2);
    expect(s.lastBig).toBe(2);
    // 往没有点的方向离手
    while (flyOut(run, clone(run, s)) !== 2 || s.tick % 7) step(run, s, false);
    s.events.length = 0;
    step(run, s, true);
    while (s.at < 0 && !s.over) step(run, s, false);
    expect(s.over).toBe('');
    expect(s.at).toBe(2);
    expect(s.events.some((e) => e.type === 'put' && e.spot === 2)).toBe(true);
    expect(s.events.some((e) => e.type === 'over')).toBe(false);
    expect(s.res).toBe(1);
    expect(Math.hypot(s.x - 540, s.y)).toBeCloseTo(run.orbitR[2], 6);
  });

  it('路过就把别的点记成到过，留一个长久的记号，进度里都记下', () => {
    const s = start(run, 0, { toward: 1 }), atlas = makeAtlas([odd]), save = emptySave();
    hopTo(run, s, 1);
    expect(s.seen[BELL]).toBe(1);
    expect(s.score).toBe(2); // 落了一个，路过一个
    const news = s.events.map((e) => record(save, atlas, 'odd', e));
    const wp = progressOf(save, atlas.sheets.odd);
    expect(wp.spots).toContain(BELL);
    expect(wp.marks).toEqual(['bell']);
    expect(news.some((n) => n.mark === 'bell')).toBe(true);
    expect(wp.hops.length).toBe(1); // 路过不算一跳
    expect(parseSave(JSON.stringify(save)).worlds.odd.marks).toEqual(['bell']);
  });

  it('「妙」算不算由世界说了算', () => {
    const s = start(run, 0, { toward: 1 }), hit = hopTo(run, s, 1)!;
    expect(hit.d).toBeLessThan(30);
    expect(hit.fine).toBe(false); // 这个点是 flat 的，落得再准也不算
    expect(hopTo(run, s, 2)!.fine).toBe(true);
  });

  it('状态里有数组也拷得开', () => {
    const s = start(run, 0, { toward: 1 });
    hopTo(run, s, 1);
    const c = clone(run, s);
    hopTo(run, c, 2);
    expect(s.w.path).toEqual([1]);
    expect(c.w.path).toEqual([1, 2]);
  });

  it('时隐时现的圈：在的时候才接；一跳有几次机会数得出来', () => {
    const s = start(run, 0, { toward: 1 });
    hopTo(run, s, 1); hopTo(run, s, 2);
    const far = { max: 99, horizon: TICKS * MID.period * 9 };
    const wins = findWindows(run, s, GHOST, far);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    // 窗里离手，落下那一拍它正好在
    for (const w of wins) {
      const c = clone(run, s), hit = hop(run, c, w.from)!;
      expect(hit.spot).toBe(GHOST);
      expect(ghostOn(c.tick, MID.period)).toBe(true);
    }
    // 它一直在的话，能落的时间更多
    const solid = makeRun({ ...odd, canLand: undefined }, MID);
    const width = (ws: { from: number; to: number }[]) => ws.reduce((a, w) => a + w.to - w.from + 1, 0);
    expect(width(findWindows(solid, s, GHOST, far))).toBeGreaterThan(width(wins) * 1.3);
  });

  it('撞墙弹回：去向的虚线是按规则走出来的，画出来会折', () => {
    const s = start(run, 0);
    // 转到笔尖朝下（y 变大的方向）
    while (!(Math.cos(s.ang) * s.dir > 0.99)) step(run, s, false);
    const pts = trace(run, s, 600, 2), ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(WALL_Y);
    const peak = ys.indexOf(Math.max(...ys));
    expect(peak).toBeGreaterThan(0);
    expect(ys[ys.length - 1]).toBeLessThan(ys[peak] - 100); // 先往下，撞了墙往回
    missFrom(s);
  });

  it('机器人只瞄看得见的点', () => {
    const s = start(run, 0);
    expect(odd.canSee!(s, run.sheet.spots[1], run.env)).toBe(true);
    expect(odd.canSee!(s, run.sheet.spots[GHOST], run.env)).toBe(false);
    expect(Math.hypot(run.sheet.spots[GHOST].x - s.x, run.sheet.spots[GHOST].y - s.y)).toBeGreaterThan(SIGHT);
    const stat = playRoute(run, { id: 'far', name: '看不见的', spots: [0, GHOST] }, { runs: 5 });
    expect(stat.hops[0].blind).toBe(5);
    expect(stat.broken).toBe(true);
    expect(playRoute(run, run.sheet.routes[0], { runs: 30 }).broken).toBe(false);
  });

  it('存档里到过的点，规则看得到', () => {
    const s = start(run, 0, { known: [0, 2, 99] });
    expect([...s.known]).toEqual([1, 0, 1, 0, 0]);
    expect(clone(run, s).known).toBe(s.known);
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
