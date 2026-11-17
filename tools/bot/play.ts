// 试玩机器人：替人把一条路跑很多遍。
//
// 它像人一样玩：落进一个圈之后先缓一下（prepMs），然后等下一个完整的时间窗，
// 瞄着窗的正中离手，但手上带着误差——离手的时刻是「正中 + 正态分布的偏差」，标准差 sigmaMs。
// 一跳没过，就回到刚落在这一跳起点的那一刻重来，这样每一跳都攒得到足够的次数；
// 整条路的通过率只数「一次都没失手」的那些趟。
//
// 这里是纯计算，种子定了结果就定了。命令行在 tools/bot.ts。

import { findWindow } from '../../src/core/aim';
import { DT } from '../../src/core/feel';
import { makeRng } from '../../src/core/rng';
import { clone, start, step, type Run } from '../../src/core/sim';
import type { Route, Sim } from '../../src/core/world';

export interface BotOpts {
  /** 跑多少趟 */
  runs: number;
  /** 离手时机的误差，毫秒（标准差） */
  sigmaMs: number;
  /** 落下之后至少缓多久才离手，毫秒 */
  prepMs: number;
  seed: number;
  /** 同一跳最多重来几次，再不过这一趟就不往下走了 */
  retries: number;
}

export const BOT_DEFAULTS: BotOpts = { runs: 400, sigmaMs: 40, prepMs: 350, seed: 1, retries: 30 };

export interface HopStat {
  from: number;
  to: number;
  tries: number;
  ok: number;
  /** 没过的几种：落到了别的圈、飞空、资源用尽 */
  strayed: number;
  missed: number;
  out: number;
  /** 找不到时间窗的次数：这一跳够不着，或者等不到窗口资源就完了 */
  noWindow: number;
  /** 时间窗平均多宽、平均等了多久才离手，毫秒 */
  windowMs: number;
  waitMs: number;
  /** 通过率 */
  pass: number;
}

export interface RouteStat {
  route: Route;
  runs: number;
  /** 一次都没失手走完整条路的趟数、比例 */
  clean: number;
  pass: number;
  hops: HopStat[];
  /** 有的跳怎么都过不去，路是断的 */
  broken: boolean;
}

type Outcome = 'ok' | 'strayed' | 'missed' | 'out';

function attempt(run: Run, from: Sim, wait: number, target: number): { s: Sim; outcome: Outcome } {
  const s = clone(from);
  for (let i = 0; i < wait; i++) {
    step(run, s, false);
    if (s.over) return { s, outcome: 'out' };
  }
  step(run, s, true);
  while (s.at < 0 && !s.over) step(run, s, false);
  if (s.over) return { s, outcome: s.over === 'out' ? 'out' : 'missed' };
  return { s, outcome: s.at === target ? 'ok' : 'strayed' };
}

export function playRoute(run: Run, route: Route, given: Partial<BotOpts> = {}): RouteStat {
  const o = { ...BOT_DEFAULTS, ...given }, rng = makeRng(o.seed).fork(route.id);
  const sigma = o.sigmaMs / 1000 / DT, skip = Math.round(o.prepMs / 1000 / DT);
  const hops: HopStat[] = [], sumWin: number[] = [], sumWait: number[] = [], planned: number[] = [];
  for (let i = 1; i < route.spots.length; i++) {
    hops.push({ from: route.spots[i - 1], to: route.spots[i], tries: 0, ok: 0, strayed: 0, missed: 0, out: 0, noWindow: 0, windowMs: 0, waitMs: 0, pass: 0 });
    sumWin.push(0); sumWait.push(0); planned.push(0);
  }
  let clean = 0;
  for (let r = 0; r < o.runs; r++) {
    let s = start(run, route.spots[0], route.spots[1]), spotless = true;
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i];
      // 起点上人是不急的，落下之后才需要缓一下
      const win = findWindow(run, s, h.to, { skip: i === 0 ? 0 : skip });
      if (!win) { h.noWindow++; spotless = false; break; }
      const mid = (win.from + win.to) / 2;
      planned[i]++; sumWin[i] += win.to - win.from + 1; sumWait[i] += mid;
      let done: Sim | null = null;
      for (let t = 0; t <= o.retries && !done; t++) {
        const res = attempt(run, s, Math.max(0, Math.round(mid + rng.gauss() * sigma)), h.to);
        h.tries++;
        if (res.outcome === 'ok') { h.ok++; done = res.s; }
        else { h[res.outcome]++; spotless = false; }
      }
      if (!done) break;
      done.events.length = 0;
      s = done;
    }
    if (spotless) clean++;
  }
  hops.forEach((h, i) => {
    h.pass = h.tries ? h.ok / h.tries : 0;
    h.windowMs = planned[i] ? (sumWin[i] / planned[i]) * DT * 1000 : 0;
    h.waitMs = planned[i] ? (sumWait[i] / planned[i]) * DT * 1000 : 0;
  });
  return { route, runs: o.runs, clean, pass: clean / o.runs, hops, broken: hops.some((h) => h.ok === 0) };
}
