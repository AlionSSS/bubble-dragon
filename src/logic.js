const key = (col, row) => row * 1000 + col;

/** 同色连通块（含自身），用于判定三消 */
export function collectSameColor(grid, col, row) {
  const origin = grid.get(col, row);
  if (!origin) return [];

  const target = origin.color;
  const seen = new Set([key(col, row)]);
  const group = [];
  const stack = [[col, row]];

  while (stack.length) {
    const [c, r] = stack.pop();
    group.push({ col: c, row: r });

    for (const [dr, dc] of grid.dirs(r)) {
      const nc = c + dc;
      const nr = r + dr;
      if (nr < 0) continue;
      const cell = grid.get(nc, nr);
      if (!cell || cell.color !== target) continue;
      const k = key(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nc, nr]);
    }
  }
  return group;
}

/** 从顶部行出发做可达性 BFS，返回所有失去悬挂的泡泡 */
export function collectFloating(grid) {
  const anchored = new Set();
  const stack = [];

  const topWidth = grid.rowWidth(0);
  for (let c = 0; c < topWidth; c++) {
    if (grid.get(c, 0)) {
      anchored.add(key(c, 0));
      stack.push([c, 0]);
    }
  }

  while (stack.length) {
    const [c, r] = stack.pop();
    for (const [dr, dc] of grid.dirs(r)) {
      const nc = c + dc;
      const nr = r + dr;
      if (nr < 0) continue;
      if (!grid.get(nc, nr)) continue;
      const k = key(nc, nr);
      if (anchored.has(k)) continue;
      anchored.add(k);
      stack.push([nc, nr]);
    }
  }

  const floating = [];
  grid.forEachBubble((_, c, r) => {
    if (!anchored.has(key(c, r))) floating.push({ col: c, row: r });
  });
  return floating;
}

/** 棋盘上现存的颜色集合，确保发射球不会抽到已不存在的颜色 */
export function presentColors(grid) {
  const set = new Set();
  grid.forEachBubble((cell) => set.add(cell.color));
  return [...set];
}
