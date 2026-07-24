/**
 * 行/カット画像のフレーミング（拡大して一部を使う）の純関数層。
 * 描画は「画像そのものを包む層」に transform を掛ける（CameraEffect/FxStack より内側）＝
 * 回転・シェイク等のエフェクトはフレーミング済みの絵に掛かる。
 */

export interface FramingStyle {
  transform: string;
  transformOrigin: string;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/**
 * フレーミングのCSS変形を返す。既定値（1x/0/0）は null＝従来経路そのまま（回帰ゼロ）。
 *
 * 黒縁ガード: 位置オフセットで画像端の外（黒）が見えないよう、
 * cover を保つ最小スケール 1 + 2*max(|x|,|y|)/100 を自動で下限にする
 * （scale s で中心拡大すると片側 (s-1)/2 の余りができ、x% ずらすと |x| > (s-1)/2*100 で端が出る）。
 * CSS は `translate(x%, y%) scale(s)`＝translateの%はレイアウト箱基準（scaleの影響を受けない）。
 */
export function framingTransform(
  scale: number | undefined,
  x: number | undefined,
  y: number | undefined,
): FramingStyle | null {
  const s0 = clamp(Number.isFinite(scale as number) ? (scale as number) : 1, 1, 3);
  const fx = clamp(Number.isFinite(x as number) ? (x as number) : 0, -50, 50);
  const fy = clamp(Number.isFinite(y as number) ? (y as number) : 0, -50, 50);
  if (s0 === 1 && fx === 0 && fy === 0) return null;
  const s = Math.max(s0, 1 + (2 * Math.max(Math.abs(fx), Math.abs(fy))) / 100);
  return {
    transform: `translate(${fx}%, ${fy}%) scale(${s})`,
    transformOrigin: "center",
  };
}

/**
 * ショート縦合成専用のフレーミング。
 * 横長画像を9:16縦枠に入れると cover で中央だけ残り左右が捨てられる。パンを
 * translate+scale でやると黒縁ガード（framingTransform）がズームを道連れにし、
 * 拡大せずに元絵の左端/右端へ到達できない。そこでショート時だけ役割を分離する:
 *   - パン = object-position（cover の切り抜き窓を動かす＝ズーム無し・黒帯無しで端まで滑る）
 *   - ズーム = wrapper の scale（従来どおり中心拡大）
 * frameX + で元絵の左を見せる（掴んで右へドラッグ＝左が出る の直感と一致）。
 * cover は常に枠を満たすので object-position では黒が出ず、黒縁ガードは不要。
 */
export interface ShortFramingStyle {
  /** media(Img/Video) の style.objectPosition に載せる（"x% y%"） */
  objectPosition: string;
  /** ズーム用 wrapper。等倍(1x)は null＝ラップしない */
  wrapper: FramingStyle | null;
}

export function framingShort(
  scale: number | undefined,
  x: number | undefined,
  y: number | undefined,
): ShortFramingStyle {
  const s0 = clamp(Number.isFinite(scale as number) ? (scale as number) : 1, 1, 3);
  const fx = clamp(Number.isFinite(x as number) ? (x as number) : 0, -50, 50);
  const fy = clamp(Number.isFinite(y as number) ? (y as number) : 0, -50, 50);
  // frameX +50 → 0%（元絵の左端）/ -50 → 100%（右端）/ 0 → 50%（中央）
  const objectPosition = `${50 - fx}% ${50 - fy}%`;
  const wrapper: FramingStyle | null =
    s0 > 1 ? { transform: `scale(${s0})`, transformOrigin: "center" } : null;
  return { objectPosition, wrapper };
}
