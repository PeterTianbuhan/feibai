// 外壳：把规则、世界的画法、文字层、输入、存档接在一起。
// 规则按固定的拍子走（core/feel.ts 的 DT），画面每帧画一次。一趟始终只在一个世界的一张纸上。

import { DT, LEVELS } from '../core/feel';
import { exploration, progressOf, record, recordBest, startable, type News, type Save } from '../core/progress';
import { clamp } from '../core/rng';
import { makeRun, start, step, type Run } from '../core/sim';
import type { Sim } from '../core/world';
import { ATLAS, HOME } from '../worlds';
import { LOOKS } from '../worlds/looks';
import { AudioKit } from './audio';
import { $, applyTheme, mountDom, show } from './dom';
import { DYING, type Painter, type Scene, type View, type WorldLook } from './look';
import { drawMap, type MapPick } from './map';
import { loadSave, writeSave, type Store } from './store';

export interface AppOpts {
  canvas: HTMLCanvasElement;
  store: Store;
  params: URLSearchParams;
  /** 截图时用：不放过渡动画，日期固定 */
  still?: boolean;
  now?: () => Date;
}

export class App {
  readonly audio = new AudioKit();
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private store: Store;
  private save: Save;
  private now: () => Date;

  world = HOME;
  level = 1;
  /** 这一趟从哪个点起 */
  startSpot = 0;
  run!: Run;
  sim!: Sim;
  private look!: WorldLook;
  private painter!: Painter;
  private scene!: Scene;
  private view: View = { W: 1, H: 1, dpr: 1, z0: 1 };

  private acc = 0;
  private pressed = false;
  private ahead = { x: 0, y: 0 };
  /** 刚见到一处景，镜头往它那边带一会儿 */
  private gaze = { x: 0, y: 0, until: -1 };
  private box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private firstRun = true;
  private endShown = false;
  private noteUntil = -1;
  private clock = 0;
  mapOpen = false;
  private picks: MapPick[] = [];

  /** 自动离手：每一拍问一次要不要按。截图用它来替人走到某个时刻 */
  pilot: ((sim: Sim) => boolean) | null = null;
  /** 进度里每记下一样新东西就调一次 */
  onNews: ((news: News) => void) | null = null;

  constructor(o: AppOpts) {
    this.cv = o.canvas; this.ctx = o.canvas.getContext('2d')!;
    this.store = o.store; this.now = o.now ?? (() => new Date());
    this.save = loadSave(o.store);
    mountDom(!!o.still);

    const want = o.params.get('world') ?? this.save.at?.world ?? HOME;
    const lv = o.params.get('level');
    this.level = clamp(lv !== null ? +lv | 0 : this.save.level, 0, LEVELS.length - 1);
    this.measure();
    this.enter(ATLAS.worlds[want] && LOOKS[want] ? want : HOME, this.save.at?.spot);
    this.listen();
  }

  get mode() {
    return this.scene.mode;
  }

  // ---------- 进世界、起一趟 ----------

  /** 换到一个世界，从它的某个大点起 */
  enter(world: string, spot?: number) {
    this.world = world;
    this.look = LOOKS[world];
    applyTheme(this.look.theme);
    this.painter = this.look.painter(ATLAS.worlds[world].seed);
    this.painter.resize(this.view);
    const sheet = ATLAS.sheets[world];
    this.startSpot = spot !== undefined && startable(sheet, progressOf(this.save, sheet)).includes(spot) ? spot : sheet.start;
    this.reset();
  }

  /** 回到标题，笔尖绕着起点转，等第一次离手 */
  reset() {
    const rules = ATLAS.worlds[this.world], sheet = ATLAS.sheets[this.world];
    this.run = makeRun(rules, LEVELS[this.level], sheet);
    this.sim = start(this.run, this.startSpot, { known: progressOf(this.save, sheet).spots });
    this.acc = 0; this.pressed = false; this.endShown = false; this.gaze.until = -1;
    this.scene = {
      view: this.view, cam: { x: 0, y: 0, z: this.view.z0 }, time: 0, mode: 'title', dieT: 0, endT: 0,
      run: this.run, sim: this.sim, res: 1, progress: progressOf(this.save, sheet), audio: this.audio, now: this.now(),
    };
    this.lookAhead();
    const s = this.sim;
    this.scene.cam.x = s.x * 0.62 + this.ahead.x * 0.38; this.scene.cam.y = s.y * 0.62 + this.ahead.y * 0.38;
    this.box = { x0: s.x, y0: s.y, x1: s.x, y1: s.y };
    this.painter.begin(this.scene);

    show('end', false); show('title', !this.mapOpen); show('hud', !this.firstRun && !this.mapOpen);
    $('motto').textContent = this.look.motto;
    $('bar').style.display = this.look.ownGauge ? 'none' : '';
    ($('quit') as HTMLButtonElement).hidden = true;
    $('score').textContent = '';
    for (const b of $('levels').querySelectorAll<HTMLElement>('[data-lv]')) b.classList.toggle('on', +b.dataset.lv! === this.level);
    // 只有一个起点的时候，标题页不摆地图
    ($('open-map') as HTMLButtonElement).hidden = this.scene.progress.spots.length < 2 && Object.keys(this.save.worlds).length < 2;
  }

  setLevel(i: number) {
    if (this.mode !== 'title') return;
    this.level = clamp(i, 0, LEVELS.length - 1);
    this.save.level = this.level;
    this.persist();
    this.reset();
  }

  private persist() {
    writeSave(this.store, this.save);
  }

  // ---------- 输入 ----------

  /** 那一个键 */
  act() {
    this.audio.wake();
    if (this.mapOpen) return;
    if (this.mode === 'title' || this.mode === 'play') this.pressed = true;
    else if (this.mode === 'end' && this.scene.endT > 1.1) this.reset();
  }

  private listen() {
    addEventListener('resize', () => { this.measure(); this.painter.resize(this.view); });
    addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      if (this.mapOpen) this.pickOnMap(e.clientX, e.clientY);
      else this.act();
    });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (this.mapOpen) this.closeMap(); else this.act(); }
      else if (e.code === 'KeyM') this.audio.muted = !this.audio.muted;
      else if (e.code === 'KeyS' && this.mode === 'end') this.savePicture();
      else if (e.code === 'KeyG') { if (this.mapOpen) this.closeMap(); else if (this.mode === 'play') this.quit(); else this.openMap(); }
      else if (e.code === 'Escape' && this.mapOpen) this.closeMap();
      else if (/^Digit[1-9]$/.test(e.code) && !this.mapOpen) this.setLevel(+e.code.slice(5) - 1);
    });
    $('levels').addEventListener('click', (e) => {
      const lv = (e.target as HTMLElement).dataset.lv;
      if (lv !== undefined) this.setLevel(+lv);
    });
    $('open-map').addEventListener('click', () => this.openMap());
    $('end-map').addEventListener('click', () => this.openMap());
    $('quit').addEventListener('click', () => this.quit());
    $('again').addEventListener('click', () => { this.audio.wake(); if (this.mode === 'end') this.reset(); });
    $('save').addEventListener('click', () => this.savePicture());
    $('map-worlds').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.world;
      if (id && id !== this.world) { this.enter(id); this.fillMapText(); }
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.view.W = W; this.view.H = H; this.view.dpr = dpr;
    this.view.z0 = clamp(Math.min(W, H) / 700, 0.5, 1.45);
  }

  savePicture() {
    this.cv.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = this.look.fileName(this.sim.score) + '.png';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  // ---------- 地图 ----------

  openMap() {
    if (this.mode !== 'title' && this.mode !== 'end') return;
    this.mapOpen = true;
    if (this.mode === 'end') this.reset();
    show('title', false); show('hud', false); show('map', true);
    this.fillMapText();
  }

  /** 一趟走到一半收笔，去地图。成绩和进度照记，下一趟从最后落过的大点起 */
  quit() {
    if (this.mode !== 'play') return;
    this.settle();
    this.openMap();
  }

  closeMap() {
    this.mapOpen = false;
    show('map', false); show('title', true); show('hud', !this.firstRun);
  }

  private fillMapText() {
    const sheet = ATLAS.sheets[this.world], wp = this.scene.progress, n = this.look.count;
    $('map-name').textContent = ATLAS.worlds[this.world].name;
    const open = sheet.sights.filter((g) => !g.needs || wp.rewards.includes(g.needs)).length;
    $('map-count').textContent = `到过 ${n(wp.spots.length)} / ${n(sheet.spots.length)}　　景 ${n(wp.sights.length)} / ${n(open)}　　探索 ${Math.round(exploration(sheet, wp) * 100)}%`;
    // 有进度的世界才列出来；只有一个就不列
    const ids = Object.keys(ATLAS.worlds).filter((id) => LOOKS[id] && (id === this.world || this.save.worlds[id]));
    $('map-worlds').innerHTML = ids.length < 2 ? '' : ids.map((id) => `<button data-world="${id}" class="${id === this.world ? 'on' : ''}">${ATLAS.worlds[id].name}</button>`).join('');
  }

  private pickOnMap(x: number, y: number) {
    let best: MapPick | null = null, bd = 36;
    for (const p of this.picks) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      this.startSpot = best.spot;
      this.save.at = { world: this.world, spot: best.spot };
      this.persist();
    }
    this.mapOpen = false;
    show('map', false);
    this.reset();
  }

  // ---------- 每帧 ----------

  /** 往前走 dt 秒，然后画一帧 */
  frame(dt: number) {
    dt = Math.min(0.033, Math.max(0, dt));
    const sc = this.scene, sim = this.sim;
    this.clock += dt; sc.time += dt;

    if (sc.mode !== 'end') {
      this.acc += dt;
      while (this.acc >= DT - 1e-9) {
        this.acc -= DT;
        const press = sc.mode !== 'dying' && !this.mapOpen && (this.pressed || (this.pilot ? this.pilot(sim) : false));
        this.pressed = false;
        if (press && sc.mode === 'title') {
          sc.mode = 'play'; this.firstRun = false;
          show('title', false); show('hud', true);
          ($('quit') as HTMLButtonElement).hidden = !this.look.midExit;
        }
        step(this.run, sim, press);
        if (sim.events.length) this.drain();
      }
      if (sim.x < this.box.x0) this.box.x0 = sim.x;
      if (sim.x > this.box.x1) this.box.x1 = sim.x;
      if (sim.y < this.box.y0) this.box.y0 = sim.y;
      if (sim.y > this.box.y1) this.box.y1 = sim.y;
      if (sc.mode === 'dying') {
        sc.dieT += dt; sc.res = Math.max(0, sc.res - dt * 1.5);
        if (sc.dieT >= DYING) this.finish();
      } else sc.res = sim.res;
      $('resbar').style.transform = `scaleY(${sc.res.toFixed(3)})`;
    } else {
      sc.endT += dt;
      if (!this.endShown && sc.endT >= 1.5) { this.endShown = true; show('end', true); }
    }
    if (this.noteUntil >= 0 && this.clock > this.noteUntil) { this.noteUntil = -1; show('note', false); }

    this.moveCamera(dt);
    this.painter.update(dt, sc);
    if (this.mapOpen) {
      this.painter.ground(this.ctx, this.view);
      this.picks = drawMap(this.ctx, { view: this.view, sheet: this.run.sheet, progress: sc.progress, theme: this.look.theme, here: this.startSpot, time: this.clock });
    } else this.painter.draw(this.ctx, sc);
  }

  /** 规则里刚发生的事：交给画法，记进进度 */
  private drain() {
    const sc = this.scene, sim = this.sim;
    let dirty = false;
    for (const ev of sim.events) {
      this.painter.on(ev, sc);
      if (ev.type === 'land' || ev.type === 'visit' || ev.type === 'sight' || ev.type === 'mark') {
        const news = record(this.save, ATLAS, this.world, ev);
        if (news.spot !== undefined || news.sight !== undefined || news.mark !== undefined || news.rewards.length || news.ports.length) {
          dirty = true;
          this.tell(news);
        }
        $('score').textContent = sim.score ? this.look.count(sim.score) : '';
      } else if (ev.type === 'over') {
        sc.mode = 'dying'; sc.dieT = 0;
      }
    }
    sim.events.length = 0;
    if (dirty) this.persist();
  }

  private tell(news: News) {
    const sheet = this.run.sheet, said: string[] = [];
    if (this.painter.news) this.painter.news(news, this.scene);
    else {
      if (news.big !== undefined) said.push(sheet.spots[news.big].name ?? '');
      if (news.sight !== undefined) said.push(sheet.sights[news.sight].name);
    }
    if (news.sight !== undefined) {
      const g = sheet.sights[news.sight];
      this.gaze = { x: g.x, y: g.y, until: this.scene.time + 3.2 };
    }
    for (const r of news.rewards) said.push(`得「${r.name}」`);
    for (const p of news.ports) said.push(`渡口通了　可去${ATLAS.worlds[p.world].name}`);
    if (said.length) {
      $('note-text').textContent = said.filter(Boolean).join('　·　');
      show('note', true);
      this.noteUntil = this.clock + 3.2;
    }
    this.onNews?.(news);
  }

  /** 一趟结束：镜头拉远看整幅画 */
  private finish() {
    const sc = this.scene, sim = this.sim;
    const best = sc.progress.best[this.level] ?? 0;
    const isRecord = this.settle();
    const line = this.look.endLine({ score: sim.score, fine: sim.fine, level: LEVELS[this.level].name, best, record: isRecord });
    const el = $('endline');
    el.textContent = line.text;
    if (line.accent) {
      const b = document.createElement('b');
      b.textContent = '　' + line.accent;
      el.append(b);
    }
    show('hud', false);
  }

  /** 一趟收了：记成绩，定下一趟从哪起，画面转到结束。返回是不是新高 */
  private settle(): boolean {
    const sc = this.scene, sim = this.sim;
    sc.mode = 'end'; sc.endT = 0;
    const isRecord = recordBest(this.save, this.run.sheet, this.level, sim.score);
    // 这一趟落过大点的话，下一趟从最后落的那个大点起。飞空了不用从头来
    if (sim.lastBig >= 0) this.startSpot = sim.lastBig;
    this.save.at = { world: this.world, spot: this.startSpot };
    this.persist();
    return isRecord;
  }

  /** 镜头往哪看：笔尖和「接下来能去的地方」之间 */
  private lookAhead() {
    const { sim, run } = this;
    if (sim.at < 0) return;
    let list = run.near[sim.at].filter((i) => !sim.seen[i]);
    if (!list.length) list = run.near[sim.at];
    if (!list.length) list = [sim.at];
    let x = 0, y = 0;
    for (const i of list) { x += run.sheet.spots[i].x; y += run.sheet.spots[i].y; }
    this.ahead.x = x / list.length; this.ahead.y = y / list.length;
  }

  private moveCamera(dt: number) {
    const sc = this.scene, cam = sc.cam, { W, H, z0 } = this.view;
    let tx: number, ty: number, tz: number;
    if (sc.mode === 'end') {
      const b = this.box, w = Math.max(80, b.x1 - b.x0), h = Math.max(80, b.y1 - b.y0);
      tx = (b.x0 + b.x1) / 2; ty = (b.y0 + b.y1) / 2;
      tz = Math.min((W * 0.74) / w, (H * 0.7) / h, z0 * 1.25);
    } else {
      this.lookAhead();
      tx = this.sim.x * 0.62 + this.ahead.x * 0.38; ty = this.sim.y * 0.62 + this.ahead.y * 0.38; tz = z0;
      if (sc.time < this.gaze.until) { tx += (this.gaze.x - tx) * 0.3; ty += (this.gaze.y - ty) * 0.3; }
    }
    const k = 1 - Math.exp(-dt * (sc.mode === 'end' ? 2.2 : 3.2));
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
  }

  /** 跟着屏幕的刷新一直跑 */
  loop() {
    let last = 0;
    const tick = (t: number) => {
      this.frame((t - last) / 1000 || 0);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
