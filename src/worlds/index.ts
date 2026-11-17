// 世界的名册（规则那一半）。放进 src/worlds/<名字>/rules.ts 并导出 rules，就自动在这里了，不用登记。
// 画法那一半在 looks.ts，机器人和测试不需要它。

import { makeAtlas, type Atlas } from '../core/atlas';
import type { WorldRules } from '../core/world';
import { HOME, LINKS } from './links';

const found = import.meta.glob<{ rules: WorldRules }>('./*/rules.ts', { eager: true });

export const WORLDS: WorldRules[] = Object.values(found)
  .map((m) => m.rules)
  .sort((a, b) => (a.id === HOME ? -1 : b.id === HOME ? 1 : a.id.localeCompare(b.id)));

export const ATLAS: Atlas = makeAtlas(WORLDS, LINKS);
export { HOME };
