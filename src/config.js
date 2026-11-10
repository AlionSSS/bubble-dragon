/**
 * 全局常量。所有坐标都在 400x640 的逻辑分辨率下，CSS 负责等比缩放。
 * 调参只改这里。
 */

export const LOGICAL_W = 400;
export const LOGICAL_H = 640;

// ---- 网格几何 ----
export const PADDING_X = 8;
export const COLS = 9;
/** 泡泡半径由列数反推：列数属于玩法设计，不该随屏幕变化 */
export const R = (LOGICAL_W - PADDING_X * 2) / (COLS * 2);
export const DX = R * 2;
/** 行高被六边形几何锁死，不能独立压缩 */
export const DY = R * Math.sqrt(3);

// ---- 竖直分区 ----
export const HUD_H = 62;
export const PLAY_TOP = HUD_H;
export const DEATH_Y = LOGICAL_H - 104;
export const SHOOTER_X = LOGICAL_W / 2;
export const SHOOTER_Y = LOGICAL_H - 42;

// ---- 棋盘 ----
export const ROWS_INIT = 5;
/*
 * 糖果色系：饱和度压到 ~75%，明度抬高，和浅色页面同一调性。
 * 色相按 红→橙→青柠→绿→蓝→薰衣草→蜜桃 拉开，保证 7 色同场时仍可分辨。
 */
export const COLORS = [
  '#ea6a74',
  '#eda45a',
  '#bccc4f',
  '#4ec28e',
  '#4f9fe0',
  '#9a86d8',
  '#e67fb6',
];
export const COLOR_COUNT = COLORS.length;

// ---- 飞行 ----
export const SPEED = 900;
export const MAX_BOUNCE = 4;
export const MIN_AIM_DIST = 34;
/** 约 75.6°，避免贴地死角 */
export const MAX_ANGLE = 1.32;
/** 碰撞判定容差，略小于 2R 让贴合更紧凑 */
export const HIT_TOLERANCE = 0.92;

// ---- 计分 ----
export const SCORE_POP = 10;
export const SCORE_FLOAT = 25;
export const SCORE_CLEAR = 500;

export const STORAGE_KEY = 'bubble-dragon-best';
