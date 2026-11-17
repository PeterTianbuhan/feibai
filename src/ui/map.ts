// 地图，最简版：玩家自己走出来的那幅画。到过的点、走过的跳、见过的景画出来，没到过的是空白。
// 到过的大点标着名字，点一下就从那里起笔。各个世界共用这一个画法，颜色和字体跟世界走。
// 以后要做得更像各个世界自己的画，在这里加，或者让世界的画法接手。

import { hopEnds, startable, type WorldProgress } from '../core/progress';
import { TAU } from '../core/rng';
import type { Sheet } from '../core/world';
import type { Theme, View } from './look';

export interface MapPick {
  spot: number;
  /** 屏幕上的位置 */
  x: number;
  y: number;
}

export interface MapScene {
  view: View;
  sheet: Sheet;
  progress: WorldProgress;
  theme: Theme;
  /** 现在的起点 */
  here: number;
  time: number;
}

/** 画地图（底已经由世界的画法铺好）。返回能点的大点 */
export function drawMap(ctx: CanvasRenderingContext2D, m: MapScene): MapPick[] {
  const { W, H } = m.view, { sheet, progress: wp, theme } = m;
  // 镜头框住走过的地方，四周多留一圈空白：看得出外面还有没走的，走过的又不至于小得看不清
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of wp.spots) {
    const p = sheet.spots[id];
    if (!p) continue;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  if (x0 > x1) { x0 = x1 = sheet.spots[sheet.start].x; y0 = y1 = sheet.spots[sheet.start].y; }
  const spanX = Math.max(1100, (x1 - x0) * 1.5 + 500), spanY = Math.max(1100, (y1 - y0) * 1.5 + 500);
  const z = Math.min((W * 0.86) / spanX, (H * 0.74) / spanY);
  const ox = W / 2 - ((x0 + x1) / 2) * z, oy = H / 2 - ((y0 + y1) / 2) * z;
  const sx = (x: number) => x * z + ox, sy = (y: number) => y * z + oy;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = theme.line; ctx.fillStyle = theme.line;
  // 走过的跳
  ctx.globalAlpha = 0.72; ctx.lineWidth = Math.max(1.6, 9 * z);
  for (const k of wp.hops) {
    const [a, b] = hopEnds(k), p = sheet.spots[a], q = sheet.spots[b];
    if (!p || !q) continue;
    ctx.beginPath(); ctx.moveTo(sx(p.x), sy(p.y)); ctx.lineTo(sx(q.x), sy(q.y)); ctx.stroke();
  }
  // 到过的点
  ctx.globalAlpha = 0.9;
  for (const id of wp.spots) {
    const p = sheet.spots[id];
    if (!p) continue;
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), Math.max(1.8, p.core * z * 1.5), 0, TAU); ctx.fill();
  }
  // 见过的景：只题个名字
  const fs = Math.max(11, Math.min(15, Math.min(W, H) * 0.022));
  ctx.font = `${fs}px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.5;
  for (const g of sheet.sights) {
    if (!wp.sights.includes(g.id)) continue;
    ctx.fillText(g.name, sx(g.x), sy(g.y));
  }
  // 能当起点的大点：一个圈，旁边竖着名字；现在的起点点一块点睛色
  const picks: MapPick[] = [];
  for (const id of startable(sheet, wp)) {
    const p = sheet.spots[id], x = sx(p.x), y = sy(p.y), r = Math.max(6, (p.core + 8) * z * 1.5);
    picks.push({ spot: id, x, y });
    ctx.globalAlpha = 0.8; ctx.lineWidth = 1.2; ctx.strokeStyle = theme.line;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    if (id === m.here) {
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(m.time * 3);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x - r - fs * 0.9, y - fs * 0.3, fs * 0.6, fs * 0.6);
      ctx.fillStyle = theme.line;
    }
    ctx.globalAlpha = 0.85;
    let ty = y - ((p.name?.length ?? 0) - 1) * fs * 0.6;
    for (const ch of p.name ?? '') { ctx.fillText(ch, x + r + fs * 0.9, ty); ty += fs * 1.2; }
  }
  ctx.restore();
  return picks;
}
