// 水墨的景。每一样都只有几笔线加一两块晕染：远山、舟、竹、月。
// 不往写实里画。要加新的，照这个分量加一个函数，在 KINDS 里登记。
// 每处景先画在一张小画布上存着，游戏里只是把它贴上去。

import { TAU, makeRng, type Rng } from '../../core/rng';

/** 一处景占的大小（纸上的单位） */
export const SIGHT_W = 400;
export const SIGHT_H = 300;
const SCALE = 2;
const INK = '28,25,23';
const ink = (a: number) => `rgba(${INK},${a})`;

type Draw = (c: CanvasRenderingContext2D, rng: Rng) => void;

/** 一片叶、一笔撇：两头尖中间鼓 */
function leaf(c: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, wid: number, a: number) {
  c.save();
  c.translate(x, y); c.rotate(ang);
  c.fillStyle = ink(a);
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(len * 0.4, -wid, len, 0);
  c.quadraticCurveTo(len * 0.45, wid * 0.7, 0, 0);
  c.fill();
  c.restore();
}

/** 一块淡淡的晕 */
function wash(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a: number) {
  c.save();
  c.translate(x, y); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, ink(a)); g.addColorStop(0.6, ink(a * 0.55)); g.addColorStop(1, ink(0));
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, rx, 0, TAU); c.fill();
  c.restore();
}

/** 远山：三层山影，越近越深，山脚化在雾里 */
const hills: Draw = (c, rng) => {
  for (let L = 0; L < 3; L++) {
    const base = 70 + L * 34, amp = 78 - L * 14, peak = rng.range(-90, 90), wide = rng.range(70, 120);
    const p1 = rng.range(0, TAU), p2 = rng.range(0, TAU), f1 = rng.range(0.012, 0.02), f2 = rng.range(0.03, 0.045);
    const top = (x: number) =>
      base - amp * (Math.exp(-((x - peak) ** 2) / (2 * wide * wide)) * 0.9 + 0.16 * Math.sin(x * f1 + p1) + 0.07 * Math.sin(x * f2 + p2));
    const g = c.createLinearGradient(0, base - amp, 0, base + 46);
    g.addColorStop(0, ink(0.13 + L * 0.085)); g.addColorStop(0.55, ink(0.06 + L * 0.03)); g.addColorStop(1, ink(0));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-SIGHT_W / 2, base + 46);
    for (let x = -SIGHT_W / 2; x <= SIGHT_W / 2; x += 6) c.lineTo(x, top(x));
    c.lineTo(SIGHT_W / 2, base + 46);
    c.fill();
    if (L === 2) {
      // 最近的一层，山脊上提一笔
      c.strokeStyle = ink(0.42); c.lineWidth = 1.5; c.lineCap = 'round';
      c.beginPath();
      for (let x = peak - wide * 1.1; x <= peak + wide * 0.7; x += 6) c.lineTo(x, top(x));
      c.stroke();
    }
  }
};

/** 舟：一道船身，一个篷，一个人一根篙，几道水纹 */
const boat: Draw = (c, rng) => {
  wash(c, 0, 26, 150, 34, 0.07);
  c.lineCap = 'round';
  c.strokeStyle = ink(0.86); c.lineWidth = 6.5;
  c.beginPath(); c.moveTo(-52, 2); c.quadraticCurveTo(-4, 20, 54, -3); c.stroke();
  c.strokeStyle = ink(0.6); c.lineWidth = 3;
  c.beginPath(); c.moveTo(-22, 7); c.quadraticCurveTo(-6, -17, 12, 6); c.stroke();
  // 人和篙
  c.strokeStyle = ink(0.8); c.lineWidth = 3;
  c.beginPath(); c.moveTo(34, 0); c.lineTo(35, -17); c.stroke();
  c.fillStyle = ink(0.8); c.beginPath(); c.arc(35.5, -22, 3, 0, TAU); c.fill();
  c.lineWidth = 1.1; c.strokeStyle = ink(0.6);
  c.beginPath(); c.moveTo(30, -27); c.lineTo(66, 22); c.stroke();
  // 水纹
  c.lineWidth = 1.1;
  for (let i = 0; i < 6; i++) {
    const y = 20 + i * 8 + rng.range(-2, 2), x = rng.range(-120, 40), l = rng.range(36, 96);
    c.strokeStyle = ink(0.3 - i * 0.035);
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y + rng.range(-2.5, 2.5), x + l, y); c.stroke();
  }
};

/** 竹：几根竿，一节一节的，上头几簇叶 */
const bamboo: Draw = (c, rng) => {
  wash(c, 0, -10, 130, 120, 0.05);
  c.lineCap = 'round';
  const n = 3 + rng.int(2);
  for (let k = 0; k < n; k++) {
    let x = (k - (n - 1) / 2) * rng.range(30, 44) + rng.range(-8, 8), y = 130;
    const lean = rng.range(-0.12, 0.12), a = rng.range(0.34, 0.6), w = rng.range(3.4, 5.6), joints = 4 + rng.int(2);
    for (let j = 0; j < joints; j++) {
      const len = rng.range(40, 56) * (1 - j * 0.05), ang = -Math.PI / 2 + lean * (1 + j * 0.35);
      const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
      c.strokeStyle = ink(a); c.lineWidth = w * (1 - j * 0.1);
      c.beginPath(); c.moveTo(x, y); c.lineTo(nx, ny); c.stroke();
      // 节
      c.strokeStyle = ink(0.7); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(nx - w * 0.9, ny - 1); c.lineTo(nx + w * 0.9, ny + 1); c.stroke();
      x = nx + Math.cos(ang) * 3; y = ny + Math.sin(ang) * 3;
      if (j >= 2) {
        const side = rng.next() < 0.5 ? 1 : -1, leaves = 3 + rng.int(3);
        for (let q = 0; q < leaves; q++) {
          const la = Math.PI / 2 + side * rng.range(0.25, 1.15);
          leaf(c, nx + side * 3, ny, la, rng.range(30, 54), rng.range(5, 8.5), rng.range(0.62, 0.9));
        }
      }
    }
  }
};

/** 月：月亮是留白，四周一圈淡墨，下面横着一两抹云 */
const moon: Draw = (c, rng) => {
  const r = 40, R = 150;
  const g = c.createRadialGradient(0, -20, 0, 0, -20, R);
  g.addColorStop(0, ink(0)); g.addColorStop(r / R, ink(0)); g.addColorStop(r / R + 0.012, ink(0.2));
  g.addColorStop(0.5, ink(0.075)); g.addColorStop(1, ink(0));
  c.fillStyle = g; c.beginPath(); c.arc(0, -20, R, 0, TAU); c.fill();
  for (let i = 0; i < 3; i++) wash(c, rng.range(-70, 70), 26 + i * 20 + rng.range(-5, 5), rng.range(80, 140), rng.range(8, 14), 0.1);
};

const KINDS: Record<string, Draw> = { hills, boat, bamboo, moon };

const cache = new Map<string, HTMLCanvasElement>();

/** 一处景的小画。kind 不认识的话画一块淡晕，至少看得出这里有东西 */
export function sightSprite(kind: string, id: string): HTMLCanvasElement {
  const key = kind + ':' + id;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = SIGHT_W * SCALE; cv.height = SIGHT_H * SCALE;
  const c = cv.getContext('2d')!;
  c.setTransform(SCALE, 0, 0, SCALE, (SIGHT_W / 2) * SCALE, (SIGHT_H / 2) * SCALE);
  (KINDS[kind] ?? ((cc) => wash(cc, 0, 0, 120, 90, 0.12)))(c, makeRng('sight:' + key));
  // 四边化开，贴到纸上没有硬边
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-in';
  const m = c.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.3, cv.width / 2, cv.height / 2, cv.width * 0.52);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = m; c.fillRect(0, 0, cv.width, cv.height);
  cache.set(key, cv);
  return cv;
}
