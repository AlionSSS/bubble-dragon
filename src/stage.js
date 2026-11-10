/** 每级晋级门槛：20, 28, 36, 44 … 逐级递增 */
const BASE_NEED = 20;
const NEED_STEP = 8;

export function createStage(diff) {
  const stage = {
    diff,
    level: 1,
    cleared: 0,
    need: BASE_NEED,
    colors: diff.colorsBase,
    pushGap: diff.pushBase,
    specialRate: diff.specialRate,
  };
  return stage;
}

function recompute(stage) {
  const d = stage.diff;
  stage.need = BASE_NEED + (stage.level - 1) * NEED_STEP;
  stage.colors = Math.min(d.colorsCap, d.colorsBase + Math.floor(stage.level / 3));
  stage.pushGap = Math.max(d.pushFloor, d.pushBase - stage.level);
  stage.specialRate = Math.min(0.2, d.specialRate + stage.level * 0.008);
}

/** 累计消除数，跨过门槛则升级。返回是否发生了升级。 */
export function addCleared(stage, count) {
  if (count <= 0) return false;
  stage.cleared += count;

  let leveled = false;
  while (stage.cleared >= stage.need) {
    stage.cleared -= stage.need;
    stage.level++;
    leveled = true;
    recompute(stage);
  }
  return leveled;
}

export function stageProgress(stage) {
  if (!stage) return 0;
  return Math.min(1, stage.cleared / stage.need);
}
