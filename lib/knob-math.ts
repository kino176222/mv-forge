/** つまみ調整の数値ロジック（KnobRow用の純関数。テスト対象） */

/** step の小数桁数（0.05 → 2） */
export function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** step グリッドに丸めて min..max に収める（浮動小数のゴミも落とす） */
export function clampToStep(v: number, min: number, max: number, step: number): number {
  const snapped = Math.round(v / step) * step;
  const fixed = Number(snapped.toFixed(stepDecimals(step)));
  return Math.min(max, Math.max(min, fixed));
}

/** ±ボタン1押し分。dir=+1/-1、mult=Shift押下時の倍率（既定10） */
export function nudgeValue(
  v: number,
  step: number,
  dir: 1 | -1,
  mult: number,
  min: number,
  max: number,
): number {
  return clampToStep(v + dir * step * mult, min, max, step);
}

/** 直接入力のパース。数値でなければ現在値を維持 */
export function parseKnobInput(
  raw: string,
  current: number,
  min: number,
  max: number,
  step: number,
): number {
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return current;
  return clampToStep(n, min, max, step);
}
