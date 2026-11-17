// 水墨的画法。照着 prototype/index.html 搬过来的，观感以它为准：
//
// 底：米色宣纸，上面有细纤维和小斑点，四角略旧。
// 笔：一道连着的墨线，随墨的多少变浓淡粗细；刚落下时笔锋一顿变粗；墨少了出飞白（笔毫分叉）。
// 点：一粒浓墨，外面一圈淡淡的水渍是它的圈。这一趟落过的，水渍就退了。大点外面多一圈细线。
// 落下：一圈涟漪，溅几点墨；落得准，浮出一个朱红的「妙」。
// 景：几笔线加淡晕（sights.ts），第一次到的时候慢慢洇出来，旁边浮出它的名字。
// 结束：镜头拉远看这一趟的整幅画，右下角竖着题一行款，盖一方朱印，印上刻的是品第。
// 颜色只有三种：纸的米色、墨的黑、印的朱红。

import { TAU, clamp, hash01, makeRng, type Rng } from '../../core/rng';
import type { News } from '../../core/progress';
import type { SimEvent } from '../../core/world';
import { DYING, type Painter, type Scene, type View, type WorldLook } from '../../ui/look';
import { SIGHT_H, SIGHT_W, sightSprite } from './sights';
import { cn, dateLine, rankOf } from './text';

const FONT = '"STKaiti","KaiTi","Kaiti SC","楷体","Songti SC",serif';
const PAPER = '#f2ecdf';
const INK = '#1c1917';
const RED = '#b3261e';

// 墨色：从淡到浓 17 级
const SHADES: string[] = [];
for (let i = 0; i <= 16; i++) {
  const s = clamp((i / 16) * 1.5, 0, 1), m = (a: number, b: number) => Math.round(a + (b - a) * s);
  SHADES.push(`rgb(${m(126, 28)},${m(118, 25)},${m(108, 23)})`);
}

const SCALE = [0, 2, 4, 7, 9]; // 宫商角徵羽
const noteFreq = (i: number) => 146.83 * Math.pow(2, ((i / 5) | 0) + SCALE[i % 5] / 12);

interface Pt { x: number; y: number; w: number; ink: number }
interface Float { x: number; y: number; t: number; life: number; text: string; color: string; size: number; rise: number; upright: boolean }

class InkPainter implements Painter {
  private paper: HTMLCanvasElement | null = null;
  private pts: Pt[] = [];
  private splats: { x: number; y: number; r: number }[] = [];
  private ripples: { x: number; y: number; r: number; t: number }[] = [];
  private floats: Float[] = [];
  /** 每个点的水渍现在多显 */
  private stain = new Float32Array(0);
  /** 这一趟里新见的景，从什么时候开始洇出来 */
  private reveal = new Map<string, number>();
  private w = 0;
  private pulse = 0;
  private titleTurn = 0;
  private stamped = false;
  private note = 5;
  private rng: Rng;

  constructor(private seed: number) {
    this.rng = makeRng(seed);
  }

  resize(view: View) {
    const { W, H, dpr } = view, rng = makeRng(this.seed).fork('paper');
    const paper = document.createElement('canvas');
    paper.width = Math.round(W * dpr); paper.height = Math.round(H * dpr);
    const p = paper.getContext('2d')!;
    p.setTransform(dpr, 0, 0, dpr, 0, 0);
    p.fillStyle = PAPER; p.fillRect(0, 0, W, H);
    // 纤维
    const n = Math.round((W * H) / 420);
    for (let i = 0; i < n; i++) {
      const x = rng.next() * W, y = rng.next() * H, a = rng.next() * TAU, l = rng.range(4, 22);
      p.strokeStyle = rng.next() < 0.5 ? 'rgba(120,96,60,.045)' : 'rgba(255,252,244,.22)';
      p.lineWidth = rng.range(0.4, 1.1);
      p.beginPath(); p.moveTo(x, y);
      p.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rng.range(-3, 3), y + Math.sin(a) * l * 0.5 + rng.range(-3, 3), x + Math.cos(a) * l, y + Math.sin(a) * l);
      p.stroke();
    }
    for (let i = 0; i < n / 3; i++) {
      p.fillStyle = `rgba(96,74,44,${rng.range(0.02, 0.07)})`;
      p.fillRect(rng.next() * W, rng.next() * H, rng.range(0.5, 1.6), rng.range(0.5, 1.6));
    }
    // 四角旧色
    const g = p.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(150,118,70,0)'); g.addColorStop(1, 'rgba(150,118,70,.2)');
    p.fillStyle = g; p.fillRect(0, 0, W, H);
    this.paper = paper;
  }

  ground(ctx: CanvasRenderingContext2D, view: View) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.paper) ctx.drawImage(this.paper, 0, 0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  begin(scene: Scene) {
    this.pts = []; this.splats = []; this.ripples = []; this.floats = [];
    this.stain = new Float32Array(scene.run.sheet.spots.length);
    this.reveal.clear();
    this.w = 0; this.pulse = 0; this.titleTurn = 0; this.stamped = false; this.note = 5;
    this.rng = makeRng(this.seed).fork('run');
  }

  on(ev: SimEvent, scene: Scene) {
    const au = scene.audio, rng = this.rng;
    if (ev.type === 'release') {
      if (scene.mode !== 'dying') au.swish();
    } else if (ev.type === 'over') {
      au.pluck(73.42, 0.32, 2.6);
    } else if (ev.type === 'land') {
      const p = scene.run.sheet.spots[ev.spot];
      this.pulse = 1;
      if (ev.fresh) {
        const steps = [-2, -1, -1, 1, 1, 2, 3];
        this.note = clamp(this.note + steps[rng.int(steps.length)], 1, 13);
        au.pluck(noteFreq(this.note), 0.3);
        if (ev.fine) {
          au.pluck(noteFreq(this.note + 5), 0.13, 2.4, 0.07);
          this.floats.push({ x: p.x, y: p.y - p.core - 16, t: 0, life: 1.3, text: '妙', color: RED, size: 22, rise: 26, upright: false });
        }
        if (p.big && p.name) this.label(p.x + p.core + 24, p.y - 8, p.name, 2.8);
      } else au.pluck(noteFreq(Math.max(0, this.note - 5)), 0.12, 1);
      this.ripples.push({ x: p.x, y: p.y, r: Math.max(ev.d, p.core + 6), t: 0 });
      // 溅墨
      const k = ev.fine ? 9 : ev.fresh ? 4 : 1, dir = Math.atan2(ev.vy, ev.vx);
      for (let i = 0; i < k; i++) {
        const a = dir + rng.range(-0.9, 0.9), l = rng.range(8, ev.fine ? 58 : 34);
        this.splats.push({ x: ev.x + Math.cos(a) * l, y: ev.y + Math.sin(a) * l, r: rng.range(0.6, ev.fine ? 3.4 : 2.3) * (1 - l / 90) });
      }
    }
  }

  news(news: News, scene: Scene) {
    if (news.sight === undefined) return;
    const g = scene.run.sheet.sights[news.sight];
    this.reveal.set(g.id, scene.time);
    this.label(g.x + SIGHT_W * 0.3, g.y - SIGHT_H * 0.2, g.name, 4.2);
  }

  /** 竖着浮出一行小字，过一会儿淡掉 */
  private label(x: number, y: number, text: string, life: number) {
    this.floats.push({ x, y, t: 0, life, text, color: INK, size: 17, rise: 0, upright: true });
  }

  update(dt: number, scene: Scene) {
    const { sim, mode, time } = scene;
    if (mode !== 'end') {
      if (mode === 'title') this.titleTurn += (TAU / scene.run.feel.period) * dt;
      const fade = mode === 'dying' ? Math.max(0, 1 - scene.dieT / DYING) : 1, ink = scene.res;
      this.pulse = Math.max(0, this.pulse - dt * 4.2);
      const target = 9.5 * (0.36 + 0.64 * Math.sqrt(ink)) * (sim.at >= 0 ? 1 : 0.68) * (1 + 0.75 * this.pulse) * (1 + 0.1 * Math.sin(time * 8.3) + 0.06 * Math.sin(time * 21.7));
      this.w += (target - this.w) * (1 - Math.exp(-dt * 13));
      const last = this.pts[this.pts.length - 1];
      // 标题页上只画一圈，不然越描越黑
      if (!(mode === 'title' && this.titleTurn > TAU * 1.04)) {
        if (!last || Math.hypot(sim.x - last.x, sim.y - last.y) > 2.6) this.pts.push({ x: sim.x, y: sim.y, w: this.w * fade, ink });
      }
    }
    const k = 1 - Math.exp(-dt * 4);
    for (let i = 0; i < this.stain.length; i++) {
      const t = mode === 'end' ? 0 : !sim.seen[i] ? 1 : i === sim.at ? 0.55 : 0;
      this.stain[i] += (t - this.stain[i]) * k;
    }
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 0.7);
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < f.life);
  }

  draw(ctx: CanvasRenderingContext2D, scene: Scene) {
    this.ground(ctx, scene.view);
    this.drawSights(ctx, scene);
    this.drawSpots(ctx, scene);
    this.drawTrail(ctx, scene);
    if (scene.mode !== 'end') this.drawTip(ctx, scene);
    this.drawFloats(ctx, scene);
    if (scene.mode === 'end') this.drawColophon(ctx, scene);
  }

  private drawSights(ctx: CanvasRenderingContext2D, scene: Scene) {
    const { W, H } = scene.view, z = scene.cam.z, ox = W / 2 - scene.cam.x * z, oy = H / 2 - scene.cam.y * z;
    ctx.globalCompositeOperation = 'multiply';
    for (const g of scene.run.sheet.sights) {
      if (!scene.progress.sights.includes(g.id)) continue;
      const x = g.x * z + ox, y = g.y * z + oy, w = SIGHT_W * z, h = SIGHT_H * z;
      if (x < -w / 2 || x > W + w / 2 || y < -h / 2 || y > H + h / 2) continue;
      const since = this.reveal.get(g.id);
      ctx.globalAlpha = since === undefined ? 1 : clamp((scene.time - since) / 2.4, 0, 1) ** 1.5;
      ctx.drawImage(sightSprite(g.kind, g.id), x - w / 2, y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSpots(ctx: CanvasRenderingContext2D, scene: Scene) {
    const { W, H } = scene.view, z = scene.cam.z, ox = W / 2 - scene.cam.x * z, oy = H / 2 - scene.cam.y * z;
    const born = clamp(scene.time / 0.7, 0, 1), run = scene.run;
    for (const n of run.sheet.spots) {
      const x = n.x * z + ox, y = n.y * z + oy, R = run.ringR[n.id] * z;
      if (x < -R || x > W + R || y < -R || y > H + R) continue;
      const a = this.stain[n.id] * born;
      if (a > 0.01) {
        // 水渍
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, `rgba(40,36,32,${0.012 * a})`);
        g.addColorStop(0.78, `rgba(40,36,32,${0.045 * a})`);
        g.addColorStop(0.955, `rgba(40,36,32,${0.105 * a})`);
        g.addColorStop(1, 'rgba(40,36,32,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
      }
      // 结束那幅画上只留这一趟落过的点，别的淡掉，不然像纸上的脏点
      const show = scene.mode === 'end' && !scene.sim.seen[n.id] ? born * Math.max(0, 1 - scene.endT / 0.8) : born;
      if (show <= 0) continue;
      ctx.globalAlpha = show;
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.ellipse(x, y, n.core * z, n.core * z * 0.93, n.core, 0, TAU); ctx.fill();
      if (n.big) {
        // 大点：外面多一圈细线，没合拢，像随手圈了一下
        ctx.globalAlpha = show * 0.5;
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, 1.1 * z);
        ctx.beginPath(); ctx.arc(x, y, (n.core + 8) * z, n.core, n.core + TAU * 0.86); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    for (const r of this.ripples) {
      const k = r.t / 0.7;
      ctx.strokeStyle = `rgba(28,25,23,${0.22 * (1 - k)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(r.x * z + ox, r.y * z + oy, (r.r + k * 46) * z, 0, TAU); ctx.stroke();
    }
  }

  private drawTrail(ctx: CanvasRenderingContext2D, scene: Scene) {
    const { W, H } = scene.view, z = scene.cam.z, ox = W / 2 - scene.cam.x * z, oy = H / 2 - scene.cam.y * z;
    const m = 30, pts = this.pts;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'darken';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const bx = b.x * z + ox, by = b.y * z + oy;
      if (bx < -m || bx > W + m || by < -m || by > H + m) continue;
      const ax = a.x * z + ox, ay = a.y * z + oy;
      const w = Math.max(0.5, b.w * z);
      ctx.strokeStyle = SHADES[Math.round(b.ink * 16)];
      if (b.ink > 0.42) {
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      } else {
        // 飞白：墨少时笔毫分叉
        let nx = -(by - ay), ny = bx - ax;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const nb = 6, th = 0.2 + b.ink * 1.75;
        ctx.lineWidth = Math.max(0.5, (w / nb) * 0.85);
        for (let q = 0; q < nb; q++) {
          if (hash01(((i + q * 5) >> 3) * 7.3 + q * 131.7) > th) continue;
          const off = ((q + 0.5) / nb - 0.5) * w;
          ctx.beginPath(); ctx.moveTo(ax + nx * off, ay + ny * off); ctx.lineTo(bx + nx * off, by + ny * off); ctx.stroke();
        }
      }
    }
    ctx.fillStyle = SHADES[16];
    for (const s of this.splats) {
      const x = s.x * z + ox, y = s.y * z + oy;
      if (x < -m || x > W + m || y < -m || y > H + m) continue;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.4, s.r * z), 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawTip(ctx: CanvasRenderingContext2D, scene: Scene) {
    const { W, H } = scene.view, { sim, cam } = scene, z = cam.z;
    const x = (sim.x - cam.x) * z + W / 2, y = (sim.y - cam.y) * z + H / 2;
    // 去向：现在离手会往哪飞
    if (sim.at >= 0 && scene.mode !== 'dying') {
      const tx = -Math.sin(sim.ang) * sim.dir, ty = Math.cos(sim.ang) * sim.dir;
      for (let i = 1; i <= 9; i++) {
        ctx.fillStyle = `rgba(28,25,23,${0.34 * (1 - i / 10)})`;
        ctx.beginPath(); ctx.arc(x + tx * i * 12 * z, y + ty * i * 12 * z, 1.25, 0, TAU); ctx.fill();
      }
    }
    const fade = scene.mode === 'dying' ? Math.max(0, 1 - scene.dieT / DYING) : 1;
    const r = Math.max(1, this.w * 0.62 * z) * fade;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    g.addColorStop(0, `rgba(28,25,23,${0.2 * scene.res * fade})`); g.addColorStop(1, 'rgba(28,25,23,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  private drawFloats(ctx: CanvasRenderingContext2D, scene: Scene) {
    const { W, H } = scene.view, { cam } = scene, z = cam.z;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      const k = f.t / f.life, size = Math.max(11, Math.round(f.size * z));
      // 「妙」一闪就走；名字多留一会儿再淡
      ctx.globalAlpha = f.upright ? Math.min(1, k / 0.1, (1 - k) / 0.3) * 0.8 : k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      ctx.fillStyle = f.color;
      ctx.font = `${size}px ${FONT}`;
      const x = (f.x - cam.x) * z + W / 2;
      let y = (f.y - cam.y - k * f.rise) * z + H / 2;
      if (!f.upright) ctx.fillText(f.text, x, y);
      else for (const ch of f.text) { ctx.fillText(ch, x, y); y += size * 1.2; }
    }
    ctx.globalAlpha = 1;
  }

  /** 题款与印 */
  private drawColophon(ctx: CanvasRenderingContext2D, scene: Scene) {
    const { W, H } = scene.view, endT = scene.endT, score = scene.sim.score;
    const fs = clamp(Math.min(W, H) * 0.027, 13, 22), s = fs * 2.7, m = Math.max(24, Math.min(W, H) * 0.07);
    const sx = W - m - s, sy = H - m - s;
    const chars = [...(dateLine(scene.now) + ' 第' + cn(score) + '笔')];
    let hgt = 0;
    for (const c of chars) hgt += c === ' ' ? fs * 0.6 : fs * 1.22;
    let y = sy - fs * 0.9 - hgt + fs * 0.6;
    ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    let i = 0;
    for (const c of chars) {
      if (c === ' ') { y += fs * 0.6; continue; }
      ctx.globalAlpha = clamp((endT - 0.7 - i * 0.07) / 0.25, 0, 1) * 0.86;
      ctx.fillText(c, sx + s / 2, y);
      y += fs * 1.22; i++;
    }
    ctx.globalAlpha = 1;
    const t0 = 0.7 + i * 0.07 + 0.25;
    if (endT < t0) return;
    if (!this.stamped) { this.stamped = true; scene.audio.thud(); }
    const k = clamp((endT - t0) / 0.16, 0, 1), sc = 1 + (1 - k) * (1 - k) * 0.55;
    ctx.save();
    ctx.translate(sx + s / 2, sy + s / 2); ctx.rotate(-0.035); ctx.scale(sc, sc);
    ctx.globalAlpha = k * 0.93;
    ctx.fillStyle = RED;
    const r = s * 0.1, h = s / 2;
    ctx.beginPath();
    ctx.moveTo(-h + r, -h); ctx.lineTo(h - r, -h); ctx.quadraticCurveTo(h, -h, h, -h + r);
    ctx.lineTo(h, h - r); ctx.quadraticCurveTo(h, h, h - r, h);
    ctx.lineTo(-h + r, h); ctx.quadraticCurveTo(-h, h, -h, h - r);
    ctx.lineTo(-h, -h + r); ctx.quadraticCurveTo(-h, -h, -h + r, -h); ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.font = `bold ${s * 0.43}px ${FONT}`;
    const rk = rankOf(score);
    ctx.fillText(rk[0], 0, -s * 0.215); ctx.fillText(rk[1], 0, s * 0.225);
    // 印泥残缺
    for (let j = 0; j < 46; j++) {
      const px = (hash01(j * 3.1 + score) - 0.5) * s, py = (hash01(j * 7.7 + 2 + score) - 0.5) * s;
      ctx.globalAlpha = k * 0.75;
      ctx.fillRect(px, py, hash01(j * 1.3) * s * 0.045 + 0.4, hash01(j * 2.9) * s * 0.03 + 0.4);
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
}

export const look: WorldLook = {
  theme: { ground: PAPER, line: INK, accent: RED, font: FONT },
  motto: '墨尽之前　落向下一处',
  count: cn,
  endLine({ score, fine, level, best, record }) {
    const text = `「${rankOf(score)}」　${score ? cn(score) + '笔' : '未成'}　${level}${fine ? '　妙 ' + cn(fine) : ''}`;
    if (record && score) return { text, accent: '新高' };
    return { text: text + (best ? '　最佳 ' + cn(best) : '') };
  },
  fileName: (score) => `飞白-${rankOf(score)}-${score}`,
  painter: (seed) => new InkPainter(seed),
};
