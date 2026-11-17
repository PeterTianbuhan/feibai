// 带种子的随机数。core 和布局里不用 Math.random，同一个种子永远出同一串数。

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [a, b) */
  range(a: number, b: number): number;
  /** 0..n-1 的整数 */
  int(n: number): number;
  /** 标准正态 */
  gauss(): number;
  /** 分出一个互不干扰的子序列，给某一段布局、某一处景单独用 */
  fork(label: number | string): Rng;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0;
  const base = a;
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (n) => Math.floor(next() * n),
    gauss: () => {
      const u = Math.max(next(), 1e-12), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    fork: (label) => makeRng(Math.imul(base ^ 0x9e3779b9, 2654435761) ^ (typeof label === 'string' ? hashStr(label) : Math.imul(label + 1, 40503))),
  };
}

/** 不带状态的小哈希，画面上要「同一处每帧都一样」的抖动用它 */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
