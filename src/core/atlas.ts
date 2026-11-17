// 世界之间怎么连。每个世界是自己的一张纸、自己的坐标，这里不假设它们能拼成一张大地图。
// 连接是数据：成对的渡口，一头在这张纸的某个大点，一头在那张纸的某个大点。
// 到过渡口的一头，另一头就能当起点，换世界就是从那一头起一趟。一趟始终只在一张纸上。

import type { Sheet, WorldRules } from './world';

export interface Port {
  world: string;
  spot: number;
}

export interface Link {
  a: Port;
  b: Port;
}

export interface Atlas {
  worlds: Record<string, WorldRules>;
  sheets: Record<string, Sheet>;
  links: Link[];
}

export function makeAtlas(worlds: WorldRules[], links: Link[] = []): Atlas {
  const atlas: Atlas = { worlds: {}, sheets: {}, links };
  for (const w of worlds) {
    atlas.worlds[w.id] = w;
    atlas.sheets[w.id] = w.layout(w.seed);
  }
  return atlas;
}

/** 从这个点渡过去能到哪些地方 */
export function across(links: Link[], world: string, spot: number): Port[] {
  const out: Port[] = [];
  for (const l of links) {
    if (l.a.world === world && l.a.spot === spot) out.push(l.b);
    if (l.b.world === world && l.b.spot === spot) out.push(l.a);
  }
  return out;
}

export function checkLinks(atlas: Atlas): string[] {
  const bad: string[] = [];
  for (const l of atlas.links) {
    for (const p of [l.a, l.b]) {
      const spot = atlas.sheets[p.world]?.spots[p.spot];
      if (!spot) bad.push(`渡口 ${p.world}:${p.spot} 不存在`);
      else if (!spot.big) bad.push(`渡口 ${p.world}:${p.spot} 要设在大点上，不然过去了没法当起点`);
    }
  }
  return bad;
}
