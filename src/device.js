/** 低端机降级开关。只在启动时算一次，运行中不重算。 */
function detectLowEnd() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  return cores <= 2 || mem <= 2;
}

export const IS_LOW_END = detectLowEnd();

/** 3x 屏直接渲染会掉帧，极限压到 2 */
export const MAX_DPR = IS_LOW_END ? 1.5 : 2;

export const PARTICLE_CAP = IS_LOW_END ? 70 : 180;
export const PARTICLE_PER_POP = IS_LOW_END ? 6 : 11;

let lastHaptic = 0;

/**
 * 触觉反馈。iOS Safari 与桌面浏览器不支持 navigator.vibrate，
 * 调用是空操作，不需要额外判断平台。
 * 40ms 节流避免一次连消里多段震动叠在一起变成持续抖动。
 */
export function haptic(ms) {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  const now = performance.now();
  if (now - lastHaptic < 40) return;
  lastHaptic = now;
  try {
    navigator.vibrate(ms);
  } catch {
    /* 部分环境会因权限拒绝，忽略即可 */
  }
}
