// 水墨：第一个世界。不放环境机制，只教玩法。
// 资源是墨：开始之后匀速地耗，这一趟第一次落进一个圈就蘸满；落得「妙」，接下来一小会儿不耗。

import type { WorldRules } from '../../core/world';
import { layout } from './layout';

/** 落得「妙」，这几秒不耗墨。只奖不罚 */
export const FINE_GRACE = 1.6;

interface InkState {
  /** 还有几秒不耗墨 */
  grace: number;
}

export const rules: WorldRules<InkState> = {
  id: 'ink',
  name: '水墨',
  resource: { name: '墨' },
  seed: 20261117,
  layout,
  rewards: [
    // 探索到一半，起笔处多出一处藏着的景（layout 里 needs: 'ink-half' 的那一处）
    { id: 'ink-half', at: 0.5, name: '半卷' },
    { id: 'ink-full', at: 1, name: '全卷' },
  ],
  init: () => ({ grace: 0 }),
  tick(s, env) {
    if (s.w.grace > 0) s.w.grace -= env.dt;
    else s.res -= env.dt / env.feel.stamina;
  },
  land(s, hit) {
    if (!hit.fresh) return;
    s.res = 1;
    if (hit.fine) s.w.grace = FINE_GRACE;
  },
};
