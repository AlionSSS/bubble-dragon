/**
 * WebAudio 合成音效，不依赖任何素材文件。
 * iOS/Safari 要求 AudioContext 必须在用户手势后创建或 resume，
 * 因此 unlockAudio() 只能在 pointerdown 之类的真实手势里调用。
 */
/** 全局音量，0~1。想让整体更响/更轻只改这一个数 */
const VOLUME = 0.9;
const MUTE_KEY = 'bubble-dragon-muted';

let ctx = null;
let master = null;
let noiseBuffer = null;
let lastPierce = 0;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === 'true';
} catch {
  muted = false;
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    /* ignore */
  }
  if (master && ctx) {
    master.gain.setValueAtTime(muted ? 0 : VOLUME, ctx.currentTime);
  }
  return muted;
}

/** 只有真正 running 且未静音时才发声 */
function ready() {
  return !muted && !!ctx && ctx.state === 'running';
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return;
  }

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;

    // 限幅器兜底：三消 + 掉落 + 爆炸同时响时，高音量下也不至于削波爆音
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    // Edge Android 等内核即使在手势里新建也停在 suspended，必须显式唤醒
    if (ctx.state !== 'running') ctx.resume().catch(() => {});

    const len = Math.floor(ctx.sampleRate * 0.8);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
  } catch {
    ctx = null;
  }
}

function tone({ from, to, type = 'sine', dur = 0.14, peak = 0.3, delay = 0 }) {
  if (!ready()) return;
  const t0 = ctx.currentTime + delay;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to && to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.4, peak = 0.5, from = 1800, to = 110 }) {
  if (!ready() || !noiseBuffer) return;
  const t0 = ctx.currentTime;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

export function sfxShoot() {
  tone({ from: 320, to: 640, type: 'triangle', dur: 0.09, peak: 0.3 });
}

/**
 * 一次消除会连续调用多次。用 step 做半音阶爬升，再靠 delay 逐个错开，
 * 听感上是一串上行的琶音，而不是同时发声糊成噪音。
 */
export function sfxPop(step = 0) {
  if (!ready()) return;
  const n = Math.min(step, 10);
  const freq = 523.25 * Math.pow(2, n / 12);
  tone({
    from: freq,
    to: freq * 1.5,
    type: 'triangle',
    dur: 0.09,
    peak: Math.max(0.1, 0.26 - n * 0.013),
    delay: n * 0.042,
  });
}

export function sfxDrop() {
  tone({ from: 420, to: 160, type: 'sine', dur: 0.26, peak: 0.25 });
}

export function sfxBomb() {
  // 手机外放对 100Hz 以下几乎没有响应，低频整体上移
  noise({ dur: 0.42, peak: 0.72, from: 1800, to: 140 });
  tone({ from: 190, to: 72, type: 'square', dur: 0.3, peak: 0.36 });
}

export function sfxPierce() {
  if (!ctx) return;
  const now = performance.now();
  if (now - lastPierce < 55) return;
  lastPierce = now;
  tone({ from: 700, to: 1560, type: 'sawtooth', dur: 0.12, peak: 0.2 });
}

export function sfxRainbow() {
  for (let i = 0; i < 4; i++) {
    const f = 660 * Math.pow(1.26, i);
    tone({ from: f, to: f * 1.04, type: 'sine', dur: 0.12, peak: 0.24, delay: i * 0.05 });
  }
}

export function sfxRewind() {
  tone({ from: 300, to: 720, type: 'sine', dur: 0.3, peak: 0.26 });
}

export function sfxStageUp() {
  const notes = [523, 659, 784, 1046];
  for (let i = 0; i < notes.length; i++) {
    tone({ from: notes[i], to: notes[i], type: 'triangle', dur: 0.16, peak: 0.28, delay: i * 0.09 });
  }
}

export function sfxGameOver() {
  const notes = [392, 330, 262];
  for (let i = 0; i < notes.length; i++) {
    tone({ from: notes[i], to: notes[i] * 0.94, type: 'sine', dur: 0.34, peak: 0.3, delay: i * 0.16 });
  }
}

export function sfxClick() {
  tone({ from: 520, to: 780, type: 'sine', dur: 0.07, peak: 0.25 });
}

export function sfxSwap() {
  tone({ from: 480, to: 720, type: 'sine', dur: 0.09, peak: 0.24 });
  tone({ from: 720, to: 960, type: 'triangle', dur: 0.07, peak: 0.16, delay: 0.03 });
}
