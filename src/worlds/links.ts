// 世界之间怎么连，只是数据。「世界怎么排」还在重新设计，定下来之后改这一个文件。
// 一条 Link 是一对渡口：{ a: { world, spot }, b: { world, spot } }，两头都要是大点。
// 到过一头，另一头就能在地图上当起点。还没连上的世界，用 ?world=<id> 可以直接进去。

import type { Link } from '../core/atlas';

/** 新玩家从哪个世界开始 */
export const HOME = 'ink';

export const LINKS: Link[] = [];
