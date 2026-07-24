/**
 * トランジションの「ベルト」数理（純関数）。
 *
 * 出側（前区間A）と入側（次区間B）を1つの関数で同時に返すことで、
 * 「AとBが1本のベルトで密着して動く」ことを型で保証する。
 * 押し出し(push)・ホイップパン(whip-pan)の両側は、常に
 *   （動軸の）out = in − 100×方向
 * を満たす＝AとBの継ぎ目に隙間（黒帯）が生まれない。
 *
 * Remotionには依存させない（純JSのみ）。whip-pan の式は Transitions.tsx の
 * 現行実装（Easing.out(Easing.poly(5))＝1-(1-t)^5、rest、settle）と数値的に
 * 完全一致するよう明示式で書く。
 */

/** ％オフセット。動軸以外は0。 */
export interface BeltOffsets {
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** ease-in-out cubic（bezier(0.45,0,0.15,1)相当の緩急。単調・端点0/1）。 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** left/up = +1（負方向＝画面外へ退場）、right/down = −1。 */
function dirSign(direction: string): 1 | -1 {
  return direction === "right" || direction === "down" ? -1 : 1;
}
function isVertical(direction: string): boolean {
  return direction === "up" || direction === "down";
}

/**
 * 押し出し: BがtでどこまできたかとAの退場位置。
 * 常に out = in − 100×方向（1本のベルト）。
 * direction left = Bが右(+100)から現れて0へ、Aは0から左(−100)へ退場。
 */
export function pushBelt(t: number, direction: string): BeltOffsets {
  const e = easeInOutCubic(clamp01(t));
  const sign = dirSign(direction);
  const inAxis = sign * (1 - e) * 100;
  const outAxis = inAxis - sign * 100;
  return isVertical(direction)
    ? { inX: 0, inY: inAxis, outX: 0, outY: outAxis }
    : { inX: inAxis, inY: 0, outX: outAxis, outY: 0 };
}

/**
 * whip-pan: Bの現行式(rest/settle)と、それに密着ロックしたAの退場位置。
 * in（動軸）= sign*rest + settle ＝ Transitions.tsx の dx+settleX と一致。
 * out = in − 100×方向 ＝ settle中も密着（Bが揺り戻してもAとの継ぎ目に隙間が出ない）。
 * blur = 26*(1-e)（現行式。p.blur 乗算は呼び出し側で行う）。
 */
export function whipBelt(
  t: number,
  direction: string,
): BeltOffsets & { blur: number } {
  const tc = clamp01(t);
  const e = 1 - Math.pow(1 - tc, 5); // Easing.out(Easing.poly(5))
  const rest = (1 - e) * 100;
  const settle = Math.sin(tc * Math.PI * 2.5) * (1 - tc) * 6;
  const sign = dirSign(direction);
  const inAxis = sign * rest + settle;
  const outAxis = inAxis - sign * 100;
  const blur = 26 * (1 - e);
  return isVertical(direction)
    ? { inX: 0, inY: inAxis, outX: 0, outY: outAxis, blur }
    : { inX: inAxis, inY: 0, outX: outAxis, outY: 0, blur };
}

/**
 * 出側の演技窓。区間の末尾 transFrames ぶんが退場に使われる。
 * start = durFrames − transFrames（最小0）、frames = transFrames。
 */
export function exitWindow(
  durFrames: number,
  transFrames: number,
): { start: number; frames: number } {
  const frames = Math.max(0, transFrames);
  const start = Math.max(0, durFrames - frames);
  return { start, frames };
}
