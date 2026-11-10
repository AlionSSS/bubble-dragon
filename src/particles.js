/** 轻量粒子池。上限硬切断，避免炸弹清场时瞬间堆出上千个粒子。 */
export function createParticles(cap) {
  return { list: [], cap };
}

export function clearParticles(ps) {
  ps.list.length = 0;
}

export function emitBurst(ps, x, y, color, count) {
  const room = ps.cap - ps.list.length;
  const n = Math.min(count, Math.max(0, room));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 210;
    ps.list.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 40,
      life: 0,
      ttl: 0.32 + Math.random() * 0.34,
      size: 1.6 + Math.random() * 2.4,
      color,
    });
  }
}

export function updateParticles(ps, dt) {
  const list = ps.list;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life += dt;
    if (p.life >= p.ttl) {
      list.splice(i, 1);
      continue;
    }
    p.vy += 620 * dt;
    p.vx *= 1 - 2.2 * dt;
    p.vy *= 1 - 1.2 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

export function drawParticles(ctx, ps) {
  const list = ps.list;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const k = 1 - p.life / p.ttl;
    ctx.globalAlpha = k;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
