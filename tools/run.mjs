// 跑 tools/ 下的 TypeScript 工具。借 Vite 来加载，这样工具和游戏用的是同一套模块
// （世界的名册靠 import.meta.glob 自动收，直接用 node 跑认不出来）。
// 用法：node tools/run.mjs <工具名> [参数…]
import { runnerImport } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [tool, ...args] = process.argv.slice(2);
if (!tool) {
  console.error('用法：node tools/run.mjs <bot|shots> [参数…]');
  process.exit(2);
}
const { module } = await runnerImport(resolve(root, 'tools', tool + '.ts'), { root, logLevel: 'error' });
process.exitCode = (await module.main(args)) ?? 0;
