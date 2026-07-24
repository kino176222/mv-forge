/**
 * SubtitleKaraoke01（クリーンルーム再実装 / 配布可能ライン）
 *
 * 機能: 白い極太コンデンス大文字の歌詞テロップを、黄色のカラオケハイライトが
 * 左から右へ塗っていく字幕。文字は左から順に素早くフェードインし、
 * 表示終わりも左から順にフェードアウトする。控えめなグローが乗る。
 *
 * 実装は機能記述と自前レンダリングの見た目比較のみを根拠にした白紙書き起こし。
 * 旧ポートのコード・定数は参照していない。
 *
 * タイムライン（既定値, durationInFrames=D, fps基準）:
 *   0            … 文字が左から順にポップイン（約0.2秒で全字出揃う）
 *   fillStart    … カラオケ塗り開始（既定 0.5秒地点）
 *   fillEnd      … 塗り完了（既定 D-0.5秒地点）。行ごとに等分割で順番に塗る
 *   outStart     … 左から順にフェードアウト開始（既定 fillEndと同時）
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Anton";

const { fontFamily: ANTON } = loadFont("normal", {
  weights: ["400"],
  subsets: ["latin"],
});

export type SubtitleKaraoke01Props = {
  /** 表示テキスト。改行(\n)で複数行 */
  text: string;
  /** この字幕の表示フレーム数 */
  durationInFrames: number;

  // ---- レイアウトのつまみ ----
  /** フォントサイズ(px)。既定は1920x1080で2行がほぼ全幅になる大きさ */
  fontSize?: number;
  /** フォントファミリー。既定はAnton（極太コンデンス） */
  fontFamily?: string;
  /** 行の詰まり具合（fontSizeに対する倍率） */
  lineHeight?: number;
  /** 字間（em推奨, 例 "0.01em"） */
  letterSpacing?: string | number;
  /** 大文字化するか（既定true。歌詞テロップの定番） */
  uppercase?: boolean;
  /** 画面中央からの位置オフセット(px) */
  posX?: number;
  posY?: number;
  /** 行揃え */
  textAlign?: "left" | "center" | "right";

  // ---- 色のつまみ ----
  /** 塗られる前の文字色 */
  baseColor?: string;
  /** カラオケハイライト色 */
  fillColor?: string;
  /** グローの強さ 0(無し)〜1(強め)。既定は控えめ */
  glow?: number;

  // ---- タイミングのつまみ（すべてフレーム単位） ----
  /** 全文字が出揃うまでのおおよその窓。既定 fps*0.2（約0.2秒） */
  inWindow?: number;
  /** 1文字あたりのフェードイン時間 */
  charFade?: number;
  /** カラオケ塗り開始フレーム。既定 fps*0.5 */
  fillStart?: number;
  /** カラオケ塗り完了フレーム。既定 durationInFrames - fps*0.5 */
  fillEnd?: number;
  /** フェードアウト開始フレーム。既定 fillEnd と同時 */
  outStart?: number;
  /** フェードアウトの1文字あたりのずらし量 */
  outStagger?: number;
  /** 1文字あたりのフェードアウト時間 */
  outFade?: number;
};

/** 文字列を「そのまま描く1文字」の配列へ（スペースも保持） */
const toChars = (line: string): string[] => Array.from(line);

export const SubtitleKaraoke01: React.FC<SubtitleKaraoke01Props> = ({
  text,
  durationInFrames,
  fontSize = 302,
  fontFamily,
  lineHeight = 0.98,
  letterSpacing = "0em",
  uppercase = true,
  posX = 0,
  posY = 0,
  textAlign = "center",
  baseColor = "#FFFFFF",
  fillColor = "#FFEB69",
  glow = 0.5,
  inWindow,
  charFade = 0.5,
  fillStart,
  fillEnd,
  outStart,
  outStagger = 0.9,
  outFade = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = text.split("\n").map(toChars);
  const totalChars = lines.reduce((n, l) => n + l.length, 0);
  if (totalChars === 0) return null;

  // タイミング既定値（fps・尺に対して相対で決める）
  // charFade/outFade=0 や fillEnd===fillStart のような入力でも interpolate が
  // [x,x] で throw しないよう、微小な下限を保証する（既定値では効かない）。
  const inWin = inWindow ?? Math.max(2, Math.round(fps * 0.2));
  const inStagger = inWin / totalChars;
  const fillT0 = fillStart ?? Math.round(fps * 0.5);
  const fillT1 = Math.max(
    fillT0 + 1e-4,
    fillEnd ?? Math.max(fillT0 + 1, durationInFrames - Math.round(fps * 0.5)),
  );
  const outT0 = outStart ?? fillT1;
  const charFadeSafe = Math.max(1e-4, charFade);
  const outFadeSafe = Math.max(1e-4, outFade);

  // 行単位のカラオケ塗り: fillT0→fillT1 を行数で等分し、順番に左→右へ
  const lineFill = (lineIndex: number): number => {
    const win = (fillT1 - fillT0) / lines.length;
    const t0 = fillT0 + lineIndex * win;
    return interpolate(frame, [t0, t0 + win], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  };

  // 文字単位の出入り（globalIndex は行をまたいで左上→右下に増える）
  const charOpacity = (globalIndex: number): number => {
    const tIn = globalIndex * inStagger;
    const oIn = interpolate(frame, [tIn, tIn + charFadeSafe], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const tOut = outT0 + globalIndex * outStagger;
    const oOut = interpolate(frame, [tOut, tOut + outFadeSafe], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return oIn * oOut;
  };

  // グロー（控えめ2層）。0で完全に無効
  const glowShadow = (color: string): string | undefined =>
    glow <= 0
      ? undefined
      : `0 0 0.04em ${withAlpha(color, 0.45 * glow)}, 0 0 0.12em ${withAlpha(
          color,
          0.6 * glow,
        )}`;

  const family = fontFamily ?? ANTON;

  const lineBase: React.CSSProperties = {
    fontFamily: family,
    fontWeight: 400,
    fontSize,
    lineHeight,
    letterSpacing,
    textTransform: uppercase ? "uppercase" : "none",
    whiteSpace: "pre",
  };

  let running = 0; // 行頭ごとの global char index

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems:
          textAlign === "left"
            ? "flex-start"
            : textAlign === "right"
              ? "flex-end"
              : "center",
        flexDirection: "column",
        transform: `translate(${posX}px, ${posY}px)`,
      }}
    >
      {lines.map((chars, li) => {
        const startIndex = running;
        running += chars.length;
        const p = lineFill(li);
        const renderChars = (color: string) =>
          chars.map((ch, ci) => (
            <span
              key={ci}
              style={{
                opacity: charOpacity(startIndex + ci),
                textShadow: glowShadow(color),
              }}
            >
              {ch}
            </span>
          ));
        return (
          <div key={li} style={{ position: "relative" }}>
            {/* 下地（塗られる前の色） */}
            <div style={{ ...lineBase, color: baseColor }}>
              {renderChars(baseColor)}
            </div>
            {/* カラオケハイライト（左→右のワイプ） */}
            {p > 0 && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: `inset(-0.3em ${(1 - p) * 100}% -0.3em -0.3em)`,
                }}
              >
                <div style={{ ...lineBase, color: fillColor }}>
                  {renderChars(fillColor)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** #RRGGBB → rgba(r,g,b,a)。それ以外の表記はそのまま返す */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export default SubtitleKaraoke01;
