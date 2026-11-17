// 「世界」的规则那一半：一张纸上有什么，资源怎么耗怎么补，环境机制是什么，探索到多少给什么。
// 画法那一半在 src/ui/look.ts。规则这一半不碰页面，机器人直接拿它来玩。
//
// 引擎只认识「这个世界的资源」（0 到 1 的一个数）和下面这几个钩子。
// 资源叫什么、什么时候耗、落到哪种点上补多少、用尽了怎么办，全在世界自己的钩子里。
//
// 两个单位（docs/worlds.md）：
// - 一圈：笔锋绕一圈的时间，env.feel.period 秒。按时间算的东西都用它，三档难度下节奏才一样。
// - 一程：LEG（feel.ts），250 个纸面单位，大约是普通一跳的距离。

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
  /** 落在离它这么近的点上算到过。写 0 的话只有世界自己用 env.sight 才触发 */
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
  /** 世界自己的东西（电线、折边、引力圈……），规则和画法都从这里拿。引擎不看 */
  data?: unknown;
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
  /** 刚离开的点，飞出去的这一程它不接。钩子可以改成 -1 让它也能接 */
  left: number;
  /** 笔尖的位置。钩子可以改（顺着电线滑、被折边弹回） */
  x: number;
  y: number;
  /** 飞行速度，每秒。钩子可以改（风、引力） */
  vx: number;
  vy: number;
  /** 绕圈：现在的半径、要收到的半径、角度、方向（1 或 -1） */
  r: number;
  rT: number;
  ang: number;
  dir: number;
  /** 这一程飞了多远，超过射程算飞空。钩子可以改（某一段不算路程） */
  flown: number;
  /** 这个世界的资源，0 到 1 */
  res: number;
  /** 世界自己的状态。只放一层数字、字符串、布尔的话不用管；放了数组或对象，要写 rules.clone */
  w: W;
  /** 这一趟到过的点 */
  seen: Uint8Array;
  /** 这一趟之前就到过的点（存档里的）。只读，一趟里不变 */
  known: Uint8Array;
  /** 这一趟新到了几个点、其中几个「妙」 */
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
      /** 这一趟第一次到这个点 */
      fresh: boolean;
      fine: boolean;
      /** 落点到圈心的距离 */
      d: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
    }
  /** 笔没过去，但世界把这个点记成到过了（落在旁边的种子、路过点亮的灯） */
  | { type: 'visit'; spot: number }
  /** 世界把笔直接放到了一个点上（飞空之后送回上一个大点）。笔迹在这里要断开 */
  | { type: 'put'; spot: number }
  | { type: 'sight'; sight: number }
  /** 世界要长久记住的一件事（绣出的图样、剪出的花）。存进进度的 marks */
  | { type: 'mark'; id: string }
  | { type: 'over'; why: 'miss' | 'out' };

export type Landing = Extract<SimEvent, { type: 'land' }>;

/** 钩子拿到的环境：这一档的手感、这张纸，和几个能对这一趟做的动作 */
export interface Env {
  feel: Feel;
  sheet: Sheet;
  /** 一拍多少秒 */
  dt: number;
  /** 这个位置在哪个点的圈里（按这一档的圈大小），都不在是 -1。skip 是不算的那个点 */
  ringAt(x: number, y: number, skip?: number): number;
  /** 让笔落在这个点上，按笔现在的位置和速度算落点。和自己飞进去一样：计数、触发景、调 land 钩子 */
  land(s: Sim, spot: number): void;
  /** 把笔直接放到这个点上绕着（送回上一个大点）。不算落下，不计数 */
  put(s: Sim, spot: number): void;
  /** 笔不过去，把这个点记成到过，触发它旁边的景 */
  visit(s: Sim, spot: number): void;
  /** 触发一处景（sheet.sights 的下标）。同一处重复触发没关系，进度里只记一次 */
  sight(s: Sim, sight: number): void;
  /** 让进度长久记住一件事。同一个 id 只记一次 */
  mark(s: Sim, id: string): void;
  /** 结束这一趟。会先问 lost 钩子 */
  end(s: Sim, why: 'miss' | 'out'): void;
}

/**
 * 一个世界的规则。五样里的三样在这里：资源、环境机制、探索度和奖励。
 * 另外两样：景和见闻是 layout 出来的 Sheet 里的数据，底和笔在画法里。
 *
 * 钩子要守的：只用传进来的东西算，不读时钟，不用不带种子的随机数。
 * 同样的输入要得到同样的结果，机器人和截图都靠这个。
 * 钩子可以直接改 s 上标着「钩子可以改」的那几样，别的通过 env 上的动作来做。
 */
export interface WorldRules<W = any> {
  /** 和目录名一样 */
  id: string;
  /** 显示的名字 */
  name: string;
  resource: {
    /** 资源叫什么 */
    name: string;
    /** 用尽了这一趟结不结束。默认结束。写 false 的话由世界自己决定什么时候 env.end */
    endsAtZero?: boolean;
  };
  /** 环境机制，一个世界最多一个。水墨没有 */
  mechanic?: { name: string; hint: string };
  /** 固定的种子。同一个种子永远出同一张纸 */
  seed: number;
  layout(seed: number): Sheet;
  rewards: Reward[];
  /** 一程最多飞多远（纸面单位）。不写用 feel.ts 的 REACH */
  reach?: number;

  /** 一趟开始时世界自己的状态 */
  init(env: Env): W;
  /** 世界的状态里有数组或对象时，怎么拷一份互不相干的。不写就是浅拷贝 */
  clone?(w: W): W;
  /** 开始之后每一拍（绕着、飞着都调）：资源怎么耗，定时的东西怎么走 */
  tick?(s: Sim<W>, env: Env): void;
  /** 刚离手的那一拍：离手要耗的东西在这里扣 */
  leave?(s: Sim<W>, from: Spot, env: Env): void;
  /** 飞行中的每一拍，在挪动之前：环境机制在这里改速度、位置、路程，或者用 env.land 让笔落下 */
  fly?(s: Sim<W>, env: Env): void;
  /** 落进一个圈之后：在哪补、补多少、「妙」奖什么 */
  land?(s: Sim<W>, hit: Landing, spot: Spot, env: Env): void;
  /** 这个圈现在接不接（时隐时现的点、只能落一次的冰）。不写就是都接。d 是笔离圈心多远 */
  canLand?(s: Sim<W>, spot: Spot, d: number, env: Env): boolean;
  /** 这一下算不算「妙」。不写就按落点离圈心多近算 */
  fine?(s: Sim<W>, spot: Spot, d: number, env: Env): boolean;
  /** 这一趟要结束了（飞空或资源用尽）。返回 true 表示世界接手了，比如用 env.put 送回上一个大点，这一趟继续 */
  lost?(s: Sim<W>, why: 'miss' | 'out', env: Env): boolean;
  /** 玩家现在看不看得见这个点。不写就是都看得见。画法用它决定画不画，机器人只瞄看得见的点 */
  canSee?(s: Sim<W>, spot: Spot, env: Env): boolean;
}
