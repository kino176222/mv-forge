import type { TextStyle } from "@/lib/schema";

/**
 * テロップの定位置（貼り紙1枚方式）の可変オフセットを計算する純関数。
 * - 横書き … 画面「下」からの距離（bottom%）
 * - 縦書き … 画面「右」からの距離（right%）
 * を textStyle.posY(%) で連続的に動かせる（スライダー）。
 * prologue は演出上の専用位置で固定（本編テロップとは別扱い）。
 */
export function telopEdgePct(
  ts: Pick<TextStyle, "orientation" | "posY">,
  placement: "lyrics" | "prologue",
): string {
  if (placement === "prologue") {
    return ts.orientation === "vertical" ? "12%" : "44%";
  }
  const v = Math.min(100, Math.max(0, ts.posY));
  return `${v}%`;
}
