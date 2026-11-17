// 世界的名册（画法那一半）。放进 src/worlds/<名字>/look.ts 并导出 look，就自动在这里了。

import type { WorldLook } from '../ui/look';

const found = import.meta.glob<{ look: WorldLook }>('./*/look.ts', { eager: true });

export const LOOKS: Record<string, WorldLook> = {};
for (const [path, m] of Object.entries(found)) LOOKS[path.split('/')[1]] = m.look;
