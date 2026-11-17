// 入口。平时跟着屏幕刷新跑；带 ?shot=<时刻> 的时候不跑循环，由截图模式一帧一帧推到那个时刻。

import { App } from './ui/app';
import { browserStore, memoryStore } from './ui/store';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const app = new App({
  canvas: document.getElementById('c') as HTMLCanvasElement,
  store: shot ? memoryStore() : browserStore,
  params,
  still: !!shot,
  now: shot ? () => new Date(2026, 10, 17) : undefined,
});

if (shot) void import('./ui/shot').then((m) => m.runShot(app, shot, params));
else app.loop();
