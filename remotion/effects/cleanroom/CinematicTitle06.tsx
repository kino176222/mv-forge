import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadCastoro } from "@remotion/google-fonts/Castoro";

/**
 * CinematicTitle06 — クリーンルーム再実装
 *
 * 荘厳にフェードして定位置に収まる、セリフ体のシネマティック・タイトル。
 *
 * 構成:
 * - セリフ体・全大文字の見出しを最大数行、画面中央（やや上寄り）に
 *   タイトなライン送りで積む。既定は白文字・黒背景前提の映画タイトル。
 *
 * 動き:
 * - 入場: 文字が行をまたいだ通し順で左から右へ1文字ずつ現れる。
 *   各文字はわずかに右下にオフセットした位置からブラーを残しつつ
 *   フェードインし、減速カーブで定位置に「収まる」。
 * - ホールド: 全文字が純白・シャープなまま静止。
 * - 退場: 入場と同じ通し順（左→右）で、ブラーを深めながら右下へ
 *   流れるようにフェードアウトする。
 *
 * 機能記述だけを設計の出発点とし、旧実装のレンダリング結果（見た目）を
 * 品質のものさしとして白紙から構成した。旧コード・定数は参照していない。
 *
 * 既定フォントは Google Fonts の Castoro を @remotion/google-fonts 経由で
 * バンドル読込するため、Mac 内蔵フォントに依存せず配布可能。
 */

const castoro = loadCastoro();

/** 配布可能な既定フォント（Castoro: クラシックなブックセリフ） */
const DEFAULT_FONT = `${castoro.fontFamily}, "Times New Roman", serif`;

export type CinematicTitleYZ4XProps = {
  /** タイトル文言。"\n" で複数行 */
  text?: string;
  /** 演出全体の尺（フレーム）。省略時はコンポジションの尺 */
  durationInFrames?: number;
  /** 基準文字サイズ(px, 1920幅基準で自動スケール) */
  fontSize?: number;
  /** フォント（既定は Castoro） */
  fontFamily?: string;
  /** 文字色 */
  color?: string;
  /** 行送り（em）。1未満でタイトに詰まる */
  lineHeightEm?: number;
  /** 字間（em） */
  letterSpacingEm?: number;
  /** ブロック中心の縦位置（0〜1、画面高比） */
  posY?: number;
  /** 全文を大文字化するか */
  uppercase?: boolean;
  /** 入場スイープが全文字を走り切る秒数 */
  inSeconds?: number;
  /** 退場スイープが全文字を走り切る秒数 */
  outSeconds?: number;
  /** 1文字のフェードに使う秒数 */
  charFadeSeconds?: number;
  /** 入退場時の水平ドリフト量(px, 右方向が正) */
  driftXPx?: number;
  /** 入退場時の垂直ドリフト量(px, 下方向が正) */
  driftYPx?: number;
  /** フェード端での最大ブラー半径(px) */
  maxBlurPx?: number;
  /** 文字の足元に落とす影の濃さ（0で無効） */
  shadowOpacity?: number;
};

type CharCell = {
  char: string;
  /** 行をまたいだ通し順（スイープの順番） */
  order: number;
};

/** テキストを行×文字に分解し、行をまたいだ通し順を振る */
const layoutChars = (text: string, uppercase: boolean): CharCell[][] => {
  const source = uppercase ? text.toUpperCase() : text;
  const rows: CharCell[][] = [];
  let order = 0;
  for (const line of source.split("\n")) {
    const row: CharCell[] = [];
    for (const char of Array.from(line)) {
      row.push({ char, order: char.trim() === "" ? -1 : order });
      if (char.trim() !== "") {
        order += 1;
      }
    }
    rows.push(row);
  }
  return rows;
};

export const CinematicTitle06: React.FC<CinematicTitleYZ4XProps> = ({
  text = "TWILIGHT\nCHAPTERS",
  durationInFrames,
  fontSize = 180,
  fontFamily = DEFAULT_FONT,
  color = "#ffffff",
  lineHeightEm = 0.94,
  letterSpacingEm = 0.005,
  posY = 0.485,
  uppercase = true,
  inSeconds = 1.4,
  outSeconds = 1.3,
  charFadeSeconds = 0.45,
  driftXPx = 24,
  driftYPx = 14,
  maxBlurPx = 12,
  shadowOpacity = 0.4,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  const rows = useMemo(() => layoutChars(text, uppercase), [text, uppercase]);
  const charCount = useMemo(
    () => rows.reduce((n, row) => n + row.filter((c) => c.order >= 0).length, 0),
    [rows]
  );

  const scale = width / 1920;
  const fadeFrames = Math.max(2, charFadeSeconds * fps);
  const inFrames = Math.max(fadeFrames + 1, inSeconds * fps);
  const outFrames = Math.max(fadeFrames + 1, outSeconds * fps);
  // スイープ全体からフェード分を引いた残りを文字数で割り、1文字あたりの遅延に
  const inStagger =
    charCount > 1 ? (inFrames - fadeFrames) / (charCount - 1) : 0;
  const outStagger =
    charCount > 1 ? (outFrames - fadeFrames) / (charCount - 1) : 0;
  const outStart = total - outFrames;

  const driftX = driftXPx * scale;
  const driftY = driftYPx * scale;
  const settleEase = Easing.out(Easing.cubic);
  const departEase = Easing.in(Easing.cubic);

  /** 通し順 order の文字の {opacity, dx, dy, blur} を返す */
  const charState = (order: number) => {
    // 入場: order 順に遅延してフェードイン（右下から定位置へ収まる）
    const inRaw = interpolate(
      frame,
      [order * inStagger, order * inStagger + fadeFrames],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const settle = settleEase(inRaw);

    // 退場: 同じ通し順でフェードアウト（右下へ抜ける）
    const outRaw = interpolate(
      frame,
      [outStart + order * outStagger, outStart + order * outStagger + fadeFrames],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const depart = departEase(outRaw);

    const presence = Math.min(settle, 1 - depart);
    const edge = Math.max(1 - settle, depart); // 端(未入場/退場中)ほど1
    return {
      opacity: presence,
      dx: edge * driftX,
      dy: edge * driftY,
      blur: edge * maxBlurPx * scale,
    };
  };

  const shadow =
    shadowOpacity > 0
      ? `0 ${3 * scale}px ${18 * scale}px rgba(0, 0, 0, ${shadowOpacity})`
      : undefined;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${posY * 100}%`,
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          whiteSpace: "pre",
          fontFamily,
          fontSize: fontSize * scale,
          lineHeight: lineHeightEm,
          letterSpacing: `${letterSpacingEm}em`,
          color,
          fontWeight: 400,
        }}
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex}>
            {row.map((cell, cellIndex) => {
              if (cell.order < 0) {
                return <span key={cellIndex}>{cell.char}</span>;
              }
              const { opacity, dx, dy, blur } = charState(cell.order);
              if (opacity <= 0.001) {
                // レイアウト維持のため透明のまま残す
                return (
                  <span
                    key={cellIndex}
                    style={{ display: "inline-block", opacity: 0 }}
                  >
                    {cell.char}
                  </span>
                );
              }
              return (
                <span
                  key={cellIndex}
                  style={{
                    display: "inline-block",
                    opacity,
                    transform: `translate(${dx}px, ${dy}px)`,
                    filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
                    textShadow: shadow,
                  }}
                >
                  {cell.char}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export default CinematicTitle06;
