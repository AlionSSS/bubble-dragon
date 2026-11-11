import {
  DEATH_Y,
  HUD_H,
  LOGICAL_H,
  LOGICAL_W,
  PLAY_TOP,
  R,
  SHOOTER_X,
  SHOOTER_Y,
} from './config.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from './difficulty.js';
import { BubbleType } from './specials.js';
import { stageProgress } from './stage.js';
import { IS_LOW_END, MAX_DPR } from './device.js';
import { drawParticles } from './particles.js';
import { isMuted } from './audio.js';

const FONT = '"PingFang SC", ui-rounded, system-ui, -apple-system, sans-serif';
const SPRITE_PAD = 2;
const POP_TIME = 0.32;

/*
 * 普通球已经占满色相，特殊球改用「明度更低」来区分，
 * 配浅色图标；这样在浅色球堆里一眼能认出来，又不至于像脏点。
 */
const SPECIAL_STYLE = {
  bomb: { base: '#7d55b0', accent: '#ffe9a0' },
  piercer: { base: '#2f74a8', accent: '#e6faff' },
  rainbow: { base: '#6b5fb0', accent: '#ffffff' },
  rewind: { base: '#2f9070', accent: '#dcffe9' },
};

// ---------------------------------------------------------------- 画布与缩放

export function createView(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const view = { canvas, ctx, dpr: 1, scale: 1, bg: null };
  resizeView(view);

  // 中段不能太白，否则整屏失去色调；保持「浅蓝 → 浅蓝 → 淡粉」的层次
  const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
  grad.addColorStop(0, '#b6e3ff');
  grad.addColorStop(0.5, '#d4efff');
  grad.addColorStop(1, '#fce0ee');
  view.bg = grad;

  // 死线预警渐变预渲染一次，之后只靠 globalAlpha 调强弱，避免每帧新建对象
  const danger = ctx.createLinearGradient(0, DEATH_Y - 130, 0, DEATH_Y + 30);
  danger.addColorStop(0, 'rgba(255,90,120,0)');
  danger.addColorStop(0.7, 'rgba(255,90,120,0.34)');
  danger.addColorStop(1, 'rgba(255,90,120,0.8)');
  view.dangerGrad = danger;

  // HUD 与棋盘之间的柔和过渡，避免第一排球像被切掉半截
  const shade = ctx.createLinearGradient(0, PLAY_TOP, 0, PLAY_TOP + 22);
  shade.addColorStop(0, 'rgba(78,124,180,0.18)');
  shade.addColorStop(1, 'rgba(78,124,180,0)');
  view.topShade = shade;

  // 底部平台的渐隐带，给空旷的下半屏一个「地面」
  const plat = ctx.createLinearGradient(0, SHOOTER_Y - R * 2.2, 0, LOGICAL_H);
  plat.addColorStop(0, 'rgba(168,208,240,0)');
  plat.addColorStop(1, 'rgba(168,208,240,0.38)');
  view.bottomShade = plat;

  return view;
}

/**
 * 显示尺寸完全由 JS 计算成 px 写入 style，不使用 aspect-ratio / dvh / min()。
 * 夸克、UC 这类第三方内核上这些 CSS 特性会整条失效，导致 canvas 按原始像素
 * 尺寸渲染，画面上只能看到局部。
 */
export function resizeView(view) {
  const canvas = view.canvas;
  const stage = canvas.parentElement;

  const availW = stage ? stage.clientWidth : window.innerWidth;
  const availH = stage ? stage.clientHeight : window.innerHeight;

  // 桌面上不让它撑满整屏，留出装饰边距
  const MAX_CSS_W = 460;
  const fit = Math.min(availW / LOGICAL_W, availH / LOGICAL_H, MAX_CSS_W / LOGICAL_W);
  const cssW = Math.max(1, Math.floor(LOGICAL_W * fit));
  const cssH = Math.max(1, Math.floor(LOGICAL_H * fit));

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.round(LOGICAL_W * dpr);
  const h = Math.round(LOGICAL_H * dpr);

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  view.dpr = dpr;
  view.scale = fit;

  // 改动 canvas.width/height 会重置上下文状态，必须放在后面
  view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------- 泡泡精灵

const spriteSets = new Map();

function spriteSet(dpr) {
  let set = spriteSets.get(dpr);
  if (!set) {
    set = new Map();
    spriteSets.set(dpr, set);
  }
  return set;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function withAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)}, ${Math.round(
    A[1] + (B[1] - A[1]) * t
  )}, ${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

function drawIcon(g, type, accent) {
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (type === BubbleType.BOMB) {
    g.strokeStyle = accent;
    g.lineWidth = 2.4;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.33, Math.sin(a) * R * 0.33);
      g.lineTo(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62);
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, R * 0.25, 0, Math.PI * 2);
    g.fillStyle = accent;
    g.fill();
    return;
  }

  if (type === BubbleType.PIERCER) {
    g.strokeStyle = accent;
    g.lineWidth = 3;
    for (const off of [-R * 0.24, R * 0.22]) {
      g.beginPath();
      g.moveTo(-R * 0.34, off + R * 0.18);
      g.lineTo(0, off - R * 0.18);
      g.lineTo(R * 0.34, off + R * 0.18);
      g.stroke();
    }
    return;
  }

  if (type === BubbleType.RAINBOW) {
    const cols = ['#ff4d6d', '#ffc93c', '#6ee787', '#38c8ff', '#b18cff'];
    g.lineWidth = R * 0.1;
    for (let i = 0; i < cols.length; i++) {
      g.beginPath();
      g.arc(0, 0, R * (0.26 + i * 0.11), 0, Math.PI * 2);
      g.strokeStyle = cols[i];
      g.stroke();
    }
    return;
  }

  if (type === BubbleType.REWIND) {
    g.strokeStyle = accent;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-R * 0.3, -R * 0.08);
    g.lineTo(0, -R * 0.42);
    g.lineTo(R * 0.3, -R * 0.08);
    g.stroke();
    g.beginPath();
    g.moveTo(0, -R * 0.2);
    g.lineTo(0, R * 0.44);
    g.stroke();
  }
}

/** 每种颜色/类型只渲染一次，避免每帧 createRadialGradient 拖垮移动端 */
function createSprite(tint, dpr, type) {
  const style = SPECIAL_STYLE[type];
  const baseColor = style ? style.base : tint || '#888888';

  const size = R * 2 + SPRITE_PAD * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(size * dpr);
  cv.height = Math.ceil(size * dpr);

  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);

  const rr = R;

  /*
   * 水晶球通透质感：
   * 1. 顶部主高光光源定位在 (-0.32, -0.38)
   * 2. 中段基色与深邃底色
   * 3. 底部月牙形菲涅尔反光
   * 4. 辅助微晶高光点
   */
  const body = g.createRadialGradient(-rr * 0.32, -rr * 0.38, rr * 0.05, 0, 0, rr);
  body.addColorStop(0, mix(baseColor, '#ffffff', 0.8));
  body.addColorStop(0.38, baseColor);
  body.addColorStop(0.85, mix(baseColor, '#1c385b', 0.28));
  body.addColorStop(1, mix(baseColor, '#12253e', 0.45));

  // clip 之后画的内容都被限制在球内，图标也不会溢出
  g.save();
  g.beginPath();
  g.arc(0, 0, rr, 0, Math.PI * 2);
  g.clip();

  g.fillStyle = body;
  g.fillRect(-rr, -rr, rr * 2, rr * 2);

  // 底部月牙形内侧通透反光（菲涅尔光晕）
  const rim = g.createRadialGradient(rr * 0.2, rr * 0.6, rr * 0.06, 0, rr * 0.55, rr * 0.95);
  rim.addColorStop(0, 'rgba(255,255,255,0.48)');
  rim.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  rim.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rim;
  g.fillRect(-rr, -rr, rr * 2, rr * 2);

  if (style) {
    drawIcon(g, type, style.accent);
  } else {
    // 主高光：柔和倾斜胶囊椭圆
    const hiGrad = g.createLinearGradient(-rr * 0.5, -rr * 0.55, -rr * 0.1, -rr * 0.15);
    hiGrad.addColorStop(0, 'rgba(255,255,255,0.92)');
    hiGrad.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.beginPath();
    g.ellipse(-rr * 0.3, -rr * 0.36, rr * 0.3, rr * 0.18, -0.6, 0, Math.PI * 2);
    g.fillStyle = hiGrad;
    g.fill();

    // 次级微晶高光点（立体水珠质感）
    g.beginPath();
    g.arc(-rr * 0.08, -rr * 0.48, rr * 0.09, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fill();

    // 对角微弱边缘辅光
    g.beginPath();
    g.arc(rr * 0.42, rr * 0.42, rr * 0.11, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fill();
  }

  g.restore();

  // 晶莹薄膜外圈高光与柔和微描边
  g.beginPath();
  g.arc(0, 0, rr * 0.985, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 1.2;
  g.stroke();

  g.beginPath();
  g.arc(0, 0, rr * 0.985, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(35,65,105,0.2)';
  g.lineWidth = 1.0;
  g.stroke();

  return { canvas: cv, size };
}

export function drawBubble(view, x, y, color, alpha = 1, scale = 1, type = 'normal') {
  const { ctx } = view;
  const key = `${type}|${color || ''}`;
  const set = spriteSet(view.dpr);
  let sprite = set.get(key);
  if (!sprite) {
    sprite = createSprite(color, view.dpr, type);
    set.set(key, sprite);
  }

  const w = sprite.size * scale;
  const prev = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(sprite.canvas, x - w / 2, y - w / 2, w, w);
  if (alpha !== 1) ctx.globalAlpha = prev;
}

// ---------------------------------------------------------------- 菜单布局

const BTN_W = 300;
const BTN_H = 68;
const BTN_GAP = 14;
const BTN_TOP = 232;

export function menuButtons() {
  return DIFFICULTY_ORDER.map((key, i) => ({
    key,
    x: (LOGICAL_W - BTN_W) / 2,
    y: BTN_TOP + i * (BTN_H + BTN_GAP),
    w: BTN_W,
    h: BTN_H,
  }));
}

export function hitMenuButton(x, y) {
  for (const b of menuButtons()) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
  }
  return null;
}

// ---------------------------------------------------------------- 暂停

const PAUSE_BTN = { x: 12, y: 13, w: 34, h: 34 };

export function hitPauseButton(x, y) {
  return (
    x >= PAUSE_BTN.x &&
    x <= PAUSE_BTN.x + PAUSE_BTN.w &&
    y >= PAUSE_BTN.y &&
    y <= PAUSE_BTN.y + PAUSE_BTN.h
  );
}

export const MUTE_BTN = { x: LOGICAL_W - 46, y: 14, w: 34, h: 34 };

export function hitMuteButton(x, y) {
  return (
    x >= MUTE_BTN.x &&
    x <= MUTE_BTN.x + MUTE_BTN.w &&
    y >= MUTE_BTN.y &&
    y <= MUTE_BTN.y + MUTE_BTN.h
  );
}

export function hitSwapButton(x, y) {
  const cx = SHOOTER_X + R * 3.6;
  const cy = SHOOTER_Y - 4;
  return (
    Math.hypot(x - cx, y - cy) <= 34 ||
    (Math.abs(x - cx) <= 22 && y >= cy - 24 && y <= cy + 38)
  );
}

export function drawMuteButton(view, input, muted, customX, customY) {
  const { ctx } = view;
  const bx = customX !== undefined ? customX : MUTE_BTN.x;
  const by = customY !== undefined ? customY : MUTE_BTN.y;
  const cx = bx + 17;
  const cy = by + 17;
  const hovered =
    input && input.x >= bx && input.x <= bx + 34 && input.y >= by && input.y <= by + 34;

  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = hovered ? '#4b8fe8' : '#c9e3f9';
  ctx.fill();
  ctx.strokeStyle = hovered ? '#3a7ad6' : 'rgba(90,150,215,0.65)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 扬声器小图标
  ctx.save();
  ctx.fillStyle = hovered ? '#ffffff' : '#3a6fae';
  ctx.strokeStyle = hovered ? '#ffffff' : '#3a6fae';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 3.5);
  ctx.lineTo(cx - 4, cy - 3.5);
  ctx.lineTo(cx, cy - 7);
  ctx.lineTo(cx, cy + 7);
  ctx.lineTo(cx - 4, cy + 3.5);
  ctx.lineTo(cx - 7, cy + 3.5);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 4.5);
    ctx.lineTo(cx + 8, cy + 4.5);
    ctx.moveTo(cx + 8, cy - 4.5);
    ctx.lineTo(cx + 3, cy + 4.5);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx + 1, cy, 4.5, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 1, cy, 7.5, -Math.PI * 0.33, Math.PI * 0.33);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawShockwaves(ctx, shockwaves) {
  if (!shockwaves || shockwaves.length === 0) return;
  for (let i = 0; i < shockwaves.length; i++) {
    const s = shockwaves[i];
    const k = s.t / s.ttl;
    if (k >= 1) continue;
    const alpha = 1 - k;
    const r = s.r + (s.maxR - s.r) * Math.sin(k * Math.PI * 0.5);

    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = Math.max(1, (1 - k) * 3.8);
    ctx.strokeStyle = s.color || '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // 破裂微光
    if (k < 0.35) {
      ctx.globalAlpha = (0.35 - k) * 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 - k * 2.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function createConfetti() {
  const colors = [
    '#ea6a74',
    '#eda45a',
    '#bccc4f',
    '#4ec28e',
    '#4f9fe0',
    '#9a86d8',
    '#ff70a6',
    '#ffd166',
  ];
  const list = [];
  for (let i = 0; i < 50; i++) {
    const side = Math.random() < 0.5 ? 0 : 1;
    list.push({
      x: side === 0 ? Math.random() * 90 : LOGICAL_W - Math.random() * 90,
      y: 140 + Math.random() * 90,
      vx: (side === 0 ? 1 : -1) * (50 + Math.random() * 130),
      vy: -130 - Math.random() * 140,
      grav: 340 + Math.random() * 180,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 10,
      w: 6 + Math.random() * 5,
      h: 4 + Math.random() * 4,
      color: colors[(Math.random() * colors.length) | 0],
      life: 0,
      ttl: 2.2 + Math.random() * 1.4,
    });
  }
  return list;
}

export function updateConfetti(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life += dt;
    if (p.life >= p.ttl) {
      list.splice(i, 1);
      continue;
    }
    p.vy += p.grav * dt;
    p.vx *= 1 - 0.7 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
  }
}

export function drawConfetti(ctx, list) {
  if (!list || list.length === 0) return;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const k = 1 - p.life / p.ttl;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

const PAUSE_ACTIONS = [
  { id: 'resume', label: '继续游戏' },
  { id: 'retry', label: '重新开始' },
  { id: 'quit', label: '退出到菜单' },
];

export function pauseActions() {
  return PAUSE_ACTIONS.map((a, i) => ({
    ...a,
    x: (LOGICAL_W - 220) / 2,
    y: 266 + i * 62,
    w: 220,
    h: 50,
  }));
}

export function hitPauseAction(x, y) {
  for (const b of pauseActions()) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
  }
  return null;
}

const GAMEOVER_ACTIONS = [
  { id: 'retry', label: '再来一局' },
  { id: 'menu', label: '回到菜单' },
];

export function gameOverActions() {
  return GAMEOVER_ACTIONS.map((a, i) => ({
    ...a,
    x: (LOGICAL_W - 220) / 2,
    y: 404 + i * 66,
    w: 220,
    h: 56,
  }));
}

export function hitGameOverAction(x, y) {
  for (const b of gameOverActions()) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
  }
  return null;
}

// ---------------------------------------------------------------- 场景

export function drawScene(view, state, input) {
  const { ctx } = view;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.fillStyle = view.bg;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  if (state.mode === 'MENU') {
    drawMenu(view, state, input);
    return;
  }

  drawPlayfield(view, state);
  drawShooter(view, state, input);
  drawHud(view, state, input);
  drawBanner(view, state);

  if (state.mode === 'PAUSED') drawPaused(view, state, input);
  else if (state.mode === 'GAMEOVER') drawGameOver(view, state, input);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const DECO_BUBBLES = [
  { x: 52, y: 86, scale: 1.7, alpha: 0.26, speed: 0.42, phase: 0.0, amp: 13, color: '#ef5f68' },
  { x: 348, y: 72, scale: 1.5, alpha: 0.24, speed: 0.35, phase: 1.2, amp: 15, color: '#449ee0' },
  { x: 28, y: 208, scale: 1.3, alpha: 0.22, speed: 0.5, phase: 2.1, amp: 11, color: '#9680dd' },
  { x: 370, y: 236, scale: 1.2, alpha: 0.22, speed: 0.44, phase: 0.6, amp: 14, color: '#45c184' },
  { x: 34, y: 402, scale: 1.6, alpha: 0.26, speed: 0.38, phase: 3.0, amp: 12, color: '#f0a03c' },
  { x: 382, y: 424, scale: 1.4, alpha: 0.24, speed: 0.48, phase: 1.8, amp: 13, color: '#ea76b8' },
  { x: 66, y: 556, scale: 1.5, alpha: 0.25, speed: 0.4, phase: 2.6, amp: 12, color: '#449ee0' },
  { x: 332, y: 560, scale: 1.3, alpha: 0.22, speed: 0.46, phase: 0.9, amp: 14, color: '#f0a03c' },
  { x: 122, y: 50, scale: 1.1, alpha: 0.2, speed: 0.33, phase: 3.7, amp: 10, color: '#45c184' },
  { x: 284, y: 44, scale: 1.2, alpha: 0.2, speed: 0.36, phase: 2.3, amp: 11, color: '#9680dd' },
];

/** 位置直接由 performance.now() 算出来，不需要额外的动画状态 */
function drawMenuDeco(view) {
  const t = performance.now() / 1000;
  for (const d of DECO_BUBBLES) {
    const dx = Math.sin(t * d.speed + d.phase) * d.amp;
    const dy = Math.cos(t * d.speed * 0.8 + d.phase) * d.amp;
    drawBubble(view, d.x + dx, d.y + dy, d.color, d.alpha, d.scale);
  }
}

const DIFF_BADGES = {
  easy: '🌱 轻松',
  normal: '⚡ 普通',
  hard: '🔥 困难',
  hell: '💀 地狱',
};

function drawMenu(view, state, input) {
  const { ctx } = view;

  drawMenuDeco(view);
  drawMuteButton(view, input, isMuted());

  const titleBounce = Math.sin(performance.now() / 700) * 3;
  const titleY = 132 + titleBounce;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 42px ${FONT}`;
  const titleGrad = ctx.createLinearGradient(0, titleY - 24, 0, titleY + 24);
  titleGrad.addColorStop(0, '#ff7d9e');
  titleGrad.addColorStop(0.5, '#5aa0ee');
  titleGrad.addColorStop(1, '#477ec7');

  // 文字微阴影
  ctx.fillStyle = 'rgba(70,120,185,0.18)';
  ctx.fillText('泡泡龙', LOGICAL_W / 2, titleY + 3);

  ctx.fillStyle = titleGrad;
  ctx.fillText('泡泡龙', LOGICAL_W / 2, titleY);

  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = 'rgba(60,95,140,0.82)';
  ctx.fillText('无尽模式 · 选择难度', LOGICAL_W / 2, 176);

  const buttons = menuButtons();
  for (const b of buttons) {
    const diff = DIFFICULTIES[b.key];
    const hovered =
      input && input.x >= b.x && input.x <= b.x + b.w && input.y >= b.y && input.y <= b.y + b.h;

    /*
     * 不用彩色描边：四条不同颜色的细线排在一起会显得杂，
     * 改用向下偏移的柔和投影来交代边界，难度色只留给左侧色条。
     */
    roundRect(ctx, b.x, b.y + 4, b.w, b.h, 14);
    ctx.fillStyle = hovered ? 'rgba(90,140,205,0.26)' : 'rgba(110,155,210,0.18)';
    ctx.fill();

    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.fillStyle = hovered ? 'rgba(252,254,255,0.98)' : 'rgba(244,251,255,0.88)';
    ctx.fill();

    // 难度主题色条，让四档一眼可辨；hover 时略微加粗
    roundRect(ctx, b.x + 12, b.y + 14, hovered ? 7 : 6, b.h - 28, 3);
    ctx.fillStyle = diff.color;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = '#24406b';
    ctx.fillText(DIFF_BADGES[b.key] || diff.name, b.x + 28, b.y + 32);

    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = hovered ? 'rgba(55,85,130,0.92)' : 'rgba(80,110,155,0.72)';
    ctx.fillText(diff.tag, b.x + 28, b.y + 52);

    ctx.textAlign = 'right';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = '#c9861a';
    ctx.fillText(`最高 ${state.bests[b.key] || 0}`, b.x + b.w - 20, b.y + 38);
  }

  // 特殊泡泡图例
  const legend = [
    [BubbleType.BOMB, '炸弹'],
    [BubbleType.PIERCER, '穿透'],
    [BubbleType.RAINBOW, '彩虹'],
    [BubbleType.REWIND, '回退'],
  ];
  const step = 82;
  const startX = LOGICAL_W / 2 - (step * (legend.length - 1)) / 2;
  for (let i = 0; i < legend.length; i++) {
    const [type, label] = legend[i];
    const x = startX + i * step;
    drawBubble(view, x, 590, null, 1, 0.56, type);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = 'rgba(60,92,138,0.85)';
    ctx.fillText(label, x, 613);
  }
}

function drawCeiling(ctx, urgent) {
  const beamY = PLAY_TOP;
  const beamH = urgent ? 9 : 6;

  if (urgent) {
    const pulse = 0.72 + 0.28 * Math.sin(performance.now() / 140);

    // 1. 向下投射的危险警示红光（照亮最上方泡泡）
    ctx.save();
    const glowH = 34;
    const warnGlow = ctx.createLinearGradient(0, beamY, 0, beamY + glowH);
    warnGlow.addColorStop(0, `rgba(255, 45, 75, ${0.48 * pulse})`);
    warnGlow.addColorStop(1, 'rgba(255, 45, 75, 0)');
    ctx.fillStyle = warnGlow;
    ctx.fillRect(0, beamY, LOGICAL_W, glowH);
    ctx.restore();

    // 2. 警示条基底（深红底色）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, beamY, LOGICAL_W, beamH);
    ctx.clip();

    ctx.fillStyle = '#b71c1c';
    ctx.fillRect(0, beamY, LOGICAL_W, beamH);

    // 3. 动态流动的亮黄色工业警戒斜纹 (// // //)
    const stripeW = 14;
    const offset = (performance.now() / 25) % (stripeW * 2);
    ctx.fillStyle = '#ffea00';
    ctx.beginPath();
    for (let sx = -stripeW * 3 + offset; sx < LOGICAL_W + stripeW * 3; sx += stripeW * 2) {
      ctx.moveTo(sx, beamY + beamH);
      ctx.lineTo(sx + stripeW * 0.75, beamY + beamH);
      ctx.lineTo(sx + stripeW * 1.75, beamY);
      ctx.lineTo(sx + stripeW, beamY);
      ctx.closePath();
    }
    ctx.fill();

    // 4. 警报边框线
    ctx.strokeStyle = `rgba(255, 230, 80, ${pulse})`;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(0, beamY, LOGICAL_W, beamH);

    // 两侧危险警示小红灯（闪烁）
    const ledFlash = Math.sin(performance.now() / 120) > 0 ? '#ff1744' : '#ff8a80';
    ctx.fillStyle = ledFlash;
    ctx.beginPath();
    ctx.arc(8, beamY + beamH / 2, 2.5, 0, Math.PI * 2);
    ctx.arc(LOGICAL_W - 8, beamY + beamH / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  } else {
    // 正常金属滑轨
    ctx.fillStyle = 'rgba(180, 212, 242, 0.55)';
    ctx.fillRect(0, beamY, LOGICAL_W, beamH);
    ctx.strokeStyle = 'rgba(100, 150, 215, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, beamY, LOGICAL_W, beamH);

    // 金属铆钉
    ctx.fillStyle = 'rgba(80, 125, 185, 0.55)';
    for (let rx = 24; rx < LOGICAL_W; rx += 48) {
      ctx.beginPath();
      ctx.arc(rx, beamY + beamH / 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayfield(view, state) {
  const { ctx } = view;
  const grid = state.grid;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PLAY_TOP, LOGICAL_W, LOGICAL_H - PLAY_TOP);
  ctx.clip();

  if (state.shake > 0.2) {
    const s = state.shake;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  // 比 HUD 略深一档的蓝调底，让「顶部信息条 / 中部棋盘」有层次区分
  ctx.fillStyle = 'rgba(224,243,255,0.62)';
  ctx.fillRect(0, PLAY_TOP, LOGICAL_W, LOGICAL_H - PLAY_TOP);

  ctx.fillStyle = view.topShade;
  ctx.fillRect(0, PLAY_TOP, LOGICAL_W, 22);

  ctx.fillStyle = view.bottomShade;
  ctx.fillRect(0, SHOOTER_Y - R * 2.2, LOGICAL_W, LOGICAL_H - (SHOOTER_Y - R * 2.2));

  const gap = state.stage ? state.stage.pushGap : 8;
  const pushRemain = Math.max(0, Math.ceil(gap - state.shotsSincePush));
  const urgent = pushRemain <= 2;

  // 危险预警：最低的泡泡越接近死线，底部红光越强
  let lowest = 0;
  grid.forEachBubble((_, col, row) => {
    const y = grid.cellY(row) + R;
    if (y > lowest) lowest = y;
  });
  const warn = Math.max(0, Math.min(1, (lowest - (DEATH_Y - 96)) / 96));

  if (warn > 0.01) {
    const pulse = 0.78 + 0.22 * Math.sin(performance.now() / 300);
    ctx.globalAlpha = Math.min(1, warn * pulse);
    ctx.fillStyle = view.dangerGrad;
    ctx.fillRect(0, DEATH_Y - 130, LOGICAL_W, 160);
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = `rgba(235,75,110,${0.55 + warn * 0.4})`;
  ctx.lineWidth = 2 + warn * 1.5;
  ctx.beginPath();
  ctx.moveTo(0, DEATH_Y);
  ctx.lineTo(LOGICAL_W, DEATH_Y);
  ctx.stroke();
  ctx.restore();

  drawAim(view, state);

  grid.forEachBubble((cell, col, row) => {
    drawBubble(view, grid.cellX(col, row), grid.cellY(row), cell.color);
  });

  drawCeiling(ctx, urgent);

  for (const p of state.pops) {
    const remain = 1 - p.t / POP_TIME;
    drawBubble(view, p.x, p.y, p.color, Math.max(0, remain), 1 + (1 - remain) * 0.85);
  }

  for (const d of state.drops) {
    drawBubble(view, d.x, d.y, d.color, Math.max(0, 1 - d.life * 0.55));
  }

  if (state.particles) drawParticles(ctx, state.particles);
  if (state.shockwaves) drawShockwaves(ctx, state.shockwaves);

  const ball = state.ball;
  if (ball) {
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const k = (i + 1) / (ball.trail.length + 1);
      drawBubble(view, t.x, t.y, ball.color, 0.12 * k, 0.55 + k * 0.35, ball.type);
    }
    drawBubble(view, ball.x, ball.y, ball.color, 1, 1, ball.type);
  }

  for (const f of state.floats) {
    const alpha = Math.max(0, 1 - f.t / 0.9);
    ctx.globalAlpha = alpha;
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = '#e8890c';
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  // 连击：弹性弹入 → 停留 → 淡出
  if (state.combo) {
    const c = state.combo;
    const enter = Math.min(1, c.t / 0.12);
    const scale = c.t < 0.12 ? 0.5 + enter * 0.75 : Math.max(1, 1.25 - (c.t - 0.12) * 1.5);
    const fade = c.t < 0.68 ? 1 : Math.max(0, 1 - (c.t - 0.68) / 0.32);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(c.x, c.y);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 32px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeText(c.text, 0, 0);

    const comboGrad = ctx.createLinearGradient(0, -16, 0, 16);
    comboGrad.addColorStop(0, '#ffbe3b');
    comboGrad.addColorStop(1, '#ff6a00');
    ctx.fillStyle = comboGrad;
    ctx.fillText(c.text, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawAim(view, state) {
  if (state.mode !== 'AIMING' || !state.aim) return;
  const { ctx } = view;
  const { path, snap } = state.aim;
  if (path.length < 2) return;

  ctx.save();
  ctx.setLineDash([11, 10]);
  // 虚线流动需要每帧重算路径，低端机上直接关掉
  ctx.lineDashOffset = IS_LOW_END ? 0 : -(performance.now() / 42) % 21;
  ctx.strokeStyle = 'rgba(70,115,195,0.55)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.restore();

  // 墙面折射点光斑反馈
  if (path.length > 2) {
    ctx.save();
    for (let i = 1; i < path.length - 1; i++) {
      const pt = path[i];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(75,135,225,0.85)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  if (!snap) return;
  const x = state.grid.cellX(snap.col, snap.row);
  const y = state.grid.cellY(snap.row);

  // 落点用当前球的颜色半透明填充，一眼就知道「这颗球会落在哪、是什么色」
  const cur = state.current;
  const tint = cur
    ? cur.color || (SPECIAL_STYLE[cur.type] ? SPECIAL_STYLE[cur.type].base : null)
    : null;

  // 轻微呼吸，在满屏泡泡里更容易被一眼找到
  const pulse = 1 + 0.055 * Math.sin(performance.now() / 240);
  const targetR = R * 0.92 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, targetR, 0, Math.PI * 2);
  ctx.fillStyle = tint ? withAlpha(tint, 0.28) : 'rgba(110,160,235,0.16)';
  ctx.fill();
  ctx.strokeStyle = tint ? withAlpha(tint, 0.85) : 'rgba(75,125,205,0.8)';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 目标落点准星指示刻度
  ctx.save();
  ctx.strokeStyle = tint ? withAlpha(tint, 0.9) : 'rgba(75,125,205,0.9)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  const markLen = 4;
  ctx.beginPath();
  ctx.moveTo(x, y - targetR - markLen);
  ctx.lineTo(x, y - targetR + 1);
  ctx.moveTo(x, y + targetR - 1);
  ctx.lineTo(x, y + targetR + markLen);
  ctx.moveTo(x - targetR - markLen, y);
  ctx.lineTo(x - targetR + 1, y);
  ctx.moveTo(x + targetR - 1, y);
  ctx.lineTo(x + targetR + markLen, y);
  ctx.stroke();
  ctx.restore();
}

const glowCache = new Map();

function shooterGlow(ctx, color) {
  let g = glowCache.get(color);
  if (!g) {
    g = ctx.createRadialGradient(SHOOTER_X, SHOOTER_Y, R * 0.5, SHOOTER_X, SHOOTER_Y, R * 2.7);
    g.addColorStop(0, withAlpha(color, 0.46));
    g.addColorStop(0.55, withAlpha(color, 0.18));
    g.addColorStop(1, withAlpha(color, 0));
    glowCache.set(color, g);
  }
  return g;
}

function drawShooter(view, state, input) {
  const { ctx } = view;

  // 地面投影：让发射器「坐」在地面上，带有微渐变与阴影
  ctx.beginPath();
  ctx.ellipse(SHOOTER_X, SHOOTER_Y + R * 1.5, R * 1.8, R * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(70,110,165,0.22)';
  ctx.fill();

  // 把当前球的颜色投到底座上：余光就能知道手里是什么球
  const cur = state.current;
  const tint = cur
    ? cur.color || (SPECIAL_STYLE[cur.type] ? SPECIAL_STYLE[cur.type].base : null)
    : null;

  if (tint) {
    const pulse = 1 + 0.05 * Math.sin(performance.now() / 240);
    ctx.fillStyle = shooterGlow(ctx, tint);
    ctx.beginPath();
    ctx.arc(SHOOTER_X, SHOOTER_Y, R * 2.7 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // 机械罗盘底座：金属光泽、立体边缘与刻度环
  ctx.beginPath();
  ctx.arc(SHOOTER_X, SHOOTER_Y, R * 1.52, 0, Math.PI * 2);
  const baseGrad = ctx.createLinearGradient(
    SHOOTER_X - R,
    SHOOTER_Y - R,
    SHOOTER_X + R,
    SHOOTER_Y + R
  );
  baseGrad.addColorStop(0, '#fbfdff');
  baseGrad.addColorStop(0.5, '#e4f0fa');
  baseGrad.addColorStop(1, '#c8def4');
  ctx.fillStyle = baseGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(100,150,215,0.7)';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 底盘微刻度装饰（罗盘感）
  ctx.save();
  ctx.translate(SHOOTER_X, SHOOTER_Y);
  ctx.strokeStyle = 'rgba(120,165,225,0.6)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 1.28, Math.sin(a) * R * 1.28);
    ctx.lineTo(Math.cos(a) * R * 1.44, Math.sin(a) * R * 1.44);
    ctx.stroke();
  }
  ctx.restore();

  // 旋转炮管及发射后坐力（Recoil）
  const recoil = state.recoil || 0;
  const kick = recoil * 7; // 后坐力沿发射反向退移

  ctx.save();
  ctx.translate(SHOOTER_X, SHOOTER_Y);
  ctx.rotate(state.angle);

  // 炮管双导轨
  const railW = R * 0.28;
  const railLen = R * 2.35 - kick;
  const railGap = R * 0.44;

  // 导轨底层连接架
  ctx.fillStyle = 'rgba(125,170,230,0.5)';
  ctx.fillRect(-railGap - railW, -railLen * 0.7, (railGap + railW) * 2, railLen * 0.3);

  // 左导轨
  const railGradLeft = ctx.createLinearGradient(-railGap - railW, 0, -railGap, 0);
  railGradLeft.addColorStop(0, '#75a9e8');
  railGradLeft.addColorStop(0.5, '#d8ecff');
  railGradLeft.addColorStop(1, '#5089d0');
  ctx.fillStyle = railGradLeft;
  roundRect(ctx, -railGap - railW, -railLen, railW, railLen * 0.88, 3);
  ctx.fill();

  // 右导轨
  const railGradRight = ctx.createLinearGradient(railGap, 0, railGap + railW, 0);
  railGradRight.addColorStop(0, '#5089d0');
  railGradRight.addColorStop(0.5, '#d8ecff');
  railGradRight.addColorStop(1, '#75a9e8');
  ctx.fillStyle = railGradRight;
  roundRect(ctx, railGap, -railLen, railW, railLen * 0.88, 3);
  ctx.fill();

  // 炮口准星三角指针
  ctx.beginPath();
  ctx.moveTo(0, -railLen - 4);
  ctx.lineTo(-4, -railLen + 3);
  ctx.lineTo(4, -railLen + 3);
  ctx.closePath();
  ctx.fillStyle = '#4287dd';
  ctx.fill();

  ctx.restore();

  // 当前发射球（带换球/后坐力微位移）
  if (state.current) {
    const swapK = state.swapAnim || 0;
    const curScale = 1 - swapK * 0.2;
    drawBubble(
      view,
      SHOOTER_X,
      SHOOTER_Y + kick * 0.4,
      state.current.color,
      1,
      curScale,
      state.current.type
    );
  }

  // 备用球与换球交互台（Swap Pod）
  const nx = SHOOTER_X + R * 3.6;
  const ny = SHOOTER_Y - 4;
  const swapHover =
    input &&
    (Math.hypot(input.x - nx, input.y - ny) <= 30 ||
      (Math.abs(input.x - nx) <= 20 && input.y >= ny - 20 && input.y <= ny + 38));

  // 备用球底托盘
  ctx.beginPath();
  ctx.arc(nx, ny, R * 0.98, 0, Math.PI * 2);
  ctx.fillStyle = swapHover ? 'rgba(235,246,255,0.96)' : 'rgba(238,247,255,0.85)';
  ctx.fill();
  ctx.strokeStyle = swapHover ? '#3d82e2' : 'rgba(110,160,225,0.55)';
  ctx.lineWidth = swapHover ? 2 : 1.5;
  ctx.stroke();

  // 备用球绘制
  const nextScale = 0.72 + (state.swapAnim || 0) * 0.15;
  if (state.next) {
    drawBubble(view, nx, ny, state.next.color, 0.96, nextScale, state.next.type);
  }

  // 换球图标角标（双向箭头 ⇄）
  const badgeX = nx + R * 0.78;
  const badgeY = ny - R * 0.72;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = swapHover ? '#3d82e2' : '#579beb';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 箭头线条
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(badgeX - 4, badgeY - 2.2);
  ctx.lineTo(badgeX + 3.2, badgeY - 2.2);
  ctx.lineTo(badgeX + 1.2, badgeY - 4.2);
  ctx.moveTo(badgeX + 4, badgeY + 2.2);
  ctx.lineTo(badgeX - 3.2, badgeY + 2.2);
  ctx.lineTo(badgeX - 1.2, badgeY + 4.2);
  ctx.stroke();
  ctx.restore();

  // 标签胶囊按钮（独立于托盘圆环下方，与球体边界彻底留出间距）
  const pillY = ny + R * 1.48;
  const pillW = 40;
  const pillH = 16;
  const pillR = 8;
  roundRect(ctx, nx - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
  ctx.fillStyle = swapHover ? '#3d82e2' : 'rgba(218,238,255,0.92)';
  ctx.fill();
  ctx.strokeStyle = swapHover ? '#2c6ec7' : 'rgba(100,150,215,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `700 10.5px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = swapHover ? '#ffffff' : '#27528e';

  // 计算中文字形真实包围盒，彻底解决 Canvas middle baseline 在中文字符上偏上的排版问题
  const m = ctx.measureText('换球');
  const textY =
    m.actualBoundingBoxAscent !== undefined && m.actualBoundingBoxDescent !== undefined
      ? pillY + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
      : pillY + 3.5;

  ctx.fillText('换球', nx, textY);
}

function drawHud(view, state, input) {
  const { ctx } = view;
  const stage = state.stage;
  const gap = stage ? stage.pushGap : 8;
  const remain = Math.max(0, Math.ceil(gap - state.shotsSincePush));
  const urgent = remain <= 2;
  const pulse = urgent ? 0.62 + 0.38 * Math.sin(performance.now() / 190) : 1;

  ctx.fillStyle = 'rgba(233,247,255,0.88)';
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H);
  ctx.strokeStyle = urgent
    ? `rgba(255, 60, 90, ${0.5 + 0.5 * Math.sin(performance.now() / 140)})`
    : 'rgba(120,160,220,0.32)';
  ctx.lineWidth = urgent ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(0, HUD_H - 0.5);
  ctx.lineTo(LOGICAL_W, HUD_H - 0.5);
  ctx.stroke();

  drawPauseButton(view, input);
  drawMuteButton(view, input, isMuted());

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = 'rgba(70,100,145,0.85)';
  ctx.fillText('分数', 54, 22);
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = '#22406b';
  ctx.fillText(String(state.score), 54, 47);

  ctx.textAlign = 'right';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = urgent ? '#e8557a' : 'rgba(110,145,195,0.85)';
  ctx.fillText('距离下压', LOGICAL_W - 54, 22);
  ctx.globalAlpha = pulse;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = urgent ? '#e8557a' : '#22406b';
  ctx.fillText(`${remain} 发`, LOGICAL_W - 54, 46);
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = 'rgba(70,100,145,0.85)';
  ctx.fillText('关卡', LOGICAL_W / 2, 20);
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = '#2f5a9e';
  ctx.fillText(String(stage ? stage.level : 1), LOGICAL_W / 2, 41);

  const pw = 64;
  const px = LOGICAL_W / 2 - pw / 2;
  const py = 47;
  ctx.fillStyle = 'rgba(120,160,220,0.22)';
  ctx.fillRect(px, py, pw, 3);
  ctx.fillStyle = '#4b8fe8';
  ctx.fillRect(px, py, pw * stageProgress(stage), 3);
}

function drawPauseButton(view, input) {
  const { ctx } = view;
  const b = PAUSE_BTN;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const hovered =
    input && input.x >= b.x && input.x <= b.x + b.w && input.y >= b.y && input.y <= b.y + b.h;

  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  // HUD 是浅蓝底，按钮要靠更深的蓝才分得出来
  ctx.fillStyle = hovered ? '#4b8fe8' : '#c9e3f9';
  ctx.fill();
  ctx.strokeStyle = hovered ? '#3a7ad6' : 'rgba(90,150,215,0.65)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = hovered ? '#ffffff' : '#3a6fae';
  ctx.fillRect(cx - 5.5, cy - 6, 3.5, 12);
  ctx.fillRect(cx + 2, cy - 6, 3.5, 12);
}

function drawPaused(view, state, input) {
  const { ctx } = view;

  ctx.fillStyle = 'rgba(216,238,252,0.92)';
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 弹窗卡片浮雕背景
  const cardW = 276;
  const cardH = 348;
  const cardX = (LOGICAL_W - cardW) / 2;
  const cardY = 148;
  roundRect(ctx, cardX, cardY + 6, cardW, cardH, 20);
  ctx.fillStyle = 'rgba(80,125,185,0.18)';
  ctx.fill();

  roundRect(ctx, cardX, cardY, cardW, cardH, 20);
  ctx.fillStyle = 'rgba(246,252,255,0.98)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,165,225,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = '#22406b';
  ctx.fillText('游戏暂停', LOGICAL_W / 2, cardY + 44);

  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = 'rgba(70,100,145,0.85)';
  ctx.fillText(
    `第 ${state.stage ? state.stage.level : 1} 关 · 当前得分 ${state.score}`,
    LOGICAL_W / 2,
    cardY + 74
  );

  for (const b of pauseActions()) {
    const hovered =
      input && input.x >= b.x && input.x <= b.x + b.w && input.y >= b.y && input.y <= b.y + b.h;
    const primary = b.id === 'resume';

    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle = primary
      ? hovered
        ? '#5aa2f5'
        : '#4b8fe8'
      : hovered
        ? 'rgba(214,234,250,1)'
        : 'rgba(224,240,252,0.92)';
    ctx.fill();
    ctx.strokeStyle = primary ? 'rgba(60,120,200,0.6)' : 'rgba(120,160,215,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = primary ? '#ffffff' : '#32588c';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  }
}

function drawBanner(view, state) {
  if (!state.banner) return;
  const { ctx } = view;
  const t = state.banner.t;
  const alpha = t < 0.18 ? t / 0.18 : Math.max(0, 1 - (t - 0.18) / 1);

  ctx.save();
  ctx.globalAlpha = alpha;

  const bw = 220;
  const bh = 54;
  const bx = (LOGICAL_W - bw) / 2;
  const by = 196;

  roundRect(ctx, bx, by + 4, bw, bh, 16);
  ctx.fillStyle = 'rgba(60,110,185,0.22)';
  ctx.fill();

  roundRect(ctx, bx, by, bw, bh, 16);
  const grad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  grad.addColorStop(0, '#5aa4f8');
  grad.addColorStop(1, '#3b78dc');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 24px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(state.banner.text, LOGICAL_W / 2, by + bh / 2);
  ctx.restore();
}

function drawGameOver(view, state, input) {
  const { ctx } = view;

  ctx.fillStyle = 'rgba(216,238,252,0.95)';
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  if (state.confetti) drawConfetti(ctx, state.confetti);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillStyle = '#22406b';
  ctx.fillText('游戏结束', LOGICAL_W / 2, 204);

  if (state.newRecord) {
    ctx.globalAlpha = 0.72 + 0.28 * Math.sin(performance.now() / 220);
    ctx.font = `800 15px ${FONT}`;
    ctx.fillStyle = '#e8890c';
    ctx.fillText('★ 创下新纪录 ★', LOGICAL_W / 2, 244);
    ctx.globalAlpha = 1;
  }

  ctx.font = `700 50px ${FONT}`;
  ctx.fillStyle = '#e8890c';
  ctx.fillText(String(state.score), LOGICAL_W / 2, 290);

  const diff = state.difficulty;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = '#24406b';
  ctx.fillText(`${diff.name} · 第 ${state.stage ? state.stage.level : 1} 关`, LOGICAL_W / 2, 332);

  ctx.fillStyle = 'rgba(70,100,145,0.85)';
  ctx.fillText(`最高分 ${state.bests[diff.key] || 0}`, LOGICAL_W / 2, 354);

  if (state.statsPopped) {
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = 'rgba(80,120,175,0.78)';
    ctx.fillText(
      `消除 ${state.statsPopped} 颗 · 最大连击 ×${state.statsMaxCombo || 1}`,
      LOGICAL_W / 2,
      376
    );
  }

  for (const b of gameOverActions()) {
    const primary = b.id === 'retry';
    const hovered =
      input && input.x >= b.x && input.x <= b.x + b.w && input.y >= b.y && input.y <= b.y + b.h;

    let fill = 'rgba(198,222,246,0.95)';
    if (primary) fill = hovered ? '#5aa2f5' : '#4b8fe8';
    else if (hovered) fill = 'rgba(214,234,250,1)';

    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = primary ? 'rgba(60,120,200,0.6)' : 'rgba(120,160,215,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = primary ? '#ffffff' : '#3a5f92';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  }
}
