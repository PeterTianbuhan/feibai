// 截图的命令行。npm run shots -- --help
//
// 起一个本地的开发服务，用无头浏览器打开游戏的截图模式（src/ui/shot.ts），
// 每个世界、每个固定时刻、手机和电脑两种尺寸各截一张，放进 shots-out/<世界>/。
// 截出来的图自己打开看，对照这个世界的画法说明（src/worlds/<名字>/look.ts 开头那段）。

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createServer } from 'vite';
import { LEVELS } from '../src/core/feel';
import { SHOTS } from '../src/ui/shot';
import { WORLDS } from '../src/worlds';

const SIZES = [
  { name: 'phone', width: 390, height: 844, scale: 2 },
  { name: 'desktop', width: 1440, height: 900, scale: 1 },
];

const HELP = `截图：每个世界在固定时刻、手机和电脑两种尺寸各截一张，放进 shots-out/。

  --world <id>     只截这个世界（默认全部）
  --shot <时刻>    只截这个时刻：${SHOTS.join(' / ')}（默认全部）
  --level <档>     用哪一档：慢 / 中 / 快，或 0 / 1 / 2（默认 中）
  --route <id>     走哪条路（默认从起点出发、最早遇到景的那条）
  --hops <n>       途中和结束那两张，走几跳（默认 5）
  --out <目录>     放哪（默认 shots-out）

同一个时刻每次截出来是一样的，改完再截一遍可以直接和上一次比。`;

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    // 没装 playwright 自带的浏览器，就用系统里的 Chrome
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      throw new Error('找不到能用的浏览器。跑一下 npx playwright install chromium，或者装一个 Chrome。');
    }
  }
}

/**
 * 不走截图模式，真的开着循环按几下键：标题上离手、等它飞、再按、打开地图再关。
 * 只查一件事：页面不报错。截图模式绕开了输入和循环，这一步补上。
 */
async function live(browser: Browser, base: string, world: string): Promise<number> {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?world=${world}`);
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(450); }
  await page.waitForTimeout(3500); // 等这一趟结束
  await page.keyboard.press('KeyG'); await page.waitForTimeout(300);
  await page.mouse.click(400, 300); await page.waitForTimeout(300);
  await page.keyboard.press('Digit1'); await page.waitForTimeout(200);
  await page.setViewportSize({ width: 500, height: 800 }); await page.waitForTimeout(300);
  await page.keyboard.press('Space'); await page.waitForTimeout(600);
  const saved = await page.evaluate(() => localStorage.getItem('feibai.save.v1'));
  if (!saved) errors.push('进度没有存进浏览器');
  await ctx.close();
  if (errors.length) console.error(`✗ ${world} 真按键试玩报错：\n  ` + [...new Set(errors)].join('\n  '));
  else console.log(`${world}：真按键试玩没有报错，进度存进了浏览器`);
  return errors.length ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const worlds = WORLDS.filter((w) => !arg('world') || w.id === arg('world'));
  if (!worlds.length) { console.error(`没有叫 ${arg('world')} 的世界。有：${WORLDS.map((w) => w.id).join('、')}`); return 2; }
  const shots = SHOTS.filter((s) => !arg('shot') || s === arg('shot'));
  if (!shots.length) { console.error(`没有 ${arg('shot')} 这个时刻。有：${SHOTS.join('、')}`); return 2; }
  const lv = arg('level') ?? '1';
  const level = LEVELS.findIndex((l, i) => l.name === lv || String(i) === lv);
  if (level < 0) { console.error(`没有 ${lv} 这一档。有：${LEVELS.map((l) => l.name).join('、')}`); return 2; }
  const out = resolve(arg('out') ?? 'shots-out');

  const server = await createServer({ logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const addr = server.httpServer!.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 5173}/`;
  const browser = await launch();
  let failed = 0;
  try {
    for (const w of worlds) {
      await mkdir(resolve(out, w.id), { recursive: true });
      for (const size of SIZES) {
        const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale });
        for (const shot of shots) {
          const page = await ctx.newPage();
          page.on('pageerror', (e) => { failed++; console.error(`✗ ${w.id} ${shot} ${size.name} 页面报错：${e.message}`); });
          const q = new URLSearchParams({ world: w.id, shot, level: String(level) });
          if (arg('route')) q.set('route', arg('route')!);
          if (arg('hops')) q.set('hops', arg('hops')!);
          await page.goto(base + '?' + q);
          await page.waitForFunction(() => !!document.documentElement.dataset.shot, undefined, { timeout: 120000 });
          const state = await page.evaluate(() => [document.documentElement.dataset.shot, document.documentElement.dataset.shotError]);
          const file = resolve(out, w.id, `${shot}-${size.name}.png`);
          if (state[0] !== 'ready') { failed++; console.error(`✗ ${w.id} ${shot} ${size.name}：${state[1]}`); }
          else { await page.screenshot({ path: file }); console.log(file); }
          await page.close();
        }
        await ctx.close();
      }
      failed += await live(browser, base, w.id);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (failed) console.error(`有 ${failed} 处没过，见上面。`);
  return failed ? 1 : 0;
}
