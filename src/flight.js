import {
  HIT_TOLERANCE,
  LOGICAL_W,
  MAX_BOUNCE,
  PADDING_X,
  R,
  SHOOTER_X,
  SHOOTER_Y,
} from './config.js';

export function makeBall(x, y, color, type = 'normal') {
  return { x, y, vx: 0, vy: -1, color, type, bounces: 0, pierced: 0, popped: 0, trail: [] };
}

/** angle: 0 表示正上方，正值向右 */
export function setVelocity(ball, angle) {
  ball.vx = Math.sin(angle);
  ball.vy = -Math.cos(angle);
}

/** 返回当前坐标下接触到的所有格子，穿透球据此逐个清除 */
export function hitCells(grid, x, y) {
  const near = grid.nearestCell(x, y);
  const limit = R * 2 * HIT_TOLERANCE;
  const limitSq = limit * limit;
  const out = [];

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const c = near.col + dc;
      const r = near.row + dr;
      if (!grid.get(c, r)) continue;
      const dx = grid.cellX(c, r) - x;
      const dy = grid.cellY(r) - y;
      if (dx * dx + dy * dy < limitSq) out.push({ col: c, row: r });
    }
  }
  return out;
}

/**
 * 推进一小步。返回命中的事件类型，未命中返回 null。
 * 只能以较小的步长调用（R * 0.4 左右），否则会穿透。
 */
export function stepBall(ball, len, grid) {
  ball.x += ball.vx * len;
  ball.y += ball.vy * len;

  const left = PADDING_X + R;
  const right = LOGICAL_W - PADDING_X - R;

  if (ball.x < left) {
    ball.x = left + (left - ball.x);
    ball.vx = Math.abs(ball.vx);
    ball.bounces++;
    return { type: 'wall' };
  }
  if (ball.x > right) {
    ball.x = right - (ball.x - right);
    ball.vx = -Math.abs(ball.vx);
    ball.bounces++;
    return { type: 'wall' };
  }

  const ceiling = grid.ceilingY();
  if (ball.y - R <= ceiling) {
    ball.y = ceiling + R;
    return { type: 'ceiling' };
  }

  if (hitCells(grid, ball.x, ball.y).length > 0) return { type: 'bubble' };
  return null;
}

/**
 * 瞄准线预测：模拟飞行直到命中，返回折线路径与吸附槽位。
 * 超过最大反弹次数则截断（此时 snap 为 null，UI 不画落点预览）。
 */
export function traceAim(grid, angle, maxBounce = MAX_BOUNCE) {
  const ball = makeBall(SHOOTER_X, SHOOTER_Y, null);
  setVelocity(ball, angle);

  const path = [{ x: ball.x, y: ball.y }];
  const stepLen = R * 0.45;

  for (let i = 0; i < 900; i++) {
    const ev = stepBall(ball, stepLen, grid);

    if (!ev) {
      if (i % 8 === 0) path.push({ x: ball.x, y: ball.y });
      continue;
    }

    if (ev.type === 'wall') {
      path.push({ x: ball.x, y: ball.y });
      if (ball.bounces > maxBounce) {
        return { path, snap: null, hit: 'limit' };
      }
      continue;
    }

    path.push({ x: ball.x, y: ball.y });
    return { path, snap: grid.findSnapCell(ball.x, ball.y), hit: ev.type };
  }

  return { path, snap: null, hit: 'limit' };
}
