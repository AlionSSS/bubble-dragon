import {
  COLORS,
  COLOR_COUNT,
  DEATH_Y,
  DY,
  LOGICAL_H,
  LOGICAL_W,
  MAX_ANGLE,
  MIN_AIM_DIST,
  R,
  SCORE_CLEAR,
  SCORE_FLOAT,
  SCORE_POP,
  SHOOTER_X,
  SHOOTER_Y,
  SPEED,
  STORAGE_KEY,
} from './config.js';
import { Grid } from './grid.js';
import { collectFloating, collectSameColor, presentColors } from './logic.js';
import { hitCells, makeBall, setVelocity, stepBall, traceAim } from './flight.js';
import {
  createConfetti,
  createView,
  drawScene,
  hitGameOverAction,
  hitMenuButton,
  hitMuteButton,
  hitPauseAction,
  hitPauseButton,
  hitSwapButton,
  resizeView,
  updateConfetti,
} from './render.js';
import { createInput } from './input.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from './difficulty.js';
import { addCleared, createStage } from './stage.js';
import {
  BubbleType,
  collectBlast,
  dominantNeighborColor,
  pickSpecialType,
} from './specials.js';
import { clearParticles, createParticles, emitBurst, updateParticles } from './particles.js';
import { PARTICLE_CAP, PARTICLE_PER_POP, haptic } from './device.js';
import {
  sfxBomb,
  sfxClick,
  sfxDrop,
  sfxGameOver,
  sfxPierce,
  sfxPop,
  sfxRainbow,
  sfxRewind,
  sfxShoot,
  sfxStageUp,
  sfxSwap,
  toggleMute,
  unlockAudio,
} from './audio.js';

const POP_TIME = 0.32;
const RESOLVE_TIME = 0.26;
/** 下压/回升的滑动动画时长（指数衰减的时间常数） */
const PUSH_TIME = 0.22;

const canvas = document.getElementById('game');
const view = createView(canvas);
const input = createInput(view);

const state = {
  grid: new Grid(),
  mode: 'MENU',
  difficulty: null,
  stage: null,
  score: 0,
  bests: {},
  angle: 0,
  current: null,
  next: null,
  ball: null,
  shotsSincePush: 0,
  sinceSpecial: 0,
  resolveTimer: 0,
  aim: null,
  pops: [],
  drops: [],
  floats: [],
  shake: 0,
  banner: null,
  particles: createParticles(PARTICLE_CAP),
  newRecord: false,
  /** 暂停前所处的状态，恢复时原样返回 */
  resumeMode: 'AIMING',
  /** 本回合第几个被消除的泡泡，用于音阶爬升 */
  popStep: 0,
  combo: null,
  recoil: 0,
  swapAnim: 0,
  shockwaves: [],
  confetti: [],
  statsPopped: 0,
  statsMaxCombo: 1,
  streak: 0,
};

// ---------------------------------------------------------------- 取球

function randomColor() {
  const pool = presentColors(state.grid);
  if (pool.length === 0) {
    const n = state.stage ? state.stage.colors : COLOR_COUNT;
    return COLORS[(Math.random() * n) | 0];
  }
  return pool[(Math.random() * pool.length) | 0];
}

function rollShooter() {
  const diff = state.difficulty;
  const stage = state.stage;

  if (state.sinceSpecial >= diff.specialCooldown && Math.random() < stage.specialRate) {
    state.sinceSpecial = 0;
    return { type: pickSpecialType(), color: null };
  }
  state.sinceSpecial++;
  return { type: BubbleType.NORMAL, color: randomColor() };
}

// ---------------------------------------------------------------- 开局

function startGame(key) {
  const diff = DIFFICULTIES[key];
  state.difficulty = diff;
  state.stage = createStage(diff);
  state.grid.reset(diff.rows, diff.colorsBase);
  state.score = 0;
  state.ball = null;
  state.shotsSincePush = 0;
  // 负偏移保证开局前两发都是普通球，不会一上来就甩特殊球
  state.sinceSpecial = -diff.specialCooldown;
  state.resolveTimer = 0;
  state.shake = 0;
  state.banner = null;
  state.newRecord = false;
  state.resumeMode = 'AIMING';
  state.popStep = 0;
  state.combo = null;
  state.recoil = 0;
  state.swapAnim = 0;
  state.shockwaves.length = 0;
  state.confetti.length = 0;
  state.statsPopped = 0;
  state.statsMaxCombo = 1;
  state.streak = 0;
  state.pops.length = 0;
  state.drops.length = 0;
  state.floats.length = 0;
  clearParticles(state.particles);
  state.current = rollShooter();
  state.next = rollShooter();
  state.mode = 'AIMING';
  state.aim = traceAim(state.grid, state.angle, diff.aimBounce);
}

function gameOver() {
  const key = state.difficulty.key;
  const prevBest = state.bests[key] || 0;
  state.newRecord = state.score > prevBest;
  if (state.newRecord) {
    state.confetti = createConfetti();
  }
  const best = Math.max(prevBest, state.score);
  state.bests[key] = best;
  try {
    localStorage.setItem(STORAGE_KEY + key, String(best));
  } catch {
    /* 隐私模式下忽略 */
  }
  sfxGameOver();
  haptic(60);
  state.mode = 'GAMEOVER';
}

// ---------------------------------------------------------------- 发射与飞行

function fire() {
  if (state.mode !== 'AIMING' || !state.current) return;
  const bubble = state.current;
  const ball = makeBall(SHOOTER_X, SHOOTER_Y, bubble.color, bubble.type);
  setVelocity(ball, state.angle);
  state.ball = ball;

  state.current = state.next;
  state.next = rollShooter();
  state.aim = null;
  state.popStep = 0;
  state.recoil = 1.0;
  state.mode = 'FLYING';
  sfxShoot();
}

function updateFlying(dt) {
  const ball = state.ball;
  const diff = state.difficulty;

  // 兜底：任何异常路径都不该让球永久滞空并锁死输入
  ball.life = (ball.life || 0) + dt;
  if (ball.life > 6) {
    land(ball);
    return;
  }

  const dist = SPEED * dt;
  const stepLen = R * 0.4;
  const steps = Math.max(1, Math.ceil(dist / stepLen));
  const chunk = dist / steps;

  for (let i = 0; i < steps; i++) {
    const ev = stepBall(ball, chunk, state.grid);
    if (!ev || ev.type === 'wall') continue;

    // 触顶必须吸附。穿透球若在此处继续穿透会永远贴在天花板上，
    // 因为 stepBall 每步都把 y 钳回 ceiling + R 并持续返回 ceiling 事件。
    if (ev.type !== 'bubble') {
      land(ball);
      return;
    }

    // 穿透球边飞边清除，达到上限后转为正常吸附
    if (ball.type === BubbleType.PIERCER && ball.pierced < diff.pierceLimit) {
      const cells = hitCells(state.grid, ball.x, ball.y);
      if (cells.length === 0) {
        land(ball);
        return;
      }
      for (const c of cells) {
        if (popCell(c.col, c.row)) {
          ball.popped++;
          ball.pierced++;
        }
      }
      sfxPierce();
      if (ball.pierced >= diff.pierceLimit) {
        land(ball);
        return;
      }
      continue;
    }

    land(ball);
    return;
  }

  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > 7) ball.trail.shift();
}

// ---------------------------------------------------------------- 结算

function popCell(col, row) {
  const cell = state.grid.get(col, row);
  if (!cell) return false;
  const x = state.grid.cellX(col, row);
  const y = state.grid.cellY(row);
  state.pops.push({ x, y, color: cell.color, t: 0 });
  state.shockwaves.push({
    x,
    y,
    color: cell.color,
    r: R * 0.5,
    maxR: R * 2.2,
    t: 0,
    ttl: 0.22,
  });
  state.statsPopped = (state.statsPopped || 0) + 1;
  emitBurst(state.particles, x, y, cell.color, PARTICLE_PER_POP);
  sfxPop(state.popStep++);
  state.grid.set(col, row, null);
  return true;
}

function land(ball) {
  state.ball = null;
  const grid = state.grid;
  const diff = state.difficulty;

  // 穿透球不吸附，直接结算沿途战果
  if (ball.type === BubbleType.PIERCER) {
    finishTurn(ball.popped, ball.x, ball.y);
    return;
  }

  // 回退球：删掉顶部一行，天花板回升
  if (ball.type === BubbleType.REWIND) {
    const removed = grid.shiftRow();
    grid.offsetY += DY;
    const fx = SHOOTER_X;
    const fy = SHOOTER_Y - 96;
    state.floats.push({
      x: fx,
      y: fy,
      text: removed > 0 ? `天花板回升 +${removed}` : '已在顶部',
      t: 0,
    });
    sfxRewind();
    haptic(15);
    // 被顶掉的那行算作消除；删行后新的第 0 行天然成为天花板锚点，不会引发连锁悬空
    finishTurn(removed, fx, fy);
    return;
  }

  const snap = grid.findSnapCell(ball.x, ball.y) || grid.findSnapCell(ball.x, ball.y + R);
  if (!snap) {
    finishTurn(0, ball.x, ball.y);
    return;
  }

  const bx = grid.cellX(snap.col, snap.row);
  const by = grid.cellY(snap.row);

  // 炸弹球：以落点为圆心按六边形半径清场
  if (ball.type === BubbleType.BOMB) {
    const blast = collectBlast(grid, snap.col, snap.row, diff.blastRadius);
    let popped = 0;
    for (const c of blast) {
      if (popCell(c.col, c.row)) popped++;
    }
    state.shockwaves.push({
      x: bx,
      y: by,
      color: '#ffe58f',
      r: R * 0.8,
      maxR: R * 5.2,
      t: 0,
      ttl: 0.35,
    });
    state.shake = 12;
    sfxBomb();
    haptic(40);
    finishTurn(popped, bx, by);
    return;
  }

  // 彩虹球：取邻近最多颜色后按常规三消
  if (ball.type === BubbleType.RAINBOW) {
    // 周围没有球时退化为棋盘现存的随机色，否则这颗球会凭空消失且毫无反馈
    const color = dominantNeighborColor(grid, snap.col, snap.row) || randomColor();
    grid.set(snap.col, snap.row, { color });
    sfxRainbow();
    resolveColorAt(snap.col, snap.row);
    return;
  }

  grid.set(snap.col, snap.row, { color: ball.color });
  resolveColorAt(snap.col, snap.row);
}

function resolveColorAt(col, row) {
  const group = collectSameColor(state.grid, col, row);
  let popped = 0;
  if (group.length >= 3) {
    for (const g of group) {
      if (popCell(g.col, g.row)) popped++;
    }
  }
  finishTurn(popped, state.grid.cellX(col, row), state.grid.cellY(row));
}

function finishTurn(popped, fx, fy) {
  const diff = state.difficulty;
  const grid = state.grid;

  let dropped = 0;
  if (popped > 0) {
    const floating = collectFloating(grid);
    for (const f of floating) {
      const cell = grid.get(f.col, f.row);
      if (!cell) continue;
      state.drops.push({
        x: grid.cellX(f.col, f.row),
        y: grid.cellY(f.row),
        color: cell.color,
        vx: (Math.random() - 0.5) * 90,
        vy: -70 - Math.random() * 60,
        rot: 0,
        spin: (Math.random() - 0.5) * 8,
        life: 0,
      });
      grid.set(f.col, f.row, null);
      dropped++;
    }
  }

  if (dropped > 0) sfxDrop();

  const gain = Math.round((popped * SCORE_POP + dropped * SCORE_FLOAT) * diff.scoreMul);
  if (gain > 0) {
    state.score += gain;
    state.floats.push({ x: fx, y: fy, text: `+${gain}`, t: 0 });
  }

  if (popped > 0) {
    state.streak = (state.streak || 0) + 1;
  } else {
    state.streak = 0;
  }

  // 连击阶梯激励反馈（连续消除或单发大爆炸）
  if (popped >= 4 || state.streak >= 2) {
    const mul = Math.max(state.streak, Math.floor(popped / 3) + 1);
    if (mul > (state.statsMaxCombo || 1)) state.statsMaxCombo = mul;

    let label = 'Good!';
    if (mul >= 5 || popped >= 10) label = 'Incredible!';
    else if (mul >= 4 || popped >= 8) label = 'Awesome!';
    else if (mul >= 3 || popped >= 6) label = 'Great!';

    state.combo = {
      text: `${label} 连击 ×${mul}`,
      x: LOGICAL_W / 2,
      y: 248,
      t: 0,
    };
  }

  /*
   * 每发都推进下压进度，消除只能让它减半，不能清零。
   * 原先是「有消除就归零」，而正常玩家几乎每发都能消，导致天花板永远不下压，
   * 无尽模式完全没有压力。现在无论如何都会被追下来，只是快慢不同。
   */
  state.shotsSincePush += 1;
  if (popped > 0) {
    state.shotsSincePush = Math.max(0, state.shotsSincePush - 0.5);
    state.shake = Math.max(state.shake, Math.min(9, 2 + popped * 0.4));
    if (popped >= 3) haptic(popped >= 6 ? 25 : 15);
  }

  if (addCleared(state.stage, popped)) {
    state.banner = { text: `关卡提升 · 第 ${state.stage.level} 关`, t: 0 };
    state.shake = 9;
    sfxStageUp();
    haptic(20);
  }

  if (state.shotsSincePush >= state.stage.pushGap) {
    state.shotsSincePush = 0;
    // 顶部真实插入一行新球，同时把整体视觉偏移往回退一格，
    // 这样新行是从画面上方滑入的，而不是瞬间跳变
    grid.unshiftRow(state.stage.colors);
    grid.offsetY -= DY;
  }

  if (grid.isEmpty()) {
    state.score += SCORE_CLEAR;
    state.banner = { text: '★ 全屏清空 +500 ★', t: 0 };
    state.floats.push({ x: LOGICAL_W / 2, y: 300, text: `+${SCORE_CLEAR}`, t: 0 });
    state.confetti = createConfetti();
    state.shake = 12;
    sfxStageUp();
    haptic(40);
    grid.reset(diff.rows, state.stage.colors);
    state.shotsSincePush = 0;
  } else if (isDead()) {
    gameOver();
    return;
  }

  state.mode = 'RESOLVING';
  state.resolveTimer = RESOLVE_TIME;
}

function isDead() {
  let dead = false;
  state.grid.forEachBubble((_, col, row) => {
    if (state.grid.cellY(row) + R > DEATH_Y) dead = true;
  });
  return dead;
}

// ---------------------------------------------------------------- 每帧更新

function updateEffects(dt) {
  updateParticles(state.particles, dt);
  if (state.confetti && state.confetti.length > 0) {
    updateConfetti(state.confetti, dt);
  }

  if (state.recoil > 0) state.recoil = Math.max(0, state.recoil - dt * 6.5);
  if (state.swapAnim > 0) state.swapAnim = Math.max(0, state.swapAnim - dt * 6.0);

  for (let i = state.shockwaves.length - 1; i >= 0; i--) {
    const s = state.shockwaves[i];
    s.t += dt;
    if (s.t >= s.ttl) state.shockwaves.splice(i, 1);
  }

  /*
   * 下压/回升的滑动收尾：指数衰减逼近 0，正负偏移都能用同一套逻辑。
   * 衰减曲线天然是 easeOut，不需要额外维护动画进度状态。
   */
  if (state.grid.offsetY !== 0) {
    state.grid.offsetY *= Math.pow(0.01, dt / PUSH_TIME);
    if (Math.abs(state.grid.offsetY) < 0.4) state.grid.offsetY = 0;
  }

  for (let i = state.pops.length - 1; i >= 0; i--) {
    const p = state.pops[i];
    p.t += dt;
    if (p.t >= POP_TIME) state.pops.splice(i, 1);
  }

  for (let i = state.drops.length - 1; i >= 0; i--) {
    const d = state.drops[i];
    d.life += dt;
    d.vy += 1400 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.rot += d.spin * dt;
    if (d.y > LOGICAL_H - 8) {
      emitBurst(state.particles, d.x, LOGICAL_H - 8, d.color, 4);
      state.drops.splice(i, 1);
    }
  }

  for (let i = state.floats.length - 1; i >= 0; i--) {
    const f = state.floats[i];
    f.t += dt;
    f.y -= 36 * dt;
    if (f.t > 0.9) state.floats.splice(i, 1);
  }

  if (state.banner) {
    state.banner.t += dt;
    if (state.banner.t > 1.2) state.banner = null;
  }

  if (state.combo) {
    state.combo.t += dt;
    if (state.combo.t > 1) state.combo = null;
  }

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);
}

function angleFromInput() {
  const dx = input.x - SHOOTER_X;
  const dy = input.y - SHOOTER_Y;
  if (Math.hypot(dx, dy) < MIN_AIM_DIST) return state.angle;
  const a = Math.atan2(dx, -dy);
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, a));
}

function swapCurrentNext() {
  if (state.mode !== 'AIMING' || !state.current || !state.next) return;
  const tmp = state.current;
  state.current = state.next;
  state.next = tmp;
  state.swapAnim = 1.0;
  sfxSwap();
  haptic(12);
}

function update(dt) {
  // 全局静音按钮响应（菜单、游戏中、暂停、结束皆可点击）
  if (input.fire && hitMuteButton(input.downX, input.downY) && hitMuteButton(input.x, input.y)) {
    input.fire = false;
    toggleMute();
    return;
  }

  if (state.mode === 'PAUSED') {
    // 暂停时冻结一切，包括粒子和震屏
    if (input.fire) {
      input.fire = false;
      const action = hitPauseAction(input.x, input.y);
      if (action === 'resume') {
        state.mode = state.resumeMode || 'AIMING';
        if (state.mode === 'AIMING') {
          state.aim = traceAim(state.grid, state.angle, state.difficulty.aimBounce);
        }
      } else if (action === 'retry') {
        sfxClick();
        startGame(state.difficulty.key);
      } else if (action === 'quit') {
        state.mode = 'MENU';
      }
    }
    return;
  }

  if (state.mode === 'MENU') {
    if (input.fire) {
      input.fire = false;
      const key = hitMenuButton(input.x, input.y);
      if (key) {
        sfxClick();
        startGame(key);
      }
    }
    return;
  }

  updateEffects(dt);

  if (state.mode === 'GAMEOVER') {
    if (input.fire) {
      input.fire = false;
      const action = hitGameOverAction(input.x, input.y);
      if (action === 'retry') {
        sfxClick();
        startGame(state.difficulty.key);
      } else if (action === 'menu') {
        sfxClick();
        state.mode = 'MENU';
      }
    }
    return;
  }

  // 暂停按钮要求按下与抬起都落在按钮内，
  // 否则向下拖动瞄准时手指经过左上角会误触
  if (input.fire && hitPauseButton(input.downX, input.downY) && hitPauseButton(input.x, input.y)) {
    input.fire = false;
    state.resumeMode = state.mode;
    state.mode = 'PAUSED';
    return;
  }

  if (state.mode === 'AIMING') {
    if (input.swap) {
      input.swap = false;
      swapCurrentNext();
    }
    if (input.fire && hitSwapButton(input.downX, input.downY) && hitSwapButton(input.x, input.y)) {
      input.fire = false;
      swapCurrentNext();
      return;
    }

    if (input.keyLeft) {
      state.angle = Math.max(-MAX_ANGLE, state.angle - dt * 2.4);
    } else if (input.keyRight) {
      state.angle = Math.min(MAX_ANGLE, state.angle + dt * 2.4);
    } else if (!input.keyFire) {
      state.angle = angleFromInput();
    }
    state.aim = traceAim(state.grid, state.angle, state.difficulty.aimBounce);

    if (input.fire || input.keyFire) {
      input.fire = false;
      input.keyFire = false;
      fire();
    }
    return;
  }

  // 飞行与结算期间锁定输入，避免连点导致状态错乱
  input.fire = false;

  if (state.mode === 'FLYING') {
    updateFlying(dt);
    return;
  }

  if (state.mode === 'RESOLVING') {
    state.resolveTimer -= dt;
    if (state.resolveTimer <= 0) {
      state.mode = 'AIMING';
      state.aim = traceAim(state.grid, state.angle, state.difficulty.aimBounce);
    }
  }
}

// ---------------------------------------------------------------- 启动

let last = performance.now();

function loop(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  update(dt);
  drawScene(view, state, input);
  requestAnimationFrame(loop);
}

function onResize() {
  resizeView(view);
}

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

// 切到后台自动暂停：手机接电话、切应用回来时，不该发现已经被压死了
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (state.mode === 'MENU' || state.mode === 'GAMEOVER' || state.mode === 'PAUSED') return;
  state.resumeMode = state.mode;
  state.mode = 'PAUSED';
});

// iOS / Edge Android 的音频解锁必须在真实手势里，且各家认的事件不同，多绑几种
for (const type of ['pointerdown', 'touchstart', 'mousedown', 'keydown']) {
  window.addEventListener(type, unlockAudio, { passive: true, capture: true });
}

for (const key of DIFFICULTY_ORDER) {
  try {
    state.bests[key] = Number(localStorage.getItem(STORAGE_KEY + key) || 0) || 0;
  } catch {
    state.bests[key] = 0;
  }
}

requestAnimationFrame(loop);
