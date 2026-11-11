import { LOGICAL_H, LOGICAL_W, SHOOTER_X, SHOOTER_Y } from './config.js';

/**
 * 统一指针层。Pointer Events 一套代码覆盖鼠标 / 触摸 / 笔：
 *   鼠标：悬停即瞄准，按下抬起发射
 *   触摸：按下确立方向，拖动调整，抬起发射
 */
export function createInput(view) {
  const canvas = view.canvas;

  const input = {
    x: SHOOTER_X,
    y: SHOOTER_Y - 220,
    /** 按下时的位置，用于区分「点按」与「拖动经过」，避免误触按钮 */
    downX: SHOOTER_X,
    downY: SHOOTER_Y - 220,
    dragging: false,
    fire: false,
    swap: false,
    keyLeft: false,
    keyRight: false,
    keyFire: false,
  };

  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? rect.width / LOGICAL_W : 1;
    const sy = rect.height > 0 ? rect.height / LOGICAL_H : 1;
    return {
      x: (e.clientX - rect.left) / sx,
      y: (e.clientY - rect.top) / sy,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      // 鼠标右键：快速换球
      e.preventDefault();
      input.swap = true;
      return;
    }
    if (e.button !== undefined && e.button !== 0) return;
    const p = toLogical(e);
    input.x = p.x;
    input.y = p.y;
    input.downX = p.x;
    input.downY = p.y;
    input.dragging = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持捕获 */
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!input.dragging) {
      if (e.pointerType !== 'mouse') return;
    }
    const p = toLogical(e);
    input.x = p.x;
    input.y = p.y;
  });

  function release(e) {
    if (!input.dragging) return;
    input.dragging = false;
    input.fire = true;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => {
    input.dragging = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (
      e.code === 'Tab' ||
      e.code === 'Space' ||
      e.code === 'KeyC' ||
      e.code === 'ArrowDown' ||
      e.code === 'KeyS'
    ) {
      e.preventDefault();
      input.swap = true;
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      input.keyLeft = true;
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      input.keyRight = true;
    } else if (e.code === 'Enter' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      input.keyFire = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      input.keyLeft = false;
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      input.keyRight = false;
    } else if (e.code === 'Enter' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      input.keyFire = false;
    }
  });

  return input;
}
