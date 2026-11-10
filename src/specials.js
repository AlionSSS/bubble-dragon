export const BubbleType = {
  NORMAL: 'normal',
  BOMB: 'bomb',
  PIERCER: 'piercer',
  RAINBOW: 'rainbow',
  REWIND: 'rewind',
};

/** 权重按顺序累减，总和为 1 */
const SPECIAL_WEIGHTS = [
  [BubbleType.BOMB, 0.35],
  [BubbleType.PIERCER, 0.3],
  [BubbleType.RAINBOW, 0.25],
  [BubbleType.REWIND, 0.1],
];

export function pickSpecialType(rand = Math.random) {
  let r = rand();
  for (const [type, weight] of SPECIAL_WEIGHTS) {
    if (r < weight) return type;
    r -= weight;
  }
  return BubbleType.BOMB;
}

/**
 * 炸弹按六边形半径展开（不是像素圆形），视觉上更贴合网格。
 * 允许穿过空格扩散，否则爆炸范围会被空洞截断。
 */
export function collectBlast(grid, col, row, radius) {
  const seen = new Set([row * 1000 + col]);
  const queue = [{ col, row, dist: 0 }];
  const cells = [];

  while (queue.length) {
    const cur = queue.shift();
    if (grid.get(cur.col, cur.row)) cells.push({ col: cur.col, row: cur.row });
    if (cur.dist >= radius) continue;

    for (const [dr, dc] of grid.dirs(cur.row)) {
      const nc = cur.col + dc;
      const nr = cur.row + dr;
      if (nr < 0 || nc < 0 || nc >= grid.rowWidth(nr)) continue;
      const k = nr * 1000 + nc;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ col: nc, row: nr, dist: cur.dist + 1 });
    }
  }
  return cells;
}

/** 彩虹球定格后取邻近区域出现最多的颜色 */
export function dominantNeighborColor(grid, col, row) {
  const counts = new Map();
  for (const [dr, dc] of grid.dirs(row)) {
    const cell = grid.get(col + dc, row + dr);
    if (!cell) continue;
    counts.set(cell.color, (counts.get(cell.color) || 0) + 1);
  }

  let best = null;
  let bestCount = 0;
  for (const [color, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      best = color;
    }
  }
  return best;
}
