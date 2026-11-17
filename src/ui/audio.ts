// 声音。外壳管开关和总线，世界自己决定什么时候出什么声。全是用代码合成的，不放音频文件。
// 这里有几样现成的音色（拨弦、一声风、一记闷响），世界也可以拿 ctx 和 out 自己接振荡器，
// 包括一直响着的底子（没人按键时这一页听起来的样子）。自己接的东西都接到 out 上：
// 静音、切到后台都是在 out 这里管的。一直响着的东西，要在 Painter.leave 里停掉。
// 浏览器要等用户按过一下才让出声，所以 ctx 一开始是 null，用 live 判断现在能不能出声。

const VOLUME = 0.6;

export class AudioKit {
  ctx: AudioContext | null = null;
  /** 世界的声音都接到这里，后面带一点回声 */
  out: GainNode | null = null;
  private quiet = false;
  private noise: AudioBuffer | null = null;

  /** 要在用户按了一下之后调，浏览器才让出声 */
  wake() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AC(), out = ac.createGain();
      out.gain.value = this.quiet ? 0 : VOLUME; out.connect(ac.destination);
      const dl = ac.createDelay(1), fb = ac.createGain(), lp = ac.createBiquadFilter();
      dl.delayTime.value = 0.29; fb.gain.value = 0.32; lp.type = 'lowpass'; lp.frequency.value = 1400;
      out.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(ac.destination);
      const buf = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate), d = buf.getChannelData(0);
      // 噪声的内容听不出差别，不用带种子
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ac; this.out = out; this.noise = buf;
    } catch {
      this.ctx = null;
    }
  }

  /** 现在能出声：用户按过了，而且没静音 */
  get live() {
    return !!this.ctx && !this.quiet;
  }

  get muted() {
    return this.quiet;
  }

  /** 静音压的是总线，世界自己接的、一直响着的东西也一起静下来 */
  set muted(on: boolean) {
    this.quiet = on;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 0 : VOLUME, this.ctx.currentTime, 0.03);
  }

  /** 页面切到后台就停，回来再接着响 */
  pause(on: boolean) {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend(); else void this.ctx.resume();
  }

  /** 拨一下弦 */
  pluck(freq: number, vol = 0.3, dur = 1.8, delay = 0) {
    if (!this.ctx || !this.out || this.muted) return;
    const ac = this.ctx, t = ac.currentTime + delay, g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(Math.min(5200, freq * 9), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 1.5), t + dur * 0.7);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const parts: [OscillatorType, number, number][] = [['triangle', 1, 1], ['sine', 2.003, 0.32], ['sawtooth', 1, 0.12]];
    for (const [type, mul, gv] of parts) {
      const o = ac.createOscillator(), og = ac.createGain();
      o.type = type; og.gain.value = gv;
      o.frequency.setValueAtTime(freq * mul * 1.014, t); o.frequency.exponentialRampToValueAtTime(freq * mul, t + 0.09);
      o.connect(og); og.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
    f.connect(g); g.connect(this.out);
  }

  /** 一声风：一小段带通的噪声往上扫 */
  swish(vol = 0.05, freq = 1900, dur = 0.16) {
    if (!this.ctx || !this.out || !this.noise || this.muted) return;
    const ac = this.ctx, t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(freq * 0.6, t); f.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + dur + 0.05);
  }

  /** 一记闷响 */
  thud() {
    if (!this.ctx || !this.out || this.muted) return;
    const ac = this.ctx, t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.32);
    this.swish(0.07, 700, 0.09);
  }
}
