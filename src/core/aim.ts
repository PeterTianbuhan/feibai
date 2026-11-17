// 离手的时间窗：绕着一个点转的时候，哪几拍离手能落进目标的圈。
// 一跳难不难就看这个窗有多宽。布局用它量难度，机器人用它瞄准。
// 不解方程，直接拿规则往前试，所以有风、会拐弯、会弹回来的世界也照样能量。

import { DT } from './feel';
import { clone, start, step, type Run } from './sim';
import type { Sim } from './world';

export interface Window {
  /** 从现在起再过几拍离手，from 到 to（都算在内）都能落进目标 */
  from: number;
  to: number;
}

/** 试一次：现在离手，会落到哪。返回落进的点的 id，飞空或资源用尽是 -1。会改动 p，传副本进来 */
export function flyOut(run: Run, p: Sim, target = -1): number {
  step(run, p, true);
  // 飞的是匀速直线的话，剩下的路程够不着目标就不用再飞。有环境机制的世界不能这么猜，老老实实飞完
  const t = target >= 0 && run.straight ? run.sheet.spots[target] : null, R = t ? run.ringR[target] : 0;
  while (p.at < 0 && !p.over) {
    step(run, p, false);
    if (t && p.at < 0) {
      const dx = p.x - t.x, dy = p.y - t.y, far = run.reach - p.flown + R;
      if (dx * dx + dy * dy > far * far) return -1;
    }
  }
  return p.over ? -1 : p.at;
}

export interface AimOpts {
  /** 落下之后至少过这么多拍才离手（人要重新瞄） */
  skip?: number;
  /** 最多往后找多少拍，默认两圈半 */
  horizon?: number;
  /** 最多找几个窗，默认 1 */
  max?: number;
}

/**
 * 找 skip 之后的完整时间窗，按先后排。s 要正绕着一个点。一个都没有：
 * 要么这一跳根本够不着，要么等不到窗口这一趟就结束了。
 * 时隐时现的点可以用 max 多找几个，看一跳有几次能落的机会。
 */
export function findWindows(run: Run, s: Sim, target: number, opts: AimOpts = {}): Window[] {
  if (s.at < 0 || s.over) return [];
  const skip = opts.skip ?? 0, horizon = opts.horizon ?? Math.ceil((run.feel.period * 2.5) / DT) + skip, max = opts.max ?? 1;
  // 先隔几拍试一次；窄到漏掉了，再一拍一拍找
  const coarse = scan(run, s, target, skip, horizon, 6, max);
  return coarse.length ? coarse : scan(run, s, target, skip, horizon, 1, max);
}

/** skip 之后第一个完整的时间窗，没有是 null */
export function findWindow(run: Run, s: Sim, target: number, opts: AimOpts = {}): Window | null {
  return findWindows(run, s, target, { ...opts, max: 1 })[0] ?? null;
}

function scan(run: Run, s: Sim, target: number, skip: number, horizon: number, stride: number, max: number): Window[] {
  const base = clone(run, s), found: Window[] = [];
  const hitAt = (from: Sim, more: number) => {
    const p = clone(run, from);
    for (let i = 0; i < more && !p.over && p.at === s.at; i++) step(run, p, false);
    return !p.over && p.at === s.at && flyOut(run, p, target) === target;
  };
  for (let k = 0; k < skip && !base.over; k++) step(run, base, false);
  if (base.over || base.at !== s.at) return found;
  // 每隔 stride 拍试一次；两次结果不一样，窗的边就在中间，再一拍一拍找
  let prev = clone(run, base), prevK = skip, prevHit = hitAt(base, 0);
  let open = -1, inside = prevHit; // inside：一上来就在窗里，这个窗不完整，等下一个
  for (let k = skip + stride; k <= horizon; k += stride) {
    for (let i = 0; i < stride; i++) step(run, base, false);
    // 等着等着这一趟结束了，或者世界把笔挪走了
    if (base.over || base.at !== s.at) break;
    const hit = hitAt(base, 0);
    if (hit !== prevHit) {
      let edge = k; // 第一个和 hit 结果相同的拍
      for (let j = 1; j < stride; j++) if (hitAt(prev, j) === hit) { edge = prevK + j; break; }
      if (hit && !inside) open = edge;
      else if (!hit && inside) inside = false;
      else if (!hit && open >= 0) {
        found.push({ from: open, to: edge - 1 });
        open = -1;
        if (found.length >= max) break;
      }
    }
    prev = clone(run, base); prevK = k; prevHit = hit;
  }
  return found;
}

/**
 * 量一跳：从 a 稳稳绕着（半径已经收好）的时候，落进 b 的时间窗有多少毫秒。0 是够不着。
 * 两个转向里取窄的那个，因为玩家从哪个方向落下来是不一定的。
 */
export function hopWindowMs(run: Run, a: number, b: number): number {
  let worst = Infinity;
  for (const dir of [1, -1]) {
    const s = start(run, a, { toward: b });
    s.dir = dir;
    const w = findWindow(run, s, b);
    worst = Math.min(worst, w ? (w.to - w.from + 1) * DT * 1000 : 0);
  }
  return worst;
}

/**
 * 现在离手的话笔会怎么走：按这个世界的规则往前走，每 every 拍记一个位置。
 * 画法用它画「去向」的虚线，会拐弯、会弹回来的世界画出来的就是弯的、折的。
 * 返回 [x0, y0, x1, y1, …]，最多走 dist 这么远，落下或结束就停。
 */
export function trace(run: Run, s: Sim, dist: number, every = 6): number[] {
  const pts: number[] = [];
  if (s.at < 0 || s.over) return pts;
  const p = clone(run, s);
  step(run, p, true);
  for (let i = 1; p.at < 0 && !p.over && p.flown < dist; i++) {
    step(run, p, false);
    if (i % every === 0) pts.push(p.x, p.y);
  }
  return pts;
}
