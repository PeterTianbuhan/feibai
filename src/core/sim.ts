// 运动和规则：绕圈、离手、直飞、被接住、飞空。确定性的，不碰页面，不读时钟。
// 每调一次 step 走一拍（feel.ts 的 DT）。同样的起点、同样的按键序列，永远走出同样的结果。

import { DT, FINE, ORBIT_MIN_GAP, ORBIT_SETTLE, REACH, orbitRadius, type Feel } from './feel';
import { TAU } from './rng';
import type { Env, Sheet, Sim, WorldRules } from './world';

export interface StartOpts {
  /** 起笔的位置让笔尖转大半圈之后正好朝着这个点 */
  toward?: number;
  /** 这一趟之前就到过的点（存档里的） */
  known?: Iterable<number>;
}

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
  /** 一程最多飞多远 */
  reach: number;
  /** 飞行是不是一条匀速的直线（世界没有 fly 钩子）。是的话，试飞可以提前知道够不着 */
  straight: boolean;
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
  const run: Run = {
    rules, feel, sheet, env: undefined as unknown as Env, ringR, orbitR, near, sightsAt, grid, cell,
    dAng: (TAU / feel.period) * DT, settle: 1 - Math.exp(-DT * ORBIT_SETTLE),
    reach: rules.reach ?? REACH, straight: !rules.fly,
  };
  run.env = {
    feel, sheet, dt: DT,
    ringAt: (x, y, skip = -1) => ringAt(run, x, y, skip),
    land: (s, spot) => { const p = sheet.spots[spot]; land(run, s, spot, s.x - p.x, s.y - p.y); },
    put: (s, spot) => put(run, s, spot),
    visit: (s, spot) => visit(run, s, spot),
    sight: (s, sight) => { s.events.push({ type: 'sight', sight }); },
    mark: (s, id) => { s.events.push({ type: 'mark', id }); },
    end: (s, why) => end(run, s, why),
  };
  return run;
}

function ringAt(run: Run, x: number, y: number, skip: number): number {
  const list = run.grid.get(cellKey(Math.floor(x / run.cell), Math.floor(y / run.cell)));
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (id === skip) continue;
      const p = run.sheet.spots[id], dx = x - p.x, dy = y - p.y, R = run.ringR[id];
      if (dx * dx + dy * dy < R * R) return id;
    }
  }
  return -1;
}

/**
 * 在一个点上起一趟：绕着它转，还没开始（不耗资源），第一次离手才算开始。
 */
export function start(run: Run, spot: number = run.sheet.start, opts: StartOpts = {}): Sim {
  const p = run.sheet.spots[spot], n = run.sheet.spots.length;
  const next = opts.toward !== undefined ? run.sheet.spots[opts.toward] : run.near[spot].length ? run.sheet.spots[run.near[spot][0]] : undefined;
  const ang = next ? Math.atan2(next.y - p.y, next.x - p.x) + Math.PI * 0.9 : 0;
  const r = run.orbitR[spot], known = new Uint8Array(n);
  if (opts.known) for (const id of opts.known) if (id >= 0 && id < n) known[id] = 1;
  const s: Sim = {
    tick: 0, started: false, over: '', at: spot, left: -1,
    x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r, vx: 0, vy: 0,
    r, rT: r, ang, dir: 1, flown: 0,
    res: 1, w: undefined, seen: new Uint8Array(n), known,
    score: 0, fine: 0, lastBig: p.big ? spot : -1, events: [],
  };
  s.seen[spot] = 1;
  s.w = run.rules.init(run.env);
  return s;
}

/** 拷一份互不相干的。known 一趟里不变，共用 */
export function clone<W>(run: Run, s: Sim<W>): Sim<W> {
  const w = run.rules.clone ? run.rules.clone(s.w) : s.w && typeof s.w === 'object' ? { ...s.w } : s.w;
  return { ...s, w, seen: s.seen.slice(), events: [] };
}

function release(run: Run, s: Sim, quiet = false) {
  const v = run.feel.speed, from = s.at;
  s.vx = -Math.sin(s.ang) * s.dir * v;
  s.vy = Math.cos(s.ang) * s.dir * v;
  s.left = from; s.at = -1; s.flown = 0;
  if (quiet) return;
  s.events.push({ type: 'release', from });
  run.rules.leave?.(s, run.sheet.spots[from], run.env);
}

function land(run: Run, s: Sim, id: number, dx: number, dy: number) {
  const p = run.sheet.spots[id], d = Math.hypot(dx, dy), R = run.ringR[id], rules = run.rules;
  // 从落点起绕，再慢慢收到这个点固定的半径上；转速不随落点变
  s.at = id;
  s.r = Math.max(d, p.core + ORBIT_MIN_GAP);
  s.rT = run.orbitR[id];
  s.ang = Math.atan2(dy, dx);
  s.dir = dx * s.vy - dy * s.vx >= 0 ? 1 : -1;
  const fresh = !s.seen[id];
  const fine = fresh && (rules.fine ? rules.fine(s, p, d, run.env) : d < p.core + (R - p.core) * FINE);
  if (fresh) { s.seen[id] = 1; s.score++; if (fine) s.fine++; }
  if (p.big) s.lastBig = id;
  const hit = { type: 'land' as const, spot: id, from: s.left, fresh, fine, d, x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  s.events.push(hit);
  if (fresh) for (const g of run.sightsAt[id]) s.events.push({ type: 'sight', sight: g });
  rules.land?.(s, hit, p, run.env);
}

function put(run: Run, s: Sim, id: number) {
  const p = run.sheet.spots[id];
  s.at = id; s.left = -1; s.flown = 0;
  s.r = s.rT = run.orbitR[id];
  s.x = p.x + Math.cos(s.ang) * s.r; s.y = p.y + Math.sin(s.ang) * s.r;
  if (p.big) s.lastBig = id;
  s.events.push({ type: 'put', spot: id });
}

function visit(run: Run, s: Sim, id: number) {
  if (s.seen[id]) return;
  s.seen[id] = 1; s.score++;
  s.events.push({ type: 'visit', spot: id });
  for (const g of run.sightsAt[id]) s.events.push({ type: 'sight', sight: g });
}

function end(run: Run, s: Sim, why: 'miss' | 'out') {
  if (s.over) return;
  // 世界可以接手：比如把笔送回上一个大点，这一趟接着走
  if (run.rules.lost?.(s, why, run.env)) return;
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
  const rules = run.rules;
  if (press && s.at >= 0) { s.started = true; release(run, s); }

  if (s.at >= 0) {
    const p = run.sheet.spots[s.at];
    s.ang += s.dir * run.dAng;
    s.r += (s.rT - s.r) * run.settle;
    s.x = p.x + Math.cos(s.ang) * s.r;
    s.y = p.y + Math.sin(s.ang) * s.r;
  } else {
    if (rules.fly) rules.fly(s, run.env);
    // 钩子可能已经让笔落下，或者结束了这一趟
    if (s.at < 0 && !s.over) {
      s.x += s.vx * DT; s.y += s.vy * DT;
      s.flown += Math.sqrt(s.vx * s.vx + s.vy * s.vy) * DT;
      const list = run.grid.get(cellKey(Math.floor(s.x / run.cell), Math.floor(s.y / run.cell)));
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const id = list[i];
          if (id === s.left) continue;
          const p = run.sheet.spots[id], dx = s.x - p.x, dy = s.y - p.y, R = run.ringR[id], dd = dx * dx + dy * dy;
          // 在圈里，而且已经过了离圈心最近的那一点，才接住
          if (dd < R * R && dx * s.vx + dy * s.vy >= 0 && (!rules.canLand || rules.canLand(s, p, Math.sqrt(dd), run.env))) {
            land(run, s, id, dx, dy);
            break;
          }
        }
      }
      if (s.at < 0 && s.flown > run.reach) end(run, s, 'miss');
    }
  }

  if (s.started && !s.over) {
    if (rules.tick) rules.tick(s, run.env);
    if (s.res > 1) s.res = 1;
    if (s.res <= 0) {
      s.res = 0;
      if (rules.resource.endsAtZero !== false) end(run, s, 'out');
    }
  }
}
