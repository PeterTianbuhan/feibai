// 「世界」的规则那一半：一张纸上有什么，资源怎么耗怎么补，环境机制是什么，探索到多少给什么。
// 画法那一半在 src/ui/look.ts。规则这一半不碰页面，机器人直接拿它来玩。
//
// 引擎只认识「这个世界的资源」（0 到 1 的一个数，到 0 这一趟就结束）和下面这几个钩子。
// 资源叫什么、什么时候耗、落到哪种点上补多少，全在世界自己的钩子里。

import type { Feel } from './feel';

/** 一个点和它的圈 */
export interface Spot {
  /** 等于它在 sheet.spots 里的下标 */
  id: number;
  x: number;
  y: number;
  /** 圈的半径，没乘档位 */
  r: number;
  /** 点心的半径 */
  core: number;
  /** 大点：到过之后能当起点。要有名字 */
  big: boolean;
  name?: string;
  /** 世界自己的标记，比如「充电桩」。引擎不看 */
  kind?: string;
}

/** 一处景。落到它附近的点上就算到过，见闻也挂在这里 */
export interface Sight {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 落在离它这么近的点上算到过 */
  reach: number;
  /** 画哪一种，世界的画法自己认 */
  kind: string;
  /** 见闻册里的一条 */
  note?: { title: string; text: string };
  /** 要先拿到这个奖励才出现（藏起来的景） */
  needs?: string;
}

/** 一条路：点的 id 依次排开。机器人按路来跑，报每一跳和整条路的通过率 */
export interface Route {
  id: string;
  name: string;
  spots: number[];
}

/**
 * 一张纸：一个世界的地图，有自己的坐标。别的世界在别的纸上，坐标互不相干，
 * 世界之间怎么连是另外的数据（core/atlas.ts 的 Link）。
 */
export interface Sheet {
  world: string;
  seed: number;
  spots: Spot[];
  /** 建议的走法：镜头往哪看、机器人怎么走。规则不看它，落进哪个圈都算数 */
  edges: [number, number][];
  /** 第一次来这个世界，从哪个大点起 */
  start: number;
  sights: Sight[];
  routes: Route[];
}

/** 探索度到了 at（0 到 1）给的东西 */
export interface Reward {
  id: string;
  at: number;
  name: string;
  text?: string;
}

/** 一趟的状态。全是数和小对象，clone 之后互不相干，机器人靠这个回到某一刻重试 */
export interface Sim<W = any> {
  /** 走了多少拍 */
  tick: number;
  /** 第一次离手之前不算开始，不耗资源 */
  started: boolean;
  /** 结束的原因：飞空，或者资源用尽 */
  over: '' | 'miss' | 'out';
  /** 正绕着哪个点，飞行中是 -1 */
  at: number;
  /** 刚离开的点，飞出去的这一程它不接 */
  left: number;
  x: number;
  y: number;
  /** 飞行速度，每秒。环境机制可以改它 */
  vx: number;
  vy: number;
  /** 绕圈：现在的半径、要收到的半径、角度、方向（1 或 -1） */
  r: number;
  rT: number;
  ang: number;
  dir: number;
  /** 这一程飞了多远 */
  flown: number;
  /** 这个世界的资源，0 到 1 */
  res: number;
  /** 世界自己的状态。只放一层数字、字符串、布尔，clone 时浅拷贝 */
  w: W;
  /** 这一趟落过的点 */
  seen: Uint8Array;
  /** 这一趟新落了几个点、其中几个「妙」 */
  score: number;
  fine: number;
  /** 这一趟最近落过的大点，没有是 -1 */
  lastBig: number;
  /** 这几拍里发生的事。谁读谁清 */
  events: SimEvent[];
}

export type SimEvent =
  | { type: 'release'; from: number }
  | {
      type: 'land';
      spot: number;
      from: number;
      /** 这一趟第一次落这个点 */
      fresh: boolean;
      fine: boolean;
      /** 落点到圈心的距离 */
      d: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
    }
  | { type: 'sight'; sight: number }
  | { type: 'over'; why: 'miss' | 'out' };

export type Landing = Extract<SimEvent, { type: 'land' }>;

/** 钩子拿到的环境 */
export interface Env {
  feel: Feel;
  sheet: Sheet;
  /** 一拍多少秒 */
  dt: number;
}

/**
 * 一个世界的规则。五样里的三样在这里：资源、环境机制、探索度和奖励。
 * 另外两样：景和见闻是 layout 出来的 Sheet 里的数据，底和笔在画法里。
 *
 * 钩子要守的：只用传进来的东西算，不读时钟，不用 Math.random。
 * 同样的输入要得到同样的结果，机器人和截图都靠这个。
 */
export interface WorldRules<W = any> {
  id: string;
  /** 显示的名字 */
  name: string;
  /** 资源叫什么 */
  resource: { name: string };
  /** 环境机制，一个世界最多一个。水墨没有 */
  mechanic?: { name: string; hint: string };
  /** 固定的种子。同一个种子永远出同一张纸 */
  seed: number;
  layout(seed: number): Sheet;
  rewards: Reward[];

  /** 一趟开始时世界自己的状态 */
  init(env: Env): W;
  /** 开始之后每一拍：资源怎么耗。改 s.res 和 s.w */
  tick?(s: Sim<W>, env: Env): void;
  /** 飞行中的每一拍，在挪动之前：环境机制可以改 s.vx / s.vy */
  fly?(s: Sim<W>, env: Env): void;
  /** 落进一个圈之后：在哪补、补多少、「妙」奖什么 */
  land?(s: Sim<W>, hit: Landing, spot: Spot, env: Env): void;
  /** 这个圈现在接不接。不写就是都接 */
  canLand?(s: Sim<W>, spot: Spot, env: Env): boolean;
}
