// 手感数值，全在这一个文件里。改这里的任何一个数，都要带上机器人跑出来的前后对比（npm run bot）。
//
// 定下来的事（docs/design.md）：
// - 转一圈多久是固定的，不随落点、不随进度变。玩家要能练出手感。
// - 绕圈半径只看这个点本身，不看落得准不准。落得准（「妙」）只奖不罚，奖什么由世界定。
// - 难度分档，同一档里这些数全程不变。难不难只看布局。

import { clamp } from './rng';

/** 规则每秒走多少拍。离手只能落在拍子上，一拍约 8 毫秒，比人手的误差小得多。 */
export const TICKS = 120;
export const DT = 1 / TICKS;

export interface Feel {
  /** 档名，显示用 */
  name: string;
  /** 转一圈的秒数 */
  period: number;
  /** 飞行速度，纸上的单位每秒 */
  speed: number;
  /** 圈的大小：布局里写的半径乘这个数 */
  ring: number;
  /** 一份满的资源在这一档大约够撑几秒。怎么用由世界定（水墨是匀速耗，妙了停一会儿） */
  stamina: number;
}

export const LEVELS: readonly Feel[] = [
  { name: '慢', period: 2.3, speed: 215, ring: 1.18, stamina: 9.5 },
  { name: '中', period: 1.8, speed: 255, ring: 1, stamina: 7 },
  { name: '快', period: 1.35, speed: 300, ring: 0.86, stamina: 5 },
];

/** 布局检查圈有没有叠在一起时，按最大的那一档算 */
export const MAX_RING = Math.max(...LEVELS.map((l) => l.ring));

/** 绕圈半径：只看圈的大小 */
export const orbitRadius = (ringR: number) => clamp(ringR * 0.62, 38, 66);
/** 刚落下时从落点起绕，按这个速率收到固定半径上（每秒） */
export const ORBIT_SETTLE = 5;
/** 落点离圈心最近也按「点心半径 + 这个数」起绕，免得贴在点上 */
export const ORBIT_MIN_GAP = 6;

/** 一程：大约是普通一跳的距离。世界设计里的距离都按「几程」来说（docs/worlds.md） */
export const LEG = 250;

/** 离手后飞出这么远还没被接住，算飞空。世界可以用 rules.reach 定自己的 */
export const REACH = 540;

/** 「妙」：落点到圈心的距离，在点心到圈边之间不超过这个比例 */
export const FINE = 0.34;
