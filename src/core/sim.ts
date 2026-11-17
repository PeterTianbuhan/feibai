// 运动和规则：绕圈、离手、直飞、被接住、飞空。确定性的，不碰页面，不读时钟。
// 每调一次 step 走一拍（feel.ts 的 DT）。同样的起点、同样的按键序列，永远走出同样的结果。

import { DT, FINE, ORBIT_MIN_GAP, ORBIT_SETTLE, REACH, orbitRadius, type Feel } from './feel';
import { TAU } from './rng';
import type { Env, Sheet, Sim, WorldRules } from './world';

/** 一张纸配上一档手感之后算好的东西。不变，可以很多趟共用 */
export interface Run {
  rules: WorldRules;
  feel: Feel;
  sheet: Sheet;
  env: Env;
  /** 每个点乘过档位的圈半径、绕圈半径 */
  ringR: Float64Array;
  orbitR: Float64Array;
  /** 沿建议走法相邻的点 */
  near: number[][];
  /** 落在每个点上会到的景（sheet.sights 的下标） */
  sightsAt: number[][];
  grid: Map<number, number[]>;
  cell: number;
  /** 绕一拍转多少弧度、半径收多少 */
  dAng: number;
  settle: number;
}

const cellKey = (cx: number, cy: number) => (cx * 73856093) ^ (cy * 19349663);

export function makeRun(rules: WorldRules, feel: Feel, sheet: Sheet = rules.layout(rules.seed)): Run {
  const n = sheet.spots.length;
  const ringR = new Float64Array(n), orbitR = new Float64Array(n);
  let maxR = 1;
  for (const p of sheet.spots) {
    ringR[p.id] = p.r * feel.ring;
    orbitR[p.id] = orbitRadius(ringR[p.id]);
    maxR = Math.max(maxR, ringR[p.id]);
  }
  const near: number[][] = sheet.spots.map(() => []);
  for (const [a, b] of sheet.edges) {
    if (!near[a].includes(b)) near[a].push(b);
    if (!near[b].includes(a)) near[b].push(a);
  }
  const sightsAt: number[][] = sheet.spots.map(() => []);
  sheet.sights.forEach((g, i) => {
    for (const p of sheet.spots) if (Math.hypot(p.x - g.x, p.y - g.y) <= g.reach) sightsAt[p.id].push(i);
  });
  // 找「笔尖在哪个圈里」用的格子
  const cell = maxR * 2, grid = new Map<number, number[]>();
  for (const p of sheet.spots) {
    const R = ringR[p.id];
    for (let cx = Math.floor((p.x - R) / cell); cx <= Math.floor((p.x + R) / cell); cx++) {
      for (let cy = Math.floor((p.y - R) / cell); cy <= Math.floor((p.y + R) / cell); cy++) {
        const k = cellKey(cx, cy);
        const list = grid.get(k);
        if (list) list.push(p.id); else grid.set(k, [p.id]);
      }
    }
  }
  return {
    rules, feel, sheet, env: { feel, sheet, dt: DT }, ringR, orbitR, near, sightsAt, grid, cell,
    dAng: (TAU / feel.period) * DT, settle: 1 - Math.exp(-DT * ORBIT_SETTLE),
  };
}

/**
 * 在一个点上起一趟：绕着它转，还没开始（不耗资源），第一次离手才算开始。
 * toward 给了的话，起笔的位置让笔尖转大半圈之后正好朝着那个点。
 */
export function start(run: Run, spot: number = run.sheet.start, toward?: number): Sim {
  const p = run.sheet.spots[spot];
  const next = toward !== undefined ? run.sheet.spots[toward] : run.near[spot].length ? run.sheet.spots[run.near[spot][0]] : undefined;
  const ang = next ? Math.atan2(next.y - p.y, next.x - p.x) + Math.PI * 0.9 : 0;
  const r = run.orbitR[spot];
  const s: Sim = {
    tick: 0, started: false, over: '', at: spot, left: -1,
    x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r, vx: 0, vy: 0,
    r, rT: r, ang, dir: 1, flown: 0,
    res: 1, w: undefined, seen: new Uint8Array(run.sheet.spots.length),
    score: 0, fine: 0, lastBig: p.big ? spot : -1, events: [],
  };
  s.seen[spot] = 1;
  s.w = run.rules.init(run.env);
  return s;
}

export function clone<W>(s: Sim<W>): Sim<W> {
  const w = s.w && typeof s.w === 'object' ? { ...s.w } : s.w;
  return { ...s, w, seen: s.seen.slice(), events: [] };
}

function release(run: Run, s: Sim, quiet = false) {
  const v = run.feel.speed;
  s.vx = -Math.sin(s.ang) * s.dir * v;
  s.vy = Math.cos(s.ang) * s.dir * v;
  if (!quiet) s.events.push({ type: 'release', from: s.at });
  s.left = s.at; s.at = -1; s.flown = 0;
}

function land(run: Run, s: Sim, id: number, dx: number, dy: number) {
  const p = run.sheet.spots[id], d = Math.hypot(dx, dy), R = run.ringR[id];
  // 从落点起绕，再慢慢收到这个点固定的半径上；转速不随落点变
  s.at = id;
  s.r = Math.max(d, p.core + ORBIT_MIN_GAP);
  s.rT = run.orbitR[id];
  s.ang = Math.atan2(dy, dx);
  s.dir = dx * s.vy - dy * s.vx >= 0 ? 1 : -1;
  const fresh = !s.seen[id];
  const fine = fresh && d < p.core + (R - p.core) * FINE;
  if (fresh) { s.seen[id] = 1; s.score++; if (fine) s.fine++; }
  if (p.big) s.lastBig = id;
  const hit = { type: 'land' as const, spot: id, from: s.left, fresh, fine, d, x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  s.events.push(hit);
  if (fresh) for (const g of run.sightsAt[id]) s.events.push({ type: 'sight', sight: g });
  run.rules.land?.(s, hit, p, run.env);
}

function end(run: Run, s: Sim, why: 'miss' | 'out') {
  // 资源用尽时笔自己脱手，不算一次离手
  if (s.at >= 0) release(run, s, true);
  s.over = why;
  s.events.push({ type: 'over', why });
}

/** 走一拍。press：这一拍按了键 */
export function step(run: Run, s: Sim, press: boolean): void {
  s.tick++;
  if (s.over) {
    // 结束之后笔还顺着走，只给画面收笔用，不再接、不再算
    s.x += s.vx * DT; s.y += s.vy * DT;
    return;
  }
  if (press && s.at >= 0) { s.started = true; release(run, s); }

  if (s.at >= 0) {
    const p = run.sheet.spots[s.at];
    s.ang += s.dir * run.dAng;
    s.r += (s.rT - s.r) * run.settle;
    s.x = p.x + Math.cos(s.ang) * s.r;
    s.y = p.y + Math.sin(s.ang) * s.r;
  } else {
    const rules = run.rules;
    rules.fly?.(s, run.env);
    s.x += s.vx * DT; s.y += s.vy * DT;
    s.flown += Math.sqrt(s.vx * s.vx + s.vy * s.vy) * DT;
    const list = run.grid.get(cellKey(Math.floor(s.x / run.cell), Math.floor(s.y / run.cell)));
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (id === s.left) continue;
        const p = run.sheet.spots[id], dx = s.x - p.x, dy = s.y - p.y, R = run.ringR[id];
        // 在圈里，而且已经过了离圈心最近的那一点，才接住
        if (dx * dx + dy * dy < R * R && dx * s.vx + dy * s.vy >= 0 && (!rules.canLand || rules.canLand(s, p, run.env))) {
          land(run, s, id, dx, dy);
          break;
        }
      }
    }
    if (s.at < 0 && s.flown > REACH) { end(run, s, 'miss'); return; }
  }

  if (s.started) {
    run.rules.tick?.(s, run.env);
    if (s.res > 1) s.res = 1;
    if (s.res <= 0) { s.res = 0; end(run, s, 'out'); }
  }
}
