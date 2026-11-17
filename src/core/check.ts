// 一个世界的规则合不合格。tests/worlds.test.ts 对名册里每个世界都跑一遍，所以新加的世界
// 不用自己写这些检查，npm run check 就会查到。返回问题的列表，空的就是合格。
// 这里只查「对不对」。好不好玩看机器人的通过率（npm run bot），好不好看看截图（npm run shots）。

import { hopWindowMs } from './aim';
import { LEVELS } from './feel';
import { checkSheet, fingerprint } from './sheet';
import { clone, makeRun, start, step } from './sim';
import type { WorldRules } from './world';

export function checkWorld(rules: WorldRules): string[] {
  const bad: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(rules.id)) bad.push(`id「${rules.id}」要是小写字母开头的英文，和目录名一样`);
  if (!rules.name) bad.push('没有名字');
  if (!rules.resource?.name) bad.push('资源没有名字');

  const sheet = rules.layout(rules.seed);
  if (sheet.world !== rules.id) bad.push(`layout 出来的纸写的是「${sheet.world}」，应该是「${rules.id}」`);
  if (fingerprint(rules.layout(rules.seed)) !== fingerprint(sheet)) bad.push('同一个种子两次 layout 出来的纸不一样（是不是用了不带种子的随机数或时钟）');
  bad.push(...checkSheet(sheet));
  if (bad.length) return bad;

  const ids = new Set<string>();
  for (const r of rules.rewards) {
    if (!(r.at > 0 && r.at <= 1)) bad.push(`奖励 ${r.id} 的 at 要在 0 到 1 之间`);
    if (ids.has(r.id)) bad.push(`奖励 ${r.id} 重复`);
    ids.add(r.id);
  }
  for (const g of sheet.sights) if (g.needs && !ids.has(g.needs)) bad.push(`景 ${g.id} 要的奖励 ${g.needs} 不存在`);
  if (!sheet.routes.length) bad.push('一条路都没有，机器人没法跑');

  for (const feel of LEVELS) {
    const run = makeRun(rules, feel, sheet);
    // 世界自己的状态要能浅拷贝：改了副本，原件不能跟着变
    const a = start(run), before = JSON.stringify(a.w);
    const b = clone(a);
    for (let i = 0; i < 400; i++) step(run, b, i === 60);
    if (JSON.stringify(a.w) !== before) bad.push('世界的状态 w 里有嵌套的对象，clone 之后还连着。只放一层');
    // 同样的按键走两遍要一模一样
    const c = start(run), d = start(run);
    for (let i = 0; i < 600; i++) { step(run, c, i % 150 === 60); step(run, d, i % 150 === 60); }
    if (c.x !== d.x || c.y !== d.y || c.res !== d.res || c.at !== d.at) bad.push(`${feel.name}档：同样的按键走两遍结果不一样，钩子里有不确定的东西`);
    // 路上的每一跳都要够得着
    const seen = new Set<string>();
    for (const r of sheet.routes) {
      for (let i = 1; i < r.spots.length; i++) {
        const key = r.spots[i - 1] + '>' + r.spots[i];
        if (seen.has(key)) continue;
        seen.add(key);
        if (hopWindowMs(run, r.spots[i - 1], r.spots[i]) <= 0) bad.push(`${feel.name}档：路「${r.name}」的 ${r.spots[i - 1]}→${r.spots[i]} 够不着（没有能落进去的离手时刻）`);
      }
    }
  }
  return bad;
}
