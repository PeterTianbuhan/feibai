// 进度存在浏览器里。读写失败（无痕模式、存满了）就当没存，不影响玩。

import { parseSave, type Save } from '../core/progress';

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const browserStore: Store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 存不了就算了 */ } },
};

/** 只在内存里，截图用：每次都从一张白纸开始，不碰玩家的进度 */
export function memoryStore(): Store {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

// 游戏叫《飞白》（目录和包名暂时还叫 yibi）
const KEY = 'feibai.save.v1';
export const loadSave = (store: Store): Save => parseSave(store.get(KEY));
export const writeSave = (store: Store, save: Save) => store.set(KEY, JSON.stringify(save));
