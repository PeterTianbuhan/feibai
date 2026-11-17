// 进度：到过哪些点、走过哪些跳、见过哪些景、拿了哪些奖励。
// 这里只管数据怎么记、怎么算，存进浏览器是 src/ui/store.ts 的事。
// 进度不分难度档：地图是同一张，慢档走到的大点，快档也能从那儿起。

import { across, type Atlas } from './atlas';
import { fingerprint } from './sheet';
import type { Reward, Sheet, SimEvent } from './world';

export interface WorldProgress {
  /** 记进度时那张纸的指纹，布局改了就对不上 */
  print: string;
  /** 到过的点 */
  spots: number[];
  /** 走过的跳，从哪个点落到哪个点，各存一次：小的 id * 65536 + 大的 id */
  hops: number[];
  /** 见过的景 */
  sights: string[];
  /** 拿到的奖励 */
  rewards: string[];
  /** 世界要长久记住的事（绣出的图样、剪出的花），世界自己起名字 */
  marks: string[];
  /** 每一档最多一趟落了几个点 */
  best: number[];
}

export interface Save {
  v: 1;
  /** 上次选的难度档 */
  level: number;
  /** 下一趟从哪起 */
  at: { world: string; spot: number } | null;
  worlds: Record<string, WorldProgress>;
}

export const emptySave = (): Save => ({ v: 1, level: 1, at: null, worlds: {} });

const freshWorld = (sheet: Sheet): WorldProgress => ({
  print: fingerprint(sheet), spots: [sheet.start], hops: [], sights: [], rewards: [], marks: [], best: [],
});

/** 这个世界的进度。没有，或者布局已经变了，就给一份新的 */
export function progressOf(save: Save, sheet: Sheet): WorldProgress {
  const wp = save.worlds[sheet.world];
  if (wp && wp.print === fingerprint(sheet)) return wp;
  return (save.worlds[sheet.world] = freshWorld(sheet));
}

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x) => Number.isInteger(x) && x >= 0) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** 从存下来的文字读回进度。读不懂的部分丢掉，不报错 */
export function parseSave(text: string | null): Save {
  const save = emptySave();
  if (!text) return save;
  try {
    const raw = JSON.parse(text);
    if (!raw || raw.v !== 1) return save;
    if (Number.isInteger(raw.level)) save.level = raw.level;
    if (raw.at && typeof raw.at.world === 'string' && Number.isInteger(raw.at.spot)) save.at = { world: raw.at.world, spot: raw.at.spot };
    for (const [id, w] of Object.entries<any>(raw.worlds ?? {})) {
      if (!w || typeof w.print !== 'string') continue;
      save.worlds[id] = { print: w.print, spots: nums(w.spots), hops: nums(w.hops), sights: strs(w.sights), rewards: strs(w.rewards), marks: strs(w.marks), best: nums(w.best) };
    }
  } catch {
    return emptySave();
  }
  return save;
}

export const hopKey = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
export const hopEnds = (k: number): [number, number] => [Math.floor(k / 65536), k % 65536];

/**
 * 探索度：到过的点和见过的景，占这张纸上全部的多少。
 * 藏起来的景（要奖励才出现的）不算在分母里，免得还没出现就拖着探索度。
 */
export function exploration(sheet: Sheet, wp: WorldProgress): number {
  const open = sheet.sights.filter((g) => !g.needs).map((g) => g.id);
  const total = sheet.spots.length + open.length;
  const got = wp.spots.length + wp.sights.filter((id) => open.includes(id)).length;
  return total ? Math.min(1, got / total) : 0;
}

/** 能当起点的点：这张纸的起点，加上到过的大点 */
export function startable(sheet: Sheet, wp: WorldProgress): number[] {
  const out = [sheet.start];
  for (const id of wp.spots) if (id !== sheet.start && sheet.spots[id]?.big) out.push(id);
  return out;
}

/** 这次记下了什么新的 */
export interface News {
  spot?: number;
  big?: number;
  sight?: number;
  mark?: string;
  rewards: Reward[];
  /** 新通的渡口对岸 */
  ports: { world: string; spot: number }[];
}

/** 把一趟里发生的一件事记进进度。返回新到的、新得的 */
export function record(save: Save, atlas: Atlas, world: string, ev: SimEvent): News {
  const sheet = atlas.sheets[world], wp = progressOf(save, sheet);
  const news: News = { rewards: [], ports: [] };
  if (ev.type === 'land' || ev.type === 'visit') {
    if (!wp.spots.includes(ev.spot)) {
      wp.spots.push(ev.spot);
      news.spot = ev.spot;
      if (sheet.spots[ev.spot].big) news.big = ev.spot;
    }
    if (ev.type === 'land' && ev.from >= 0 && ev.from !== ev.spot) {
      const k = hopKey(ev.from, ev.spot);
      if (!wp.hops.includes(k)) wp.hops.push(k);
    }
    for (const far of across(atlas.links, world, ev.spot)) {
      const other = atlas.sheets[far.world];
      if (!other) continue;
      const fp = progressOf(save, other);
      if (!fp.spots.includes(far.spot)) { fp.spots.push(far.spot); news.ports.push(far); }
    }
  } else if (ev.type === 'sight') {
    const g = sheet.sights[ev.sight];
    if (g.needs && !wp.rewards.includes(g.needs)) return news;
    if (!wp.sights.includes(g.id)) { wp.sights.push(g.id); news.sight = ev.sight; }
  } else if (ev.type === 'mark') {
    if (!wp.marks.includes(ev.id)) { wp.marks.push(ev.id); news.mark = ev.id; }
    return news;
  } else return news;

  const got = exploration(sheet, wp);
  for (const r of atlas.worlds[world].rewards) {
    if (got >= r.at && !wp.rewards.includes(r.id)) { wp.rewards.push(r.id); news.rewards.push(r); }
  }
  return news;
}

/** 一趟结束，记最好成绩。返回是不是新高 */
export function recordBest(save: Save, sheet: Sheet, level: number, score: number): boolean {
  const wp = progressOf(save, sheet);
  // 前面的档位补 0，不留空位：空位存成文字再读回来会错位
  while (wp.best.length <= level) wp.best.push(0);
  if (score > wp.best[level]) { wp.best[level] = score; return true; }
  return false;
}
