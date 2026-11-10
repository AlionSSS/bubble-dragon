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
   * 果冻质感 = 顶部高亮 + 底部内侧反光。
   * 只靠单一径向渐变会像弹珠，加一层从底部透出来的反光才有"凝胶"的通透感。
   */
  const body = g.createRadialGradient(-rr * 0.3, -rr * 0.4, rr * 0.06, 0, 0, rr);
  body.addColorStop(0, mix(baseColor, '#ffffff', 0.72));
  body.addColorStop(0.42, baseColor);
  body.addColorStop(1, mix(baseColor, '#2b4d72', 0.24));

  // clip 之后画的内容都被限制在球内，图标也不会溢出
  g.save();
  g.beginPath();
  g.arc(0, 0, rr, 0, Math.PI * 2);
  g.clip();

  g.fillStyle = body;
  g.fillRect(-rr, -rr, rr * 2, rr * 2);

  const rim = g.createRadialGradient(0, rr * 0.66, rr * 0.04, 0, rr * 0.66, rr * 0.9);
  rim.addColorStop(0, 'rgba(255,255,255,0.4)');
  rim.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rim;
  g.fillRect(-rr, -rr, rr * 2, rr * 2);

  if (style) {
    drawIcon(g, type, style.accent);
  } else {
    g.beginPath();
    g.ellipse(-rr * 0.3, -rr * 0.36, rr * 0.28, rr * 0.19, -0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.72)';
    g.fill();
  }

  g.restore();

  g.beginPath();
  g.arc(0, 0, rr * 0.985, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(45,75,115,0.22)';
  g.lineWidth = 1.3;
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

const PAUSE_ACTIONS = [
  { id: 'resume', label: '继续游戏' },
  { id: 'quit', label: '退出到菜单' },
];

export function pauseActions() {
  return PAUSE_ACTIONS.map((a, i) => ({
    ...a,
    x: (LOGICAL_W - 220) / 2,
    y: 306 + i * 74,
    w: 220,
    h: 58,
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
  drawShooter(view, state);
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

function drawMenu(view, state, input) {
  const { ctx } = view;

  drawMenuDeco(view);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 42px ${FONT}`;
  const titleGrad = ctx.createLinearGradient(0, 108, 0, 156);
  titleGrad.addColorStop(0, '#ff8fb0');
  titleGrad.addColorStop(1, '#5a9ae8');
  ctx.fillStyle = titleGrad;
  ctx.fillText('泡泡龙', LOGICAL_W / 2, 132);

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
    ctx.font = `700 21px ${FONT}`;
    // 难度色只做点缀，标题统一深蓝，避免四行不同颜色把页面搅花
    ctx.fillStyle = '#24406b';
    ctx.fillText(diff.name, b.x + 30, b.y + 32);

    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = hovered ? 'rgba(55,85,130,0.92)' : 'rgba(80,110,155,0.72)';
    ctx.fillText(diff.tag, b.x + 30, b.y + 52);

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

  const ceiling = grid.ceilingY();
  ctx.strokeStyle = 'rgba(90,135,200,0.38)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, ceiling);
  ctx.lineTo(LOGICAL_W, ceiling);
  ctx.stroke();

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

  for (const p of state.pops) {
    const remain = 1 - p.t / POP_TIME;
    drawBubble(view, p.x, p.y, p.color, Math.max(0, remain), 1 + (1 - remain) * 0.85);
  }

  for (const d of state.drops) {
    drawBubble(view, d.x, d.y, d.color, Math.max(0, 1 - d.life * 0.55));
  }

  if (state.particles) drawParticles(ctx, state.particles);

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

  // 连击：弹入 → 停留 → 淡出
  if (state.combo) {
    const c = state.combo;
    const enter = Math.min(1, c.t / 0.14);
    const scale = 0.62 + enter * 0.55;
    const fade = c.t < 0.62 ? 1 : Math.max(0, 1 - (c.t - 0.62) / 0.38);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(c.x, c.y);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 30px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeText(c.text, 0, 0);
    ctx.fillStyle = '#ff9f1a';
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
  ctx.beginPath();
  ctx.arc(x, y, R * 0.92 * pulse, 0, Math.PI * 2);
  ctx.fillStyle = tint ? withAlpha(tint, 0.28) : 'rgba(110,160,235,0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(75,125,205,0.8)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
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

function drawShooter(view, state) {
  const { ctx } = view;

  // 地面投影：让发射器「坐」在东西上，而不是浮在空白里
  ctx.beginPath();
  ctx.ellipse(SHOOTER_X, SHOOTER_Y + R * 1.6, R * 1.7, R * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(92,142,198,0.26)';
  ctx.fill();

  // 把当前球的颜色投到底座上：余光就能知道手里是什么球
  const cur = state.current;
  const tint = cur
    ? cur.color || (SPECIAL_STYLE[cur.type] ? SPECIAL_STYLE[cur.type].base : null)
    : null;

  if (tint) {
    ctx.fillStyle = shooterGlow(ctx, tint);
    ctx.beginPath();
    ctx.arc(SHOOTER_X, SHOOTER_Y, R * 2.7, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(SHOOTER_X, SHOOTER_Y, R * 1.46, 0, Math.PI * 2);
  // 底座也带一点蓝调，避免在蓝底上像一块突兀的白斑
  ctx.fillStyle = 'rgba(242,251,255,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,165,225,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.translate(SHOOTER_X, SHOOTER_Y);
  ctx.rotate(state.angle);
  ctx.fillStyle = 'rgba(108,152,222,0.5)';
  ctx.fillRect(-R * 0.45, -R * 2.35, R * 0.9, R * 1.75);
  ctx.restore();

  if (state.current) {
    drawBubble(view, SHOOTER_X, SHOOTER_Y, state.current.color, 1, 1, state.current.type);
  }

  // 往右挪开，避开底座的光晕；标签改到球下方，不再和球挤在一起
  const nx = SHOOTER_X + R * 3.5;
  const ny = SHOOTER_Y;
  if (state.next) {
    drawBubble(view, nx, ny, state.next.color, 0.95, 0.72, state.next.type);
  }

  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(52,84,132,0.92)';
  ctx.fillText('下一个', nx, ny + R * 1.1);
}

function drawHud(view, state, input) {
  const { ctx } = view;
  const stage = state.stage;

  ctx.fillStyle = 'rgba(233,247,255,0.84)';
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H);
  ctx.strokeStyle = 'rgba(120,160,220,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HUD_H - 0.5);
  ctx.lineTo(LOGICAL_W, HUD_H - 0.5);
  ctx.stroke();

  drawPauseButton(view, input);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = 'rgba(70,100,145,0.85)';
  ctx.fillText('分数', 58, 22);
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = '#22406b';
  ctx.fillText(String(state.score), 58, 47);

  const gap = stage ? stage.pushGap : 8;
  // 计数已改为浮点（消除只减半推进），显示时向上取整
  const remain = Math.max(0, Math.ceil(gap - state.shotsSincePush));
  const urgent = remain <= 2;
  const pulse = urgent ? 0.62 + 0.38 * Math.sin(performance.now() / 190) : 1;

  ctx.textAlign = 'right';
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = urgent ? '#ff9aae' : 'rgba(140,170,215,0.85)';
  ctx.fillText('距离下压', LOGICAL_W - 16, 22);
  ctx.globalAlpha = pulse;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = urgent ? '#e8557a' : '#22406b';
  ctx.fillText(`${remain} 发`, LOGICAL_W - 16, 46);
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

  ctx.fillStyle = 'rgba(216,238,252,0.95)';
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = '#22406b';
  ctx.fillText('已暂停', LOGICAL_W / 2, 206);

  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = 'rgba(70,100,145,0.8)';
  ctx.fillText(
    `关卡 ${state.stage ? state.stage.level : 1} · 分数 ${state.score}`,
    LOGICAL_W / 2,
    244
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
        : 'rgba(198,222,246,0.95)';
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

function drawBanner(view, state) {
  if (!state.banner) return;
  const { ctx } = view;
  const t = state.banner.t;
  const alpha = t < 0.18 ? t / 0.18 : Math.max(0, 1 - (t - 0.18) / 1);

  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 32px ${FONT}`;
  ctx.fillStyle = '#3f7ad0';
  ctx.fillText(state.banner.text, LOGICAL_W / 2, 210);
  ctx.globalAlpha = 1;
}

function drawGameOver(view, state, input) {
  const { ctx } = view;

  ctx.fillStyle = 'rgba(216,238,252,0.95)';
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillStyle = '#22406b';
  ctx.fillText('游戏结束', LOGICAL_W / 2, 210);

  if (state.newRecord) {
    ctx.globalAlpha = 0.72 + 0.28 * Math.sin(performance.now() / 220);
    ctx.font = `800 15px ${FONT}`;
    ctx.fillStyle = '#e8890c';
    ctx.fillText('新纪录', LOGICAL_W / 2, 250);
    ctx.globalAlpha = 1;
  }

  ctx.font = `700 50px ${FONT}`;
  ctx.fillStyle = '#e8890c';
  ctx.fillText(String(state.score), LOGICAL_W / 2, 296);

  const diff = state.difficulty;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = '#24406b';
  ctx.fillText(`${diff.name} · 第 ${state.stage ? state.stage.level : 1} 关`, LOGICAL_W / 2, 336);

  ctx.fillStyle = 'rgba(70,100,145,0.85)';
  ctx.fillText(`最高分 ${state.bests[diff.key] || 0}`, LOGICAL_W / 2, 360);

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
