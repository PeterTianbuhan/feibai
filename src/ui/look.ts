// 「世界」的画法那一半：底和笔。纸是什么样、笔迹怎么画、点和圈怎么画、景怎么画、
// 落下和离手是什么声音、一趟结束那幅画怎么收尾。
//
// 外壳（app.ts）管的：画布、镜头、输入、标题和结束的文字层、地图、存档、声音的总开关。
// 世界管的：画布上的每一笔。外壳每帧把现在的情形（Scene）交给 Painter，由它画完整个画面。

import type { News, WorldProgress } from '../core/progress';
import type { Run } from '../core/sim';
import type { Sim, SimEvent } from '../core/world';
import type { AudioKit } from './audio';

/** 文字层（标题、计数、结束那几行、地图上的字）用的颜色和字体 */
export interface Theme {
  /** 底色，也是页面背景 */
  ground: string;
  /** 字和线的颜色 */
  line: string;
  /** 点睛的颜色（水墨是朱红） */
  accent: string;
  /** CSS 的 font-family */
  font: string;
}

export interface View {
  /** 画布的宽高，CSS 像素 */
  W: number;
  H: number;
  dpr: number;
  /** 这个屏幕上平时的缩放：纸上的 1 个单位画成几个像素 */
  z0: number;
}

export type Mode = 'title' | 'play' | 'dying' | 'end';

export interface Scene {
  view: View;
  /** 镜头：对着纸上的哪一点、缩放多少 */
  cam: { x: number; y: number; z: number };
  /** 这一趟开始到现在的秒数（画面的时间，和规则的拍子无关） */
  time: number;
  mode: Mode;
  /** dying：收笔过了几秒（总共 DYING 秒）。end：结束画面过了几秒 */
  dieT: number;
  endT: number;
  run: Run;
  sim: Sim;
  /** 显示出来的资源量，0 到 1。收笔时会很快降到 0 */
  res: number;
  /** 这个世界存下来的进度：到过的点、见过的景 */
  progress: WorldProgress;
  audio: AudioKit;
  /** 现在的日期。截图时是固定的 */
  now: Date;
}

/** 收笔（飞空或资源用尽之后笔迹淡出）持续的秒数 */
export const DYING = 0.55;

export interface Painter {
  /** 画布大小变了，重做底 */
  resize(view: View): void;
  /** 新的一趟开始 */
  begin(scene: Scene): void;
  /** 规则里发生了一件事：离手、落下、结束，还有世界自己触发的（put 时笔被挪走了，笔迹要断开） */
  on(ev: SimEvent, scene: Scene): void;
  /** 进度里记下了新东西：第一次到的大点、第一次见的景。不写的话外壳用一行小字提示 */
  news?(news: News, scene: Scene): void;
  /** 每帧，在 draw 之前 */
  update(dt: number, scene: Scene): void;
  /** 画整个画面 */
  draw(ctx: CanvasRenderingContext2D, scene: Scene): void;
  /** 要离开这个世界了：把自己接的、还在响的声音停掉 */
  leave?(): void;
  /** 只画底，地图垫在下面用 */
  ground(ctx: CanvasRenderingContext2D, view: View): void;
}

export interface WorldLook {
  theme: Theme;
  /** 标题页上的那句话 */
  motto: string;
  /** 计数怎么写（水墨写成汉字数字） */
  count(n: number): string;
  /** 结束时的那一行。accent 那一小段用点睛的颜色 */
  endLine(info: { score: number; fine: number; level: string; best: number; record: boolean }): { text: string; accent?: string };
  /** 资源自己画（画在笔尖上、看涟漪自己），不要外壳左下角那根条。默认 false */
  ownGauge?: boolean;
  /** 一趟里一直摆着一个「地图」的小字，点了就收笔去地图。飞空了不结束、会被送回大点的世界要开。默认 false */
  midExit?: boolean;
  /** 存画时的文件名（不带扩展名） */
  fileName(score: number): string;
  /** seed 给画面上的随机用（纸的纤维、溅的墨点），同一个种子画出来一样 */
  painter(seed: number): Painter;
}
