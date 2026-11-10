import { COLORS, COLOR_COUNT, COLS, DX, DY, PADDING_X, PLAY_TOP, R } from './config.js';

/**
 * 六边形网格（odd-row offset）：短行整体右移半格，且比长行少一个球。
 *
 * 邻接方向表由几何推导得出，改动前请先核对：
 *   短行右移 R 后，其上邻变为 (r-1, c) 与 (r-1, c+1)
 *   长行上邻为 (r-1, c) 与 (r-1, c-1)
 *
 * 关于 flip：
 *   「某行是长行还是短行」由 parity(row) 决定，而不是 row 本身的奇偶。
 *   在顶部插入/删除一行会让所有已有行的下标 +1/-1，如果直接按 row 取奇偶，
 *   一个 9 球的长行会突然被当成只能放 8 球的短行，整盘错位。
 *   flip 在每次增删行时翻转一次，使已有行的 parity 保持不变。
 */
export const DIRS_EVEN = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
];

export const DIRS_ODD = [
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, 0],
  [1, 1],
];

export class Grid {
  constructor() {
    /** cells[row][col] = { color } | null，row 0 是最靠近天花板的一行 */
    this.cells = [];
    /** 奇偶基准翻转标志，0 或 1 */
    this.flip = 0;
    /**
     * 整体的纵向视觉偏移，只用于下压/回升的滑动动画。
     * 必须参与 cellY 计算而不能只影响绘制，否则飞行中的球会撞到
     * 「看起来不存在」的位置，出现判定与画面不一致。
     */
    this.offsetY = 0;
  }

  /** 0 = 长行（COLS 个，左对齐）；1 = 短行（COLS-1 个，右移半格） */
  parity(row) {
    return (row + this.flip) & 1;
  }

  dirs(row) {
    return this.parity(row) === 0 ? DIRS_EVEN : DIRS_ODD;
  }

  rowWidth(row) {
    return this.parity(row) === 0 ? COLS : COLS - 1;
  }

  cellX(col, row) {
    return PADDING_X + R + col * DX + (this.parity(row) ? R : 0);
  }

  cellY(row) {
    return PLAY_TOP + R + row * DY + this.offsetY;
  }

  ceilingY() {
    return PLAY_TOP;
  }

  ensureRows(n) {
    while (this.cells.length < n) {
      const row = this.cells.length;
      this.cells.push(new Array(this.rowWidth(row)).fill(null));
    }
  }

  get(col, row) {
    if (row < 0 || row >= this.cells.length) return undefined;
    const line = this.cells[row];
    if (col < 0 || col >= line.length) return undefined;
    return line[col];
  }

  set(col, row, value) {
    if (row < 0) return false;
    if (col < 0 || col >= this.rowWidth(row)) return false;
    this.ensureRows(row + 1);
    this.cells[row][col] = value;
    return true;
  }

  isEmpty() {
    return this.cells.every((line) => line.every((c) => !c));
  }

  forEachBubble(fn) {
    for (let row = 0; row < this.cells.length; row++) {
      const line = this.cells[row];
      for (let col = 0; col < line.length; col++) {
        if (line[col]) fn(line[col], col, row);
      }
    }
  }

  reset(rows, colorCount = COLOR_COUNT) {
    this.cells = [];
    this.flip = 0;
    this.offsetY = 0;
    this.ensureRows(rows);
    for (let row = 0; row < rows; row++) {
      const line = this.cells[row];
      for (let col = 0; col < line.length; col++) {
        line[col] = { color: COLORS[(Math.random() * colorCount) | 0] };
      }
    }
  }

  /**
   * 在顶部插入一整行新泡泡，原有行整体下移一格。
   * 这就是「天花板下压」的真实表现：棋盘上的球数真的变多了。
   */
  unshiftRow(colorCount = COLOR_COUNT) {
    this.flip ^= 1;
    const width = this.rowWidth(0);
    const line = new Array(width);
    for (let col = 0; col < width; col++) {
      line[col] = { color: COLORS[(Math.random() * colorCount) | 0] };
    }
    this.cells.unshift(line);
    return line;
  }

  /** 删除顶部一行（天花板回升），返回被移除的球数 */
  shiftRow() {
    if (this.cells.length === 0) return 0;
    const line = this.cells.shift();
    this.flip ^= 1;
    return line.reduce((n, cell) => (cell ? n + 1 : n), 0);
  }

  /** 像素坐标 → 最近的网格槽位 */
  nearestCell(px, py) {
    let row = Math.round((py - PLAY_TOP - R - this.offsetY) / DY);
    if (row < 0) row = 0;
    const offset = this.parity(row) ? R : 0;
    const col = Math.round((px - PADDING_X - R - offset) / DX);
    return { col, row };
  }

  /** 在落点附近找「未被占用且距离最近」的空槽位 */
  findSnapCell(px, py) {
    const near = this.nearestCell(px, py);
    const cands = [{ col: near.col, row: near.row }];
    for (const [dr, dc] of this.dirs(near.row)) {
      cands.push({ col: near.col + dc, row: near.row + dr });
    }

    let best = null;
    let bestDist = Infinity;
    for (const c of cands) {
      if (c.row < 0 || c.col < 0) continue;
      if (c.col >= this.rowWidth(c.row)) continue;
      if (this.get(c.col, c.row)) continue;
      const dx = this.cellX(c.col, c.row) - px;
      const dy = this.cellY(c.row) - py;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }
}
