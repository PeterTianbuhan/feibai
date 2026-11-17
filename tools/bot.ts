// 试玩机器人的命令行。npm run bot -- --help
//
// 例子：
//   npm run bot                            每个世界、三档难度、每条路
//   npm run bot -- --world ink --level 中   只看水墨的中档
//   npm run bot -- --route hill --hops     看「山路走到头」每一跳的数字
//   npm run bot -- --sigma 25 --runs 2000  手更稳的人，多跑几趟

import { LEVELS } from '../src/core/feel';
import { makeRun } from '../src/core/sim';
import { ATLAS, WORLDS } from '../src/worlds';
import { BOT_DEFAULTS, playRoute, type RouteStat } from './bot/play';

const HELP = `试玩机器人：按「离手时机带误差的人」把每条路跑很多遍，报通过率。

  --world <id>     只跑这个世界（默认全部）
  --level <档>     只跑这一档：慢 / 中 / 快，或 0 / 1 / 2（默认三档都跑）
  --route <id>     只跑这条路（默认全部；路的 id 见输出的第一列）
  --runs <n>       每条路跑多少趟（默认 ${BOT_DEFAULTS.runs}）
  --sigma <毫秒>   离手时机误差的标准差（默认 ${BOT_DEFAULTS.sigmaMs}）
  --prep <毫秒>    落下之后至少缓多久才离手（默认 ${BOT_DEFAULTS.prepMs}）
  --seed <n>       随机种子（默认 ${BOT_DEFAULTS.seed}）
  --hops           把每一跳的数字也列出来
  --json           输出 JSON

通过率：一趟里一次都没失手走完整条路的比例。
每一跳：这一跳试了多少次、过了多少；时间窗是能落进去的那段离手时间有多宽。`;

const pct = (v: number) => (v * 100).toFixed(v >= 0.9995 || v < 0.0005 ? 0 : 1).padStart(5) + '%';
const pad = (s: string, n: number) => {
  // 汉字占两格
  let w = 0;
  for (const c of s) w += c.charCodeAt(0) > 255 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

export async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const opts = {
    runs: +(arg('runs') ?? BOT_DEFAULTS.runs), sigmaMs: +(arg('sigma') ?? BOT_DEFAULTS.sigmaMs),
    prepMs: +(arg('prep') ?? BOT_DEFAULTS.prepMs), seed: +(arg('seed') ?? BOT_DEFAULTS.seed),
  };
  const worlds = WORLDS.filter((w) => !arg('world') || w.id === arg('world'));
  if (!worlds.length) { console.error(`没有叫 ${arg('world')} 的世界。有：${WORLDS.map((w) => w.id).join('、')}`); return 2; }
  const lv = arg('level');
  const levels = LEVELS.map((_, i) => i).filter((i) => lv === undefined || LEVELS[i].name === lv || String(i) === lv);
  if (!levels.length) { console.error(`没有 ${lv} 这一档。有：${LEVELS.map((l) => l.name).join('、')}`); return 2; }

  const out: { world: string; level: string; stats: RouteStat[] }[] = [];
  let broken = false;
  for (const w of worlds) {
    const sheet = ATLAS.sheets[w.id];
    const routes = sheet.routes.filter((r) => !arg('route') || r.id === arg('route'));
    if (!routes.length) { console.error(`${w.id} 里没有叫 ${arg('route')} 的路。有：${sheet.routes.map((r) => r.id).join('、')}`); return 2; }
    for (const li of levels) {
      const run = makeRun(w, LEVELS[li], sheet);
      const stats = routes.map((r) => playRoute(run, r, opts));
      out.push({ world: w.id, level: LEVELS[li].name, stats });
      broken ||= stats.some((s) => s.broken);
    }
  }

  if (argv.includes('--json')) { console.log(JSON.stringify(out)); return broken ? 1 : 0; }

  console.log(`每条路 ${opts.runs} 趟，离手误差 ±${opts.sigmaMs} 毫秒，落下后缓 ${opts.prepMs} 毫秒\n`);
  for (const { world, level, stats } of out) {
    const w = ATLAS.worlds[world];
    console.log(`${w.name}（${world}）· ${level}档 · 资源「${w.resource.name}」${w.mechanic ? ` · 环境：${w.mechanic.name}` : ''}`);
    console.log(`  ${pad('路', 10)} ${pad('名字', 18)} 跳数  整条通过  最难的一跳`);
    for (const s of stats) {
      const worst = s.hops.reduce((a, b) => (b.pass < a.pass ? b : a));
      console.log(
        `  ${pad(s.route.id, 10)} ${pad(s.route.name, 18)} ${String(s.hops.length).padStart(3)}   ${pct(s.pass)}    ` +
          `${worst.from}→${worst.to} ${pct(worst.pass)}（窗 ${worst.windowMs.toFixed(0)} 毫秒）${s.broken ? '  ← 走不通' : ''}`,
      );
      if (argv.includes('--hops')) {
        for (const h of s.hops) {
          const why = [h.strayed && `落到别处 ${h.strayed}`, h.missed && `飞空 ${h.missed}`, h.out && `${w.resource.name}尽 ${h.out}`, h.noWindow && `没有窗 ${h.noWindow}`, h.blind && `看不见 ${h.blind}`].filter(Boolean).join('，');
          console.log(`      ${String(h.from).padStart(3)}→${String(h.to).padEnd(3)} ${pct(h.pass)}  窗 ${h.windowMs.toFixed(0).padStart(3)} 毫秒  等 ${h.waitMs.toFixed(0).padStart(4)} 毫秒  ${why}`);
        }
      }
    }
    console.log('');
  }
  if (broken) console.log('有走不通的路（某一跳一次都没过）。');
  return broken ? 1 : 0;
}
