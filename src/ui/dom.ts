// 文字层的骨架。画布上的东西归世界的画法，这里只有字和按钮。

import './style.css';
import { LEVELS } from '../core/feel';
import type { Theme } from './look';

const HTML = `
<div id="title" class="layer">
  <div class="col"><h1>飞白</h1><p id="motto"></p><div class="dot"></div></div>
  <div id="levels">${LEVELS.map((l, i) => `<button data-lv="${i}">${l.name}</button>`).join('')}<button id="open-map" class="plain" hidden>地图</button></div>
  <div id="hint">点按 · 空格　离手</div>
</div>
<div id="hud" class="layer hidden">
  <div class="score" id="score"></div>
  <div class="bar" id="bar"><i id="resbar"></i></div>
  <button id="quit" class="plain" hidden>地图</button>
</div>
<div id="end" class="layer hidden">
  <div class="box">
    <div id="endline"></div>
    <div><button id="again">再来</button><button id="save">存画</button><button id="end-map">地图</button></div>
    <div class="keys">空格 另起一幅 · S 存画 · G 地图 · M 静音</div>
  </div>
</div>
<div id="map" class="layer hidden">
  <div class="head"><span id="map-name"></span></div>
  <div class="count" id="map-count"></div>
  <div class="worlds" id="map-worlds"></div>
  <div class="foot">点一个到过的大点　从那里起笔</div>
</div>
<div id="note" class="layer hidden"><span id="note-text"></span></div>`;

export function mountDom(still: boolean) {
  const host = document.createElement('div');
  host.innerHTML = HTML;
  document.body.append(...host.children);
  document.documentElement.classList.toggle('still', still);
}

export const $ = (id: string) => document.getElementById(id)!;
export const show = (id: string, on: boolean) => $(id).classList.toggle('hidden', !on);

export function applyTheme(t: Theme) {
  const s = document.documentElement.style;
  s.setProperty('--ground', t.ground); s.setProperty('--line', t.line);
  s.setProperty('--accent', t.accent); s.setProperty('--font', t.font);
}
