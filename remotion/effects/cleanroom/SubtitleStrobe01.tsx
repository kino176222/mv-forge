/**
 * SubtitleStrobe01（クリーンルーム再実装）
 *
 * 機能: ストロボ点滅で現れ、点滅で消える極太ゴシックのテロップ。
 * - イン: 1フレーム刻み（既定）の完全な明滅（中間透明度なし）で点灯していく
 * - ホールド: 完全点灯のまま保持
 * - アウト: 同じ明滅で消灯し、最終フレームは消灯で終わる
 *
 * すべての見た目（文言・書体・サイズ・色・位置・字間・ストロボの長さと周期）を
 * props でパラメータ化。既定値のままで完成した見た目になる。
 * 副題スロット（subText）も任意で追加でき、位置・サイズ・色を個別に持つ。
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadDelaGothic } from "@remotion/google-fonts/DelaGothicOne";

// 旧既定はローカルインストール前提の 'Dela Gothic One'（フォールバックが Hiragino Sans）。
// 同じ書体を Google Fonts からロードし、配布ビルドでも同一の見た目を保証する。
const { fontFamily: DELA_GOTHIC } = loadDelaGothic("normal", {
  weights: ["400"],
  subsets: ["japanese", "latin", "latin-ext"],
});

export interface SubtitleStrobeG15GProps {
  /** 表示する文言。"\n" で複数行。 */
  text?: string;
  /** エフェクト全体の長さ（frames）。省略時はコンポジションの長さ。 */
  durationInFrames?: number;
  /** 書体（極太ゴシック想定） */
  fontFamily?: string;
  fontWeight?: React.CSSProperties["fontWeight"];
  /** 本文サイズ(px) */
  fontSize?: number;
  /** 文字色 */
  color?: string;
  /** 字間(em) */
  letterSpacingEm?: number;
  /** 行間（倍率） */
  lineHeight?: number;
  /** 横方向の位置。画面中央からのオフセット（画面幅に対する%） */
  posX?: number;
  /** 縦方向の位置。画面中央からのオフセット（画面高に対する%） */
  posY?: number;
  /** 横伸縮（1=等倍） */
  scaleX?: number;
  /** イン側ストロボの長さ(frames) */
  strobeInFrames?: number;
  /** アウト側ストロボの長さ(frames) */
  strobeOutFrames?: number;
  /** 明滅1ステップの長さ(frames)。1なら1フレーム刻み */
  strobePeriod?: number;
  /** 大文字化するか */
  uppercase?: boolean;
  /** 背景。既定は透過（重ね用途）。プレビューでは "#000" 等を渡す */
  background?: string;
  /** 副題（任意）。指定時のみ描画 */
  subText?: string;
  subFontSize?: number;
  subColor?: string;
  /** 副題の縦位置オフセット（画面高に対する%、本文基準ではなく画面基準） */
  subPosX?: number;
  subPosY?: number;
  subLetterSpacingEm?: number;
  /** 副題もストロボに同期させるか（false で常時表示側の演出はしない＝本文と同じ明滅） */
  subFontWeight?: React.CSSProperties["fontWeight"];
}

/**
 * ストロボの可視判定。中間透明度を使わない完全な二値明滅。
 * - イン区間: 消灯から始まり、period フレームごとに 点/消 を反転
 * - ホールド区間: 常時点灯
 * - アウト区間: 終端から逆向きに同じ規則（最終フレームは必ず消灯）
 */
function strobeVisible(
  frame: number,
  total: number,
  inFrames: number,
  outFrames: number,
  period: number
): boolean {
  const p = Math.max(1, Math.round(period));
  if (frame < inFrames) {
    // 偶数ステップ=消灯、奇数ステップ=点灯（f0 は消灯から）
    return Math.floor(frame / p) % 2 === 1;
  }
  const fromEnd = total - 1 - frame;
  if (fromEnd < outFrames) {
    // 終端フレーム(fromEnd=0)が消灯になるよう、逆向きに同じ規則
    return Math.floor(fromEnd / p) % 2 === 1;
  }
  return true;
}

export const SubtitleStrobe01: React.FC<SubtitleStrobeG15GProps> = ({
  text = "CAPTION",
  durationInFrames,
  fontFamily = `'${DELA_GOTHIC}', sans-serif`,
  fontWeight = 400,
  fontSize = 117,
  color = "#C4C2B6",
  letterSpacingEm = 0.027,
  lineHeight = 1.15,
  posX = 0,
  posY = 0,
  scaleX = 1,
  strobeInFrames = 8,
  strobeOutFrames = 8,
  strobePeriod = 1,
  uppercase = true,
  background = "transparent",
  subText,
  subFontSize = 44,
  subColor = "#C5C3B7",
  subPosX = 0,
  subPosY = 12,
  subLetterSpacingEm = 0.12,
  subFontWeight = 400,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  const visible = strobeVisible(
    frame,
    total,
    strobeInFrames,
    strobeOutFrames,
    strobePeriod
  );

  const lines = (uppercase ? text.toUpperCase() : text).split("\n");
  const subLines = subText
    ? (uppercase ? subText.toUpperCase() : subText).split("\n")
    : null;

  return (
    <AbsoluteFill style={{ background }}>
      {visible && (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            transform: `translate(${posX}%, ${posY}%)`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontWeight,
              fontSize,
              color,
              letterSpacing: `${letterSpacingEm}em`,
              // 末尾文字の letter-spacing で箱が右に広がる分を相殺して光学中央に
              paddingLeft: `${letterSpacingEm}em`,
              lineHeight,
              textAlign: "center",
              whiteSpace: "pre",
              transform: scaleX === 1 ? undefined : `scaleX(${scaleX})`,
            }}
          >
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </AbsoluteFill>
      )}
      {visible && subLines && (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            transform: `translate(${subPosX}%, ${subPosY}%)`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontWeight: subFontWeight,
              fontSize: subFontSize,
              color: subColor,
              letterSpacing: `${subLetterSpacingEm}em`,
              paddingLeft: `${subLetterSpacingEm}em`,
              lineHeight,
              textAlign: "center",
              whiteSpace: "pre",
            }}
          >
            {subLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

export default SubtitleStrobe01;
