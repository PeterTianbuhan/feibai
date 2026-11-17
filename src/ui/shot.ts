// 截图模式：?shot=<时刻>。不等人按，也不跟着屏幕刷新，按固定的步子把游戏推到某个时刻，
// 画一帧，然后在 <html> 上标 data-shot="ready"，tools/shots.ts 看到就截。
// 同一个时刻每次推出来的画面一样（规则是确定的，画面上的随机也带种子），前后两次的截图可以直接比。
//
// 时刻：
//   title  标题页，笔尖绕着起点画完一圈
//   play   途中：走了几跳，正飞向下一个圈
//   sight  到达一处景：第一次见到一处景，景已经洇出来
//   end    结束那幅画：走了几跳之后飞空，题款和印都落好了。
//          飞空了不结束的世界（被送回大点，接着走）截的是刚被送回去的样子
//   map    地图：走完上面那一趟之后打开地图（不结束的世界从「地图」那个小字收笔过去）

import { findWindow, flyOut } from '../core/aim';
import { TICKS } from '../core/feel';
import { clone, step } from '../core/sim';
import type { Route, Sim } from '../core/world';
import type { App } from './app';

export const SHOTS = ['title', 'play', 'sight', 'end', 'map'] as const;

const FPS = 60;

/** 现在离手是不是哪儿都落不到：飞空，或者飞空之后被世界送回了大点 */
function misses(app: App, sim: Sim): boolean {
  const p = clone(app.run, sim);
  return flyOut(app.run, p) < 0 || p.events.some((e) => e.type === 'put');
}

/** 替人走一条路：每次落下后等第一个时间窗，在窗的正中离手。走满 hops 跳之后故意飞空。返回的 missed：故意飞空的那一下按了没有 */
function follow(app: App, route: Route, hops: number): { missed: boolean } {
  let next = 1, pressAt = -1;
  const state = { missed: false };
  app.pilot = (sim: Sim) => {
    if (sim.at < 0 || sim.over) return false;
    if (pressAt < 0) {
      if (next <= hops && next < route.spots.length) {
        const win = findWindow(app.run, sim, route.spots[next], { skip: next === 1 ? TICKS : Math.round(TICKS * 0.35) });
        if (!win) throw new Error(`第 ${next} 跳找不到时间窗`);
        pressAt = sim.tick + Math.round((win.from + win.to) / 2);
      } else {
        // 找一个离手之后哪儿都落不到的时刻
        const probe = clone(app.run, sim);
        for (let k = 0; k < TICKS * 6; k++) {
          if (k > TICKS * 0.5 && misses(app, probe)) { pressAt = sim.tick + k; break; }
          step(app.run, probe, false);
          if (probe.over) break;
        }
        if (pressAt < 0) pressAt = Infinity; // 找不到就等资源用尽
      }
    }
    if (sim.tick < pressAt) return false;
    if (next > hops || next >= route.spots.length) state.missed = true;
    pressAt = -1; next++;
    return true;
  };
  return state;
}

export async function runShot(app: App, shot: string, params: URLSearchParams) {
  const root = document.documentElement;
  const frames = (sec: number) => { for (let i = 0; i < Math.round(sec * FPS); i++) app.frame(1 / FPS); };
  /** 一帧一帧推，直到 ok；太久没等到就算失败 */
  const until = (ok: () => boolean, what: string) => {
    for (let i = 0; i < FPS * 120; i++) {
      if (ok()) return;
      app.frame(1 / FPS);
    }
    throw new Error('等不到：' + what);
  };
  try {
    await document.fonts.ready;
    const sheet = app.run.sheet;
    const fromStart = sheet.routes.filter((r) => r.spots[0] === app.startSpot).sort((a, b) => b.spots.length - a.spots.length);
    const want = params.get('route');
    // 没指定的话，挑从起点出发、路上最早有景的那条；都没有景就挑最长的
    const firstSight = (r: Route) => { const i = r.spots.findIndex((id, k) => k > 0 && app.run.sightsAt[id].some((g) => !sheet.sights[g].needs)); return i < 0 ? Infinity : i; };
    const route = (want && sheet.routes.find((r) => r.id === want)) || [...fromStart].sort((a, b) => firstSight(a) - firstSight(b))[0];
    if (!route) throw new Error('这个世界没有从起点出发的路');
    const hops = Math.min(+(params.get('hops') ?? 5), route.spots.length - 2);

    if (shot === 'title') frames(2.7);
    else if (shot === 'play') {
      follow(app, route, route.spots.length);
      until(() => app.sim.score >= hops, `走满 ${hops} 跳`);
      until(() => app.sim.at < 0, '离手');
      frames(0.3);
    } else if (shot === 'sight') {
      let seen = false;
      app.onNews = (n) => { if (n.sight !== undefined) seen = true; };
      follow(app, route, route.spots.length);
      until(() => seen || app.mode === 'end', '见到一处景');
      if (!seen) throw new Error(`路「${route.name}」上没有景`);
      frames(2.6);
    } else if (shot === 'end' || shot === 'map') {
      const pilot = follow(app, route, hops + 1);
      until(() => app.mode === 'end' || (pilot.missed && app.sim.at >= 0), '这一趟结束');
      if (app.mode === 'end') {
        frames(3.4);
        if (shot === 'map') { app.pilot = null; app.openMap(); frames(0.3); }
      } else {
        // 飞空了不结束的世界：笔已经被送回大点。没有结束那幅画，去地图走「地图」那个小字
        app.pilot = null;
        frames(1.2);
        if (shot === 'map') { app.quit(); frames(0.3); }
      }
    } else throw new Error(`没有 ${shot} 这个时刻。有：${SHOTS.join('、')}`);
    root.dataset.shot = 'ready';
  } catch (e) {
    root.dataset.shot = 'failed';
    root.dataset.shotError = String(e instanceof Error ? e.message : e);
    console.error(e);
  }
}
